from obs.adapters.knx.adapter import KnxAdapterConfig
from obs.api.redaction import redact_write_only_fields


def test_redact_write_only_fields_removes_knx_secure_secrets() -> None:
    config = {
        "host": "192.168.1.100",
        "user_password": "secret-user",
        "device_authentication_password": "secret-device",
        "backbone_key": "00112233445566778899AABBCCDDEEFF",
        "knxkeys_password": "keyfile-secret",
    }

    redacted = redact_write_only_fields(config, KnxAdapterConfig)

    assert redacted["host"] == "192.168.1.100"
    assert "user_password" not in redacted
    assert "device_authentication_password" not in redacted
    assert "backbone_key" not in redacted
    assert "knxkeys_password" not in redacted
