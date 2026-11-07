"""Neutralise user- or upstream-controlled values before they reach a log line.

Repository slugs, branch names and GitHub error messages come from outside the process. Escaping
CR/LF prevents a crafted value from forging extra log records in plain-text (development) logs;
production logs are JSON and already escape them.
"""


def log_value(value: object) -> str:
    text = repr(value) if isinstance(value, BaseException) else str(value)
    return text.replace("\r", "\\r").replace("\n", "\\n")
