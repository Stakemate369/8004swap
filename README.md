# 8004Swap

Exchange RFQ não-custodial **só para agentes autônomos** (não humanos). Cada trade é um
match direto entre dois agentes (maker/taker), liquidado atomicamente on-chain — sem
pool de liquidez pré-financiado, no padrão do 0x Protocol / CoW Swap.

Diferencial: acesso sem KYC + reputação on-chain via [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004),
não apenas mais uma exchange com camada de bot em cima de infra que exige KYC humano.

**Status: testnet (Base Sepolia). Nenhum fundo real em risco. Nenhuma auditoria formal ainda.**

## Arquitetura

```
Agente maker  ──┐                                    ┌── Agente taker
                │   WebSocket (RFQ, assinatura        │
                ▼    EIP-712 off-chain, sem gas)       ▼
           ┌─────────────────────────────────────────────┐
           │                 Relay (relay/)               │
           │  matching de RFQ, ranking por melhor preço   │
           └─────────────────────┬─────────────────────────┘
                                  │ cotação assinada
                                  ▼
                     ┌───────────────────────────┐
                     │   Settlement.sol           │  ← liquidação atômica,
                     │   (contracts/Settlement.sol)│    oráculo Chainlink,
                     └─────────────┬───────────────┘    tetos de risco
                                   │ isActive() / recordFill()
                                   ▼
                     ┌───────────────────────────┐
                     │   Registry.sol             │  ← quem pode operar
                     │   (contracts/Registry.sol) │
                     └───────────────────────────┘
```

- **Registry.sol** — cadastro de agentes autorizados (auto-registro, `msg.sender` prova
  controle da chave). Owner pode pausar globalmente.
- **Settlement.sol** — liquidação de `Quote` assinada via EIP-712. Exige oráculo Chainlink
  cadastrado por par (nega por padrão), checa staleness, aplica tetos de risco
  (`maxTradeAmount`, `maxVolumePerWindow`) e taxa opcional anti-sybil (`feeBps`).
- **relay/** — servidor WebSocket que autentica agentes (assinatura de login), faz
  matching de RFQ por par de token e devolve a melhor cotação assinada ao taker, que
  fecha on-chain chamando `fillQuote` diretamente.
- **sdk/** (`@8004swap/agent-sdk`) — cliente TypeScript que encapsula o handshake WS,
  assinatura EIP-712 e liquidação on-chain, pra quem quiser integrar um agente sem
  reimplementar o protocolo do zero. Ver [`sdk/README.md`](./sdk/README.md).
- **sdk-python/** (`8004swap-agent-sdk`) — mesma coisa, em Python (`eth_account` +
  `websockets` + `web3.py`). Ver [`sdk-python/README.md`](./sdk-python/README.md).

Ver [`PROTOCOL.md`](./PROTOCOL.md) para o formato exato das mensagens do Relay.

## Rodar localmente

### Contratos (Foundry)

```shell
forge build
forge test
```

### Relay

```shell
cd relay
npm install
cp .env.example .env   # preencha BASE_RPC_URL, REGISTRY_ADDRESS
npm run dev
```

Exemplos de agente (maker/taker) em `relay/examples/` — rodam contra o Relay local ou
hospedado. Pra integrar um agente novo, prefira `sdk/` (`@8004swap/agent-sdk`), que
encapsula o mesmo fluxo desses exemplos como biblioteca.

### Deploy de contratos

```shell
forge script script/DeploySepolia.s.sol --rpc-url <sepolia_rpc> --private-key <key> --broadcast
```

`script/Deploy.s.sol` é a versão mainnet (4 pares contra USDC) — **não rodar sem decisão
explícita**, contratos ainda não passaram por auditoria formal.

## Rede atual (Base Sepolia)

- Registry: `0x7Bb793b6Ada038cf9c26c6BB54cA15Db6BD35ed1`
- Settlement: `0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945`
- Par ativo: WETH/USDC-teste

## Contribuindo

Projeto aberto a colaboradores externos — contratos, relay, SDKs em outras linguagens,
suporte a novas chains. Ver [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Licença

MIT
