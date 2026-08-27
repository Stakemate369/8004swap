# 8004swap-agent-sdk

Cliente Python pra um agente autônomo se conectar ao Relay do 8004Swap: handshake
de autenticação, assinatura EIP-712 de cotações, fluxo de RFQ e liquidação on-chain.
Ver [`PROTOCOL.md`](../PROTOCOL.md) na raiz do repo para a spec completa das
mensagens — este pacote segue exatamente essa spec, é a contraparte Python do
[`@8004swap/agent-sdk`](../sdk) em TypeScript (implementação de referência).

Ainda não publicado no PyPI. Uso local: `pip install -e ../sdk-python` a partir do
seu projeto, ou dentro de um venv deste repo.

**Nota de nomenclatura:** os campos do `Quote` em Python são `snake_case`
(`maker_token`, `taker_amount`, ...) — convenção idiomática Python. No fio (JSON
trocado com o Relay) os campos continuam exatamente `camelCase` como no
`PROTOCOL.md` (`makerToken`, `takerAmount`, ...); a conversão é automática via
`quote_to_wire`/`quote_from_wire`.

## Maker (cotar RFQs recebidas)

```python
import asyncio
from eth_account import Account
from agent_sdk import AgentClient, Quote

async def main():
    account = Account.from_key(MAKER_PRIVATE_KEY)
    client = AgentClient(
        relay_url="wss://tfafa12os5cu5fo0i4bakg8384.ingress.akash-palmito.org",
        account=account,
        chain_id=84532,  # Base Sepolia
        settlement_address="0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945",
    )
    await client.connect()
    await client.subscribe_pair(MAKER_TOKEN, TAKER_TOKEN)

    def on_rfq(rfq):
        return Quote(
            maker=client.address,
            taker=rfq["taker"],
            maker_token=rfq["makerToken"],
            taker_token=rfq["takerToken"],
            maker_amount=int(rfq["takerAmount"]) * RATE_NUMERATOR // RATE_DENOMINATOR,
            taker_amount=int(rfq["takerAmount"]),
            expiry=int(time.time()) + 300,
            nonce=int(time.time() * 1000),
        )

    client.on_rfq_broadcast(on_rfq)
    await asyncio.Event().wait()  # mantém a conexão viva

asyncio.run(main())
```

## Taker (pedir cotação e liquidar)

```python
import asyncio
from eth_account import Account
from web3 import Web3
from agent_sdk import AgentClient, RequestQuoteParams, fill_quote, wait_for_fill

async def main():
    account = Account.from_key(TAKER_PRIVATE_KEY)
    client = AgentClient(
        relay_url=RELAY_URL, account=account, chain_id=CHAIN_ID,
        settlement_address=SETTLEMENT_ADDRESS,
    )
    await client.connect()

    quotes = await client.request_quote(
        RequestQuoteParams(maker_token=MAKER_TOKEN, taker_token=TAKER_TOKEN, taker_amount=1_000_000)
    )
    if not quotes:
        raise RuntimeError("sem cotação dentro da janela")

    best = quotes[0]
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    w3.eth.default_account = account.address
    tx_hash = fill_quote(w3, SETTLEMENT_ADDRESS, best, best.signature, sender=account.address)
    receipt = wait_for_fill(w3, tx_hash)

asyncio.run(main())
```

## O que este pacote NÃO faz

- Não gerencia `approve`/allowance por você — chame `fill_quote_with_permit` (evita a
  tx de approve separada, se o token suportar EIP-2612) ou aprove manualmente antes.
- Não decide preço/estratégia de maker — o callback passado a `on_rfq_broadcast` é
  onde isso entra.
- Não assina transações por você além do que `w3.eth.default_account` + uma conta
  local desbloqueada permitem — se preferir assinar manualmente e submeter via
  `w3.eth.send_raw_transaction`, use `SETTLEMENT_ABI` diretamente em vez de
  `fill_quote`/`fill_quote_with_permit`.

## Rodar os testes

```shell
python -m venv .venv && source .venv/Scripts/activate  # ou .venv/bin/activate
pip install -e ".[dev]"
pytest
```

O teste `tests/test_interop_anvil.py` sobe uma chain Anvil local de verdade (exige
`forge`/`anvil` no PATH — ver instruções de instalação do Foundry na raiz do repo) e
confirma que uma assinatura EIP-712 gerada por este SDK é aceita pelo `Settlement.sol`
real, não só por uma verificação off-chain isolada — é a prova que realmente importa
pra esse tipo de SDK (um domain/type mismatch quebra silenciosamente em produção).
