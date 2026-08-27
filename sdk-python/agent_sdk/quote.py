"""Assinatura e verificação EIP-712 de Quote.

Tem que bater exatamente com EIP712("AgentRFQSettlement", "1") e o QUOTE_TYPEHASH
de contracts/Settlement.sol — mudar aqui sem mudar lá (ou vice-versa) faz toda
assinatura falhar a verificação on-chain.
"""

from __future__ import annotations

from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_account.signers.local import LocalAccount

from .types import Quote

QUOTE_TYPES: dict[str, list[dict[str, str]]] = {
    "Quote": [
        {"name": "maker", "type": "address"},
        {"name": "taker", "type": "address"},
        {"name": "makerToken", "type": "address"},
        {"name": "takerToken", "type": "address"},
        {"name": "makerAmount", "type": "uint256"},
        {"name": "takerAmount", "type": "uint256"},
        {"name": "expiry", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
    ]
}


def quote_domain(chain_id: int, settlement_address: str) -> dict[str, object]:
    return {
        "name": "AgentRFQSettlement",
        "version": "1",
        "chainId": chain_id,
        "verifyingContract": settlement_address,
    }


def _quote_message(q: Quote) -> dict[str, object]:
    return {
        "maker": q.maker,
        "taker": q.taker,
        "makerToken": q.maker_token,
        "takerToken": q.taker_token,
        "makerAmount": q.maker_amount,
        "takerAmount": q.taker_amount,
        "expiry": q.expiry,
        "nonce": q.nonce,
    }


def sign_quote(account: LocalAccount, chain_id: int, settlement_address: str, quote: Quote) -> str:
    signable = encode_typed_data(
        domain_data=quote_domain(chain_id, settlement_address),
        message_types=QUOTE_TYPES,
        message_data=_quote_message(quote),
    )
    signed = account.sign_message(signable)
    return signed.signature.to_0x_hex()


def verify_quote_signature(
    chain_id: int,
    settlement_address: str,
    quote: Quote,
    signature: str,
    expected_signer: str,
) -> bool:
    signable = encode_typed_data(
        domain_data=quote_domain(chain_id, settlement_address),
        message_types=QUOTE_TYPES,
        message_data=_quote_message(quote),
    )
    try:
        recovered = Account.recover_message(signable, signature=signature)
    except Exception:
        return False
    return recovered.lower() == expected_signer.lower()
