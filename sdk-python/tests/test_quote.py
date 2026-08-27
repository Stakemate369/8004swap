from eth_account import Account

from agent_sdk import Quote, sign_quote, verify_quote_signature

# chave de teste conhecida (Anvil #0) — nunca usar em mainnet de verdade
TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
account = Account.from_key(TEST_PRIVATE_KEY)
CHAIN_ID = 84532
SETTLEMENT_ADDRESS = "0x5Cc2558dF13739c05cb57Caf0E9cfe1629a6a945"


def sample_quote(**overrides) -> Quote:
    base = dict(
        maker=account.address,
        taker="0x0000000000000000000000000000000000000000",
        maker_token="0x1111111111111111111111111111111111111111",
        taker_token="0x2222222222222222222222222222222222222222",
        maker_amount=1_000_000,
        taker_amount=2_000_000,
        expiry=9_999_999_999,
        nonce=1,
    )
    base.update(overrides)
    return Quote(**base)


def test_verifica_cotacao_assinada_corretamente():
    quote = sample_quote()
    signature = sign_quote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote)
    assert verify_quote_signature(CHAIN_ID, SETTLEMENT_ADDRESS, quote, signature, account.address) is True


def test_rejeita_assinatura_de_cotacao_alterada_depois_de_assinada():
    quote = sample_quote()
    signature = sign_quote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote)
    tampered = sample_quote(maker_amount=999_999)
    assert verify_quote_signature(CHAIN_ID, SETTLEMENT_ADDRESS, tampered, signature, account.address) is False


def test_rejeita_assinatura_contra_chain_id_diferente():
    quote = sample_quote()
    signature = sign_quote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote)
    assert verify_quote_signature(8453, SETTLEMENT_ADDRESS, quote, signature, account.address) is False


def test_rejeita_assinatura_contra_settlement_address_diferente():
    quote = sample_quote()
    signature = sign_quote(account, CHAIN_ID, SETTLEMENT_ADDRESS, quote)
    other = "0x9999999999999999999999999999999999999999"
    assert verify_quote_signature(CHAIN_ID, other, quote, signature, account.address) is False
