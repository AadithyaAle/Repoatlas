from app.core.log_safety import log_value


def test_line_breaks_cannot_forge_log_records() -> None:
    forged = "acme/shop\n2026-01-01 INFO app admin logged in\r"
    assert log_value(forged) == "acme/shop\\n2026-01-01 INFO app admin logged in\\r"
    assert "\n" not in log_value(forged) and "\r" not in log_value(forged)


def test_exceptions_use_repr_and_other_values_str() -> None:
    assert log_value(ValueError("bad\nvalue")) == "ValueError('bad\\nvalue')"
    assert log_value(True) == "True"
    assert log_value("plain") == "plain"
