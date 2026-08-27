"""Testes do AgentClient contra um mock de Relay local (websockets), cobrindo os
edge cases que já foram bugs reais na versão TypeScript deste SDK: timeout de auth,
drenagem de requests pendentes quando a conexão cai, e o fluxo normal de RFQ.
"""

import asyncio
import contextlib
import json

import pytest
import websockets
import websockets.asyncio.server
from eth_account import Account

from agent_sdk import AgentClient, RequestQuoteParams

TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
CHAIN_ID = 84532
SETTLEMENT_ADDRESS = "0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945"


@contextlib.asynccontextmanager
async def mock_relay(handler):
    async with websockets.asyncio.server.serve(handler, "localhost", 0) as server:
        port = server.sockets[0].getsockname()[1]
        yield f"ws://localhost:{port}"


async def _auth_only_handler(ws):
    await ws.send(json.dumps({"type": "auth_challenge", "nonce": "abc123"}))
    raw = await ws.recv()
    msg = json.loads(raw)
    assert msg["type"] == "auth_response"
    await ws.send(json.dumps({"type": "auth_ok", "address": msg["address"]}))
    async for _ in ws:
        pass  # mantém a conexão aberta, ignora o resto


@pytest.mark.asyncio
async def test_connect_resolve_apos_auth_ok():
    async with mock_relay(_auth_only_handler) as url:
        client = AgentClient(
            relay_url=url, account=Account.from_key(TEST_PRIVATE_KEY),
            chain_id=CHAIN_ID, settlement_address=SETTLEMENT_ADDRESS,
        )
        await client.connect()  # não deve lançar nem travar
        await client.close()


async def _never_auths_handler(ws):
    async for _ in ws:
        pass  # aceita a conexão mas nunca manda auth_challenge/auth_ok


@pytest.mark.asyncio
async def test_connect_lanca_timeout_se_auth_nunca_completa():
    async with mock_relay(_never_auths_handler) as url:
        client = AgentClient(
            relay_url=url, account=Account.from_key(TEST_PRIVATE_KEY),
            chain_id=CHAIN_ID, settlement_address=SETTLEMENT_ADDRESS,
            auth_timeout_s=0.3,
        )
        with pytest.raises(TimeoutError):
            await client.connect()


async def _auth_then_close_handler(ws):
    await ws.send(json.dumps({"type": "auth_challenge", "nonce": "abc123"}))
    raw = await ws.recv()
    msg = json.loads(raw)
    await ws.send(json.dumps({"type": "auth_ok", "address": msg["address"]}))
    # recebe o rfq_request e fecha a conexão sem nunca responder best_quotes
    await ws.recv()
    await ws.close()


@pytest.mark.asyncio
async def test_request_quote_resolve_lista_vazia_quando_conexao_fecha():
    # bug real corrigido no SDK TS (drainPendingRequests): sem isso, um
    # request_quote() em andamento quando a conexão cai nunca resolve
    async with mock_relay(_auth_then_close_handler) as url:
        client = AgentClient(
            relay_url=url, account=Account.from_key(TEST_PRIVATE_KEY),
            chain_id=CHAIN_ID, settlement_address=SETTLEMENT_ADDRESS,
        )
        await client.connect()
        quotes = await asyncio.wait_for(
            client.request_quote(
                RequestQuoteParams(
                    maker_token="0x1111111111111111111111111111111111111111",
                    taker_token="0x2222222222222222222222222222222222222222",
                    taker_amount=1_000_000,
                )
            ),
            timeout=5,
        )
        assert quotes == []


async def _best_quotes_handler(ws):
    await ws.send(json.dumps({"type": "auth_challenge", "nonce": "abc123"}))
    raw = await ws.recv()
    msg = json.loads(raw)
    await ws.send(json.dumps({"type": "auth_ok", "address": msg["address"]}))

    raw2 = await ws.recv()
    req = json.loads(raw2)
    assert req["type"] == "rfq_request"
    await ws.send(
        json.dumps(
            {
                "type": "best_quotes",
                "requestId": req["requestId"],
                "quotes": [
                    {
                        "maker": "0x1111111111111111111111111111111111111111",
                        "taker": "0x0000000000000000000000000000000000000000",
                        "makerToken": req["makerToken"],
                        "takerToken": req["takerToken"],
                        "makerAmount": "500000",
                        "takerAmount": req["takerAmount"],
                        "expiry": "9999999999",
                        "nonce": "1",
                        "signature": "0xdeadbeef",
                    }
                ],
            }
        )
    )


@pytest.mark.asyncio
async def test_request_quote_devolve_cotacoes_do_best_quotes():
    async with mock_relay(_best_quotes_handler) as url:
        client = AgentClient(
            relay_url=url, account=Account.from_key(TEST_PRIVATE_KEY),
            chain_id=CHAIN_ID, settlement_address=SETTLEMENT_ADDRESS,
        )
        await client.connect()
        quotes = await asyncio.wait_for(
            client.request_quote(
                RequestQuoteParams(
                    maker_token="0x1111111111111111111111111111111111111111",
                    taker_token="0x2222222222222222222222222222222222222222",
                    taker_amount=1_000_000,
                )
            ),
            timeout=5,
        )
        assert len(quotes) == 1
        assert quotes[0].maker_amount == 500_000
        assert quotes[0].signature == "0xdeadbeef"
        await client.close()
