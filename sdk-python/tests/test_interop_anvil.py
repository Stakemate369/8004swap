"""Prova de interoperabilidade real: sobe uma chain Anvil local, faz deploy do
Settlement.sol de verdade (bytecode compilado em out/Settlement.sol/Settlement.json),
e confirma que o hash EIP-712 computado por este SDK bate exatamente com o que o
contrato calcula via hashQuote() — e que a assinatura Python é aceita pelo mecanismo
de recover() real do contrato (via eth_account._recover_hash sobre o digest on-chain).

Um teste puramente off-chain (só sign + verify em Python) NÃO pegaria um mismatch de
domain/type entre este SDK e contracts/Settlement.sol — os dois lados usariam a mesma
implementação errada e "concordariam" entre si sem nunca validar contra a fonte de
verdade real. Esse é o motivo deste teste existir (mesmo racional de
test/SettlementPermit.t.sol e da validação ponta a ponta do SDK TypeScript).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from eth_account import Account
from web3 import Web3

from agent_sdk import Quote, sign_quote

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_PATH = REPO_ROOT / "out" / "Settlement.sol" / "Settlement.json"
ANVIL_PORT = 8547
ANVIL_URL = f"http://127.0.0.1:{ANVIL_PORT}"

# conta #0 padrão do Anvil (determinística, só usada em chain local descartável)
DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
# conta #1 padrão do Anvil — usada só como endereço "registry" dummy (hashQuote não
# toca no registry, só o construtor exige endereço não-zero)
DUMMY_REGISTRY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"

anvil_bin = shutil.which("anvil") or str(Path.home() / ".foundry" / "bin" / "anvil.exe")
forge_bin = shutil.which("forge") or str(Path.home() / ".foundry" / "bin" / "forge.exe")


@pytest.fixture(scope="module")
def anvil_settlement():
    if not Path(anvil_bin).exists():
        pytest.skip(f"anvil não encontrado em {anvil_bin}")
    if not ARTIFACT_PATH.exists():
        # garante o artefato compilado (forge build) antes de tentar o deploy
        subprocess.run([forge_bin, "build"], cwd=REPO_ROOT, check=True, capture_output=True)
    if not ARTIFACT_PATH.exists():
        pytest.skip(f"artefato compilado não encontrado em {ARTIFACT_PATH} mesmo após forge build")

    proc = subprocess.Popen(
        [anvil_bin, "--port", str(ANVIL_PORT), "--silent"],
        cwd=REPO_ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        w3 = Web3(Web3.HTTPProvider(ANVIL_URL))
        for _ in range(50):
            if w3.is_connected():
                break
            time.sleep(0.2)
        else:
            proc.kill()
            pytest.fail("anvil não subiu a tempo")

        with ARTIFACT_PATH.open() as f:
            artifact = json.load(f)

        deployer = Account.from_key(DEPLOYER_KEY)
        # conta #0 padrão do Anvil, já unlocked/gerenciada pelo próprio node -- não
        # precisa de middleware de assinatura local pra eth_sendTransaction
        w3.eth.default_account = deployer.address
        contract = w3.eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"]["object"])
        tx_hash = contract.constructor(DUMMY_REGISTRY).transact({"from": deployer.address})
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
        settlement = w3.eth.contract(address=receipt.contractAddress, abi=artifact["abi"])

        yield w3, settlement
    finally:
        proc.kill()
        proc.wait(timeout=10)


def test_hash_e_assinatura_python_batem_com_settlement_sol_real(anvil_settlement):
    w3, settlement = anvil_settlement

    maker = Account.from_key(DEPLOYER_KEY)
    chain_id = w3.eth.chain_id
    quote = Quote(
        maker=maker.address,
        taker="0x0000000000000000000000000000000000000000",
        maker_token="0x1111111111111111111111111111111111111111",
        taker_token="0x2222222222222222222222222222222222222222",
        maker_amount=1_000_000,
        taker_amount=2_000_000,
        expiry=9_999_999_999,
        nonce=1,
    )

    quote_tuple = (
        Web3.to_checksum_address(quote.maker),
        Web3.to_checksum_address(quote.taker),
        Web3.to_checksum_address(quote.maker_token),
        Web3.to_checksum_address(quote.taker_token),
        quote.maker_amount,
        quote.taker_amount,
        quote.expiry,
        quote.nonce,
    )

    # digest EIP-712 computado pelo contrato de verdade, não por outra implementação Python
    onchain_digest = settlement.functions.hashQuote(quote_tuple).call()

    signature = sign_quote(maker, chain_id, settlement.address, quote)

    # ecrecover sobre o digest on-chain, exatamente o que ECDSA.recover() do
    # OpenZeppelin faz dentro de fillQuote() -- se isso bater com maker.address,
    # a assinatura deste SDK é aceita pelo contrato real, não só por si mesma
    recovered = Account._recover_hash(onchain_digest, signature=signature)
    assert recovered.lower() == maker.address.lower()
