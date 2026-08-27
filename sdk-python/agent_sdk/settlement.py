"""Chamadas on-chain a Settlement.fillQuote / fillQuoteWithPermit via web3.py."""

from __future__ import annotations

from dataclasses import dataclass

from web3 import Web3
from web3.contract.contract import ContractFunction
from web3.types import TxParams

from .types import Quote

# espelha o struct Quote do Settlement.sol (ver contracts/Settlement.sol)
_QUOTE_COMPONENTS = [
    {"name": "maker", "type": "address"},
    {"name": "taker", "type": "address"},
    {"name": "makerToken", "type": "address"},
    {"name": "takerToken", "type": "address"},
    {"name": "makerAmount", "type": "uint256"},
    {"name": "takerAmount", "type": "uint256"},
    {"name": "expiry", "type": "uint256"},
    {"name": "nonce", "type": "uint256"},
]

SETTLEMENT_ABI = [
    {
        "type": "function",
        "name": "fillQuote",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "q", "type": "tuple", "components": _QUOTE_COMPONENTS},
            {"name": "makerSignature", "type": "bytes"},
        ],
        "outputs": [],
    },
    {
        "type": "function",
        "name": "fillQuoteWithPermit",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "q", "type": "tuple", "components": _QUOTE_COMPONENTS},
            {"name": "makerSignature", "type": "bytes"},
            {
                "name": "permit",
                "type": "tuple",
                "components": [
                    {"name": "value", "type": "uint256"},
                    {"name": "deadline", "type": "uint256"},
                    {"name": "v", "type": "uint8"},
                    {"name": "r", "type": "bytes32"},
                    {"name": "s", "type": "bytes32"},
                ],
            },
        ],
        "outputs": [],
    },
]


@dataclass(frozen=True)
class PermitData:
    value: int
    deadline: int
    v: int
    r: bytes
    s: bytes


# deadline == 0 = "sem permit" (ver PermitData no Settlement.sol) — usa allowance
# convencional já existente em vez de tentar consumir um permit. r/s precisam ser
# bytes32 de verdade (32 bytes exatos) — o equivalente Python do bug de encoding
# que NO_PERMIT resolve no SDK TS (viem lançava AbiEncodingBytesSizeMismatchError
# com "0x0" de 1 byte em vez de bytes32)
NO_PERMIT = PermitData(value=0, deadline=0, v=0, r=b"\x00" * 32, s=b"\x00" * 32)


def _quote_tuple(q: Quote) -> tuple:
    return (
        Web3.to_checksum_address(q.maker),
        Web3.to_checksum_address(q.taker),
        Web3.to_checksum_address(q.maker_token),
        Web3.to_checksum_address(q.taker_token),
        q.maker_amount,
        q.taker_amount,
        q.expiry,
        q.nonce,
    )


def _permit_tuple(p: PermitData) -> tuple:
    return (p.value, p.deadline, p.v, p.r, p.s)


def _settlement_contract(w3: Web3, settlement_address: str):
    return w3.eth.contract(address=Web3.to_checksum_address(settlement_address), abi=SETTLEMENT_ABI)


def fill_quote(
    w3: Web3,
    settlement_address: str,
    quote: Quote,
    signature: str,
    *,
    sender: str,
    tx_params: TxParams | None = None,
) -> bytes:
    """Chama Settlement.fillQuote(quote, signature) on-chain e devolve o tx hash.

    Requer allowance prévio do taker (sender) sobre takerToken. `w3` precisa de uma
    conta assinante configurada (ex: via `w3.eth.default_account` + middleware de
    assinatura local, ou passe `tx_params` já assinado externamente).
    """
    contract = _settlement_contract(w3, settlement_address)
    fn: ContractFunction = contract.functions.fillQuote(_quote_tuple(quote), signature)
    params: TxParams = {"from": Web3.to_checksum_address(sender), **(tx_params or {})}
    return fn.transact(params)


def fill_quote_with_permit(
    w3: Web3,
    settlement_address: str,
    quote: Quote,
    signature: str,
    permit: PermitData,
    *,
    sender: str,
    tx_params: TxParams | None = None,
) -> bytes:
    """Como fill_quote, mas aplica um permit EIP-2612 do taker sobre takerToken antes."""
    contract = _settlement_contract(w3, settlement_address)
    fn: ContractFunction = contract.functions.fillQuoteWithPermit(
        _quote_tuple(quote), signature, _permit_tuple(permit)
    )
    params: TxParams = {"from": Web3.to_checksum_address(sender), **(tx_params or {})}
    return fn.transact(params)


def wait_for_fill(w3: Web3, tx_hash: bytes, *, timeout: float = 120.0):
    """Aguarda a confirmação da tx de fill e devolve o receipt."""
    return w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
