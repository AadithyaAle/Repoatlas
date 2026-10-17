"""Multi-language import/export extraction.

Python files are parsed with the stdlib `ast` module; JS/JSX/TS/TSX with tree-sitter.
A syntax error in one file must never abort an analysis: return a `ParsedFile` with
`parse_warning` set and whatever could be recovered.
"""

from app.engine.types import Language, ParsedFile

SUPPORTED_EXTENSIONS: dict[str, Language] = {
    ".py": Language.PYTHON,
    ".js": Language.JAVASCRIPT,
    ".jsx": Language.JAVASCRIPT,
    ".mjs": Language.JAVASCRIPT,
    ".cjs": Language.JAVASCRIPT,
    ".ts": Language.TYPESCRIPT,
    ".tsx": Language.TYPESCRIPT,
    ".mts": Language.TYPESCRIPT,
    ".cts": Language.TYPESCRIPT,
}


def detect_language(path: str) -> Language | None:
    raise NotImplementedError


def parse_file(path: str, source: str) -> ParsedFile:
    raise NotImplementedError
