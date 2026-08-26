# Protocolo do Relay (WebSocket)

Formato de mensagens trocadas com o Relay (`relay/src/server.ts`). Toda mensagem é um
JSON com campo `type`. `bigint` sempre trafega como `string` decimal (JSON não suporta
bigint nativamente) e é convertido de volta no cliente.

Fonte de verdade: `relay/src/types.ts`. Este documento é a versão legível; em caso de
divergência, o código manda.

## 1. Handshake de autenticação

O servidor inicia toda conexão mandando um desafio. O cliente prova controle da chave
assinando uma mensagem simples (não é uma tx, não gasta gas).

```
Servidor → Cliente   { "type": "auth_challenge", "nonce": "<hex aleatório>" }
Cliente  → Servidor  { "type": "auth_response", "address": "0x...", "signature": "0x..." }
```

A assinatura é sobre a string `Login to 8004Swap Relay: <nonce>` (personal_sign / EIP-191).

```
Servidor → Cliente   { "type": "auth_ok", "address": "0x..." }
                  ou  { "type": "error", "message": "..." }
```

O servidor rejeita (`error`) se a assinatura for inválida **ou** se `registry.isActive(address)`
retornar `false` on-chain (agente não registrado, pausado, ou pausa global ativa).
Nenhuma outra mensagem é aceita antes de `auth_ok`.

## 2. Maker: inscrever-se num par

```
Cliente → Servidor   { "type": "subscribe_pair", "makerToken": "0x...", "takerToken": "0x..." }
```

Sem confirmação explícita — a partir daqui, essa conexão recebe todo `rfq_broadcast`
para esse par exato (`makerToken`/`takerToken` nessa ordem).

## 3. Taker: pedir cotação

```
Cliente → Servidor   {
  "type": "rfq_request",
  "requestId": "<opcional, gerado pelo servidor se ausente>",
  "makerToken": "0x...",
  "takerToken": "0x...",
  "takerAmount": "1000000",
  "minMakerAmount": "0",          // opcional, piso de aceitação
  "expiresInMs": 3000              // opcional, teto real é 30000ms
}
```

O servidor faz broadcast pros subscribers do par:

```
Servidor → Makers    {
  "type": "rfq_broadcast",
  "requestId": "...",
  "taker": "0x<endereço do taker que pediu>",
  "makerToken": "0x...",
  "takerToken": "0x...",
  "takerAmount": "1000000",
  "expiresAt": <epoch ms>
}
```

## 4. Maker: responder com cotação assinada

```
Cliente → Servidor   {
  "type": "quote_response",
  "requestId": "...",
  "quote": {
    "maker": "0x...",
    "taker": "0x<sempre o taker do rfq_broadcast, nunca zeroAddress>",
    "makerToken": "0x...",
    "takerToken": "0x...",
    "makerAmount": "...",
    "takerAmount": "...",
    "expiry": "<epoch seconds>",
    "nonce": "..."
  },
  "signature": "0x..."   // EIP-712 sobre `quote`, domain AgentRFQSettlement v1
}
```

**`quote.taker` deve sempre ser o endereço exato do `rfq_broadcast` correspondente.**
O contrato aceita `taker == address(0)` (qualquer um preenche), mas isso abre a
cotação a front-running por cópia de calldata no mempool — os clientes de referência
(`relay/examples/`) sempre fixam o taker.

O servidor valida: assinatura EIP-712 correta, maker/taker ainda ativos no Registry, e
que os termos batem exatamente com o `rfq_request` original (mesmo taker/par/`takerAmount`).

## 5. Servidor: melhor cotação

Quando a janela da RFQ expira (`min(expiresInMs, 30000)`), o servidor rankeia as
cotações recebidas (maior `makerAmount` primeiro, descarta abaixo de `minMakerAmount`)
e devolve só ao taker original:

```
Servidor → Taker     {
  "type": "best_quotes",
  "requestId": "...",
  "quotes": [ { ...termos da quote, "signature": "0x..." }, ... ]
}
```

## 6. Liquidação (fora do Relay)

O taker pega a melhor `quote` + `signature` da lista e chama
`Settlement.fillQuote(quote, signature)` on-chain diretamente. O Relay **não participa**
da liquidação — só faz matching. Ver `contracts/Settlement.sol` e
`relay/examples/settleTaker.ts` para o fluxo completo.

**Variante com permit:** se o taker ainda não tem allowance sobre `takerToken`, pode
chamar `Settlement.fillQuoteWithPermit(quote, signature, permit)` em vez de `fillQuote`
— poupa a tx de `approve` separada, desde que `takerToken` suporte EIP-2612. `permit` é
`{ value, deadline, v, r, s }`, uma assinatura padrão EIP-2612 do taker autorizando o
Settlement a gastar `value` até `deadline`. `permit.deadline == 0` é o sinal explícito
de "sem permit" (usa allowance convencional já existente) — o SDK expõe isso como
`NO_PERMIT`. Um permit inválido ou já consumido não derruba o fill: é ignorado
silenciosamente, e a checagem normal de allowance segue adiante. Ver
`sdk/src/settlement.ts` (`fillQuoteWithPermit`, `NO_PERMIT`).

## Erros

```
{ "type": "error", "requestId"?: "...", "message": "<texto em português>" }
```

`requestId` presente quando o erro é sobre um pedido/cotação específica; ausente para
erros de sessão (ex: mensagem antes de autenticar).

## Limites

- Rate limit por endereço autenticado: `RFQ_RATE_LIMIT_PER_MINUTE` (padrão 30/min) em
  `rfq_request`.
- Janela de RFQ: no máximo 30 segundos, mesmo se o cliente pedir mais.
- Cache de `isActive()`: até `REGISTRY_CACHE_TTL_MS` (padrão 30s) — uma pausa no Registry
  pode levar até esse tempo pra refletir no Relay.
- Conexões WebSocket simultâneas por IP: `MAX_CONNECTIONS_PER_IP` (padrão 20), mesmo
  antes do handshake de autenticação — acima disso a conexão é fechada (código 1008).
