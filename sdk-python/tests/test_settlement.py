from web3 import Web3

from agent_sdk import NO_PERMIT, SETTLEMENT_ABI, Quote

quote = Quote(
    maker="0x1111111111111111111111111111111111111111",
    taker="0x0000000000000000000000000000000000000000",
    maker_token="0x2222222222222222222222222222222222222222",
    taker_token="0x3333333333333333333333333333333333333333",
    maker_amount=1_000_000,
    taker_amount=2_000_000,
    expiry=9_999_999_999,
    nonce=1,
)


def test_no_permit_codifica_fillquotewithpermit_sem_lancar():
    # regressão: r/s com tamanho errado (não bytes32 de 32 bytes) faz o encoder ABI
    # lançar antes mesmo de chegar na chain — exatamente o caminho "sem permit" que
    # essa constante existe pra cobrir (mesmo bug que NO_PERMIT resolve no SDK TS)
    w3 = Web3()
    contract = w3.eth.contract(abi=SETTLEMENT_ABI)
    from agent_sdk.settlement import _permit_tuple, _quote_tuple

    encoded = contract.encode_abi(
        "fillQuoteWithPermit",
        args=[_quote_tuple(quote), "0xabcd", _permit_tuple(NO_PERMIT)],
    )
    assert encoded.startswith("0x")
