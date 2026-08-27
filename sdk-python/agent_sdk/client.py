"""Cliente de agente pro Relay do 8004Swap: handshake de autenticação (assinatura
de login), fluxo de RFQ (subscribe/broadcast/quote/best_quotes) e assinatura EIP-712
das cotações. Não faz a liquidação on-chain — ver settlement.py para isso. Spec
completa das mensagens em PROTOCOL.md na raiz do repo.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import websockets
from eth_account.messages import encode_defunct
from eth_account.signers.local import LocalAccount
from websockets.asyncio.client import ClientConnection

from .quote import sign_quote
from .types import Quote, RfqBroadcastMsg, SignedQuote, quote_from_wire, quote_terms_to_wire

RfqHandler = Callable[[RfqBroadcastMsg], Awaitable[Quote | None] | Quote | None]
"""Devolvido pelo maker em resposta a um rfq_broadcast; None = não cotar essa RFQ."""


@dataclass
class RequestQuoteParams:
    maker_token: str
    taker_token: str
    taker_amount: int
    min_maker_amount: int = 0
    expires_in_ms: int | None = None  # teto real aplicado pelo Relay é 30s, mesmo se pedir mais


class AgentClient:
    def __init__(
        self,
        *,
        relay_url: str,
        account: LocalAccount,
        chain_id: int,
        settlement_address: str,
        auth_timeout_s: float = 10.0,
    ) -> None:
        self._relay_url = relay_url
        self._account = account
        self._chain_id = chain_id
        self._settlement_address = settlement_address
        self._auth_timeout_s = auth_timeout_s

        self._ws: ClientConnection | None = None
        self._recv_task: asyncio.Task | None = None
        self._authed = asyncio.Event()
        self._auth_error: Exception | None = None
        self._pending_requests: dict[str, asyncio.Future[list[SignedQuote]]] = {}
        self._rfq_handler: RfqHandler | None = None

    @property
    def address(self) -> str:
        return self._account.address

    async def connect(self) -> None:
        """Abre a conexão e aguarda `auth_ok` (ou lança se a auth falhar, fechar,
        ou não completar dentro de auth_timeout_s). Sem esse timeout, um relay que
        aceita o socket mas nunca manda auth_challenge/auth_ok travaria pra sempre.
        """
        self._ws = await websockets.connect(self._relay_url)
        self._recv_task = asyncio.create_task(self._recv_loop())
        try:
            await asyncio.wait_for(self._authed.wait(), timeout=self._auth_timeout_s)
        except TimeoutError as exc:
            await self._close_ws()
            raise TimeoutError(f"autenticação não completou em {self._auth_timeout_s}s") from exc
        if self._auth_error is not None:
            raise self._auth_error

    def on_rfq_broadcast(self, handler: RfqHandler) -> None:
        """Registra o handler chamado a cada rfq_broadcast recebido (papel de maker)."""
        self._rfq_handler = handler

    async def subscribe_pair(self, maker_token: str, taker_token: str) -> None:
        """Inscreve esta conexão como maker no par (papel de maker)."""
        await self._send({"type": "subscribe_pair", "makerToken": maker_token, "takerToken": taker_token})

    async def request_quote(self, params: RequestQuoteParams) -> list[SignedQuote]:
        """Pede cotação e aguarda a janela de coleta do Relay fechar (papel de taker).
        Resolve com a lista já rankeada (maior makerAmount primeiro); lista vazia =
        sem cotação.
        """
        request_id = str(uuid.uuid4())
        future: asyncio.Future[list[SignedQuote]] = asyncio.get_event_loop().create_future()

        msg = {
            "type": "rfq_request",
            "requestId": request_id,
            "makerToken": params.maker_token,
            "takerToken": params.taker_token,
            "takerAmount": str(params.taker_amount),
            "minMakerAmount": str(params.min_maker_amount),
        }
        if params.expires_in_ms is not None:
            msg["expiresInMs"] = params.expires_in_ms

        # manda primeiro, só registra em _pending_requests se o send funcionar — na
        # ordem inversa, um send() que lança deixaria a entrada pra sempre, já que
        # nada mais a removeria
        await self._send(msg)
        self._pending_requests[request_id] = future
        return await future

    async def close(self) -> None:
        await self._close_ws()
        if self._recv_task is not None:
            self._recv_task.cancel()

    async def _close_ws(self) -> None:
        if self._ws is not None:
            await self._ws.close()

    async def _send(self, msg: dict) -> None:
        if self._ws is None:
            raise RuntimeError("AgentClient: não conectado (chame connect() antes)")
        await self._ws.send(json.dumps(msg))

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                await self._handle_message(raw if isinstance(raw, str) else raw.decode())
        except websockets.ConnectionClosed:
            pass
        finally:
            self._fail_auth(ConnectionError("conexão fechada antes de autenticar"))
            self._drain_pending_requests()

    def _fail_auth(self, err: Exception) -> None:
        if self._authed.is_set():
            return
        self._auth_error = err
        self._authed.set()

    # sem isso, um request_quote() em andamento quando a conexão cai (queda de
    # rede, restart do relay) nunca resolve — o future do chamador fica pendurado
    # pra sempre e a entrada correspondente vaza no dict por toda a vida do processo
    def _drain_pending_requests(self) -> None:
        for future in self._pending_requests.values():
            if not future.done():
                future.set_result([])
        self._pending_requests.clear()

    async def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            return

        msg_type = msg.get("type")

        if msg_type == "auth_challenge":
            nonce = msg["nonce"]
            signable = encode_defunct(text=f"Login to 8004Swap Relay: {nonce}")
            signed = self._account.sign_message(signable)
            await self._send(
                {
                    "type": "auth_response",
                    "address": self._account.address,
                    "signature": signed.signature.to_0x_hex(),
                }
            )

        elif msg_type == "auth_ok":
            self._authed.set()

        elif msg_type == "rfq_broadcast":
            await self._handle_rfq_broadcast(msg)  # type: ignore[arg-type]

        elif msg_type == "best_quotes":
            future = self._pending_requests.pop(msg["requestId"], None)
            if future is not None and not future.done():
                future.set_result([quote_from_wire(w) for w in msg["quotes"]])

        elif msg_type == "error":
            # erro ligado a um rfq_request pendente (ex: rate limit) resolve como
            # "nenhuma cotação" em vez de deixar o future pendurado pra sempre
            request_id = msg.get("requestId")
            if request_id:
                future = self._pending_requests.pop(request_id, None)
                if future is not None and not future.done():
                    future.set_result([])

    async def _handle_rfq_broadcast(self, rfq: RfqBroadcastMsg) -> None:
        if self._rfq_handler is None:
            return
        result = self._rfq_handler(rfq)
        quote = await result if asyncio.iscoroutine(result) else result
        if not quote:
            return

        signature = sign_quote(self._account, self._chain_id, self._settlement_address, quote)
        await self._send(
            {
                "type": "quote_response",
                "requestId": rfq["requestId"],
                "quote": quote_terms_to_wire(quote),
                "signature": signature,
            }
        )
