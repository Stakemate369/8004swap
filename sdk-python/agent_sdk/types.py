"""Espelha exatamente o struct Quote do Settlement.sol e as mensagens do Relay.

Ver PROTOCOL.md na raiz do repo pra spec completa. Deliberadamente não depende de
nada do relay/: este pacote é publicável e não deve depender do processo do Relay.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, TypedDict


@dataclass(frozen=True)
class Quote:
    maker: str
    taker: str  # zero address = qualquer taker registrado pode preencher (evite: ver PROTOCOL.md)
    maker_token: str
    taker_token: str
    maker_amount: int
    taker_amount: int
    expiry: int
    nonce: int


@dataclass(frozen=True)
class SignedQuote(Quote):
    signature: str


class WireQuoteTerms(TypedDict):
    maker: str
    taker: str
    makerToken: str
    takerToken: str
    makerAmount: str
    takerAmount: str
    expiry: str
    nonce: str


class WireQuote(WireQuoteTerms):
    signature: str


class AuthChallengeMsg(TypedDict):
    type: Literal["auth_challenge"]
    nonce: str


class AuthOkMsg(TypedDict):
    type: Literal["auth_ok"]
    address: str


class RfqBroadcastMsg(TypedDict):
    type: Literal["rfq_broadcast"]
    requestId: str
    taker: str
    takerToken: str
    takerAmount: str
    makerToken: str
    expiresAt: int


class BestQuotesMsg(TypedDict):
    type: Literal["best_quotes"]
    requestId: str
    quotes: list[WireQuote]


class ErrorMsg(TypedDict, total=False):
    type: Literal["error"]
    requestId: str
    message: str


InboundMsg = AuthChallengeMsg | AuthOkMsg | RfqBroadcastMsg | BestQuotesMsg | ErrorMsg


class AuthResponseMsg(TypedDict):
    type: Literal["auth_response"]
    address: str
    signature: str


class SubscribePairMsg(TypedDict):
    type: Literal["subscribe_pair"]
    makerToken: str
    takerToken: str


class RfqRequestMsg(TypedDict, total=False):
    type: Literal["rfq_request"]
    requestId: str
    makerToken: str
    takerToken: str
    takerAmount: str
    minMakerAmount: str
    expiresInMs: int


class QuoteResponseMsg(TypedDict):
    type: Literal["quote_response"]
    requestId: str
    quote: WireQuoteTerms
    signature: str


OutboundMsg = AuthResponseMsg | SubscribePairMsg | RfqRequestMsg | QuoteResponseMsg


def quote_terms_to_wire(q: Quote) -> WireQuoteTerms:
    return {
        "maker": q.maker,
        "taker": q.taker,
        "makerToken": q.maker_token,
        "takerToken": q.taker_token,
        "makerAmount": str(q.maker_amount),
        "takerAmount": str(q.taker_amount),
        "expiry": str(q.expiry),
        "nonce": str(q.nonce),
    }


def quote_to_wire(q: SignedQuote) -> WireQuote:
    wire: dict[str, Any] = dict(quote_terms_to_wire(q))
    wire["signature"] = q.signature
    return wire  # type: ignore[return-value]


def quote_from_wire(w: WireQuote) -> SignedQuote:
    return SignedQuote(
        maker=w["maker"],
        taker=w["taker"],
        maker_token=w["makerToken"],
        taker_token=w["takerToken"],
        maker_amount=int(w["makerAmount"]),
        taker_amount=int(w["takerAmount"]),
        expiry=int(w["expiry"]),
        nonce=int(w["nonce"]),
        signature=w["signature"],
    )
