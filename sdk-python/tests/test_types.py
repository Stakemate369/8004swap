from agent_sdk import Quote, SignedQuote, quote_from_wire, quote_terms_to_wire, quote_to_wire

quote = Quote(
    maker="0x1111111111111111111111111111111111111111",
    taker="0x2222222222222222222222222222222222222222",
    maker_token="0x3333333333333333333333333333333333333333",
    taker_token="0x4444444444444444444444444444444444444444",
    maker_amount=1_000_000_000_000_000_000,
    taker_amount=2_000_000,
    expiry=9_999_999_999,
    nonce=42,
)


def test_quote_terms_to_wire_converte_todo_int_pra_string_decimal():
    wire = quote_terms_to_wire(quote)
    assert wire["makerAmount"] == "1000000000000000000"
    assert wire["takerAmount"] == "2000000"
    assert wire["nonce"] == "42"


def test_quote_to_wire_quote_from_wire_roundtrip_sem_perder_precisao():
    signed = SignedQuote(**quote.__dict__, signature="0xabcd")
    round_tripped = quote_from_wire(quote_to_wire(signed))
    assert round_tripped == signed
