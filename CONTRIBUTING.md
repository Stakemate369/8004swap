# Contribuindo com o 8004Swap

Projeto em fase inicial (testnet), sem orçamento para auditoria formal, infra paga
dedicada, ou equipe própria. As áreas abaixo estão abertas a quem quiser contribuir —
via crédito/reconhecimento público, não pagamento em dinheiro, salvo quando uma
issue diz o contrário.

## Onde ajudar tem mais impacto agora

1. **Rodar seu próprio Relay (federação).** O Relay é self-hostable
   (`relay/Dockerfile`, `relay/deploy.akash.yaml`) e conecta no mesmo Registry/Settlement
   já em Base Sepolia. Hoje existe um único Relay operado centralmente — isso é o maior
   ponto único de falha do protocolo. Rodar uma instância independente e reportar
   problemas de compatibilidade já ajuda a rede a virar de fato descentralizada.

2. **Revisão de segurança voluntária.** Sem orçamento para Code4rena/Sherlock por
   enquanto. Uma leitura adversarial de `contracts/Registry.sol` e
   `contracts/Settlement.sol` (41 testes Foundry já cobrem o comportamento esperado —
   veja `test/`) é bem-vinda via issue ou PR. Achados sérios entram no
   `SECURITY.md` (a criar) com crédito público.

3. **SDK em outras linguagens.** Já existe um SDK em TypeScript (`sdk/`,
   `@8004swap/agent-sdk`) seguindo `PROTOCOL.md`. Um equivalente em Python/Rust/Go
   abre a rede a mais agentes.

4. **Portar para outra chain.** A arquitetura (oráculo Chainlink obrigatório por par,
   tetos de risco configuráveis) não é específica da Base — replicar em outra L2
   com feeds Chainlink ativos é um bom primeiro PR de contrato.

5. **Registro em diretórios do ecossistema ERC-8004/MCP.** Ajuda a redigir/propor
   listagem em índices públicos de agentes é bem-vinda.

## Como propor

- Abra uma issue descrevendo o problema/proposta antes de um PR grande — evita
  retrabalho se a direção não bater com o resto da arquitetura.
- Mudanças em `contracts/` precisam vir com teste Foundry cobrindo o caso (positivo
  e, quando aplicável, o caso de ataque que a mudança previne).
- Mudanças em `relay/` precisam rodar `npm test` e, quando tocam no fluxo de
  liquidação, um teste ponta a ponta contra uma chain local (Anvil) — não só
  unit test isolado.

## O que não aceita PR externo sem alinhamento prévio

- Decisão de deploy em mainnet.
- Troca do endereço `owner()` dos contratos (hoje sob Turnkey, não multisig ainda).
- Qualquer coisa envolvendo a marca/nome "8004Swap".

Essas ficam com quem mantém o projeto — abra uma issue de discussão em vez de PR
direto.
