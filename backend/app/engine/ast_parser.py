"""Multi-language import/export extraction.

Python files are parsed with the stdlib `ast` module; JS/JSX/TS/TSX with tree-sitter.
A syntax error in one file must never abort an analysis: return a `ParsedFile` with
`parse_warning` set and whatever could be recovered.

Imports are returned in source order; exports, functions and classes in first-seen source order
(deduplicated). Everything is derived from the input text only, so output is deterministic.
"""

import ast
import posixpath
import re
import threading

import tree_sitter
import tree_sitter_javascript
import tree_sitter_typescript
from tree_sitter import Node, Parser

from app.engine.types import ImportKind, ImportRef, Language, ParsedFile

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

_LANGUAGES: dict[str, tree_sitter.Language] = {
    "javascript": tree_sitter.Language(tree_sitter_javascript.language()),
    "typescript": tree_sitter.Language(tree_sitter_typescript.language_typescript()),
    "tsx": tree_sitter.Language(tree_sitter_typescript.language_tsx()),
}
# Parsers are stateful and not thread-safe; analyses run in worker threads concurrently
# (background worker + inline drift sync), so each thread gets its own parser set.
_local = threading.local()


def _parser(grammar: str) -> Parser:
    parsers: dict[str, Parser] | None = getattr(_local, "parsers", None)
    if parsers is None:
        parsers = _local.parsers = {k: Parser(v) for k, v in _LANGUAGES.items()}
    return parsers[grammar]


_GRAMMAR_BY_EXTENSION: dict[str, str] = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
}


def _extension(path: str) -> str:
    return posixpath.splitext(path)[1].lower()


def detect_language(path: str) -> Language | None:
    return SUPPORTED_EXTENSIONS.get(_extension(path))


def count_lines(source: str) -> int:
    """Number of lines; a trailing newline does not start a new line, "" has 0 lines."""
    if not source:
        return 0
    return source.count("\n") + (0 if source.endswith("\n") else 1)


def parse_file(path: str, source: str) -> ParsedFile:
    """Raises ValueError for unsupported extensions; never raises on invalid source code."""
    language = detect_language(path)
    if language is None:
        raise ValueError(f"Unsupported file type: {path}")
    parsed = ParsedFile(path=path, language=language, loc=count_lines(source))
    if language is Language.PYTHON:
        _parse_python(source, parsed)
    else:
        _parse_js(source, _GRAMMAR_BY_EXTENSION[_extension(path)], parsed)
    return parsed


def _append_unique(items: list[str], name: str) -> None:
    if name not in items:
        items.append(name)


# --------------------------------------------------------------------------------------------
# Python
# --------------------------------------------------------------------------------------------

_PY_IMPORT_RE = re.compile(r"^\s*import\s+(.+)$")
_PY_FROM_RE = re.compile(r"^\s*from\s+(\.*[\w.]*)\s+import\s+(.+)$")
_IDENT_RE = re.compile(r"[A-Za-z_*][\w.]*")


def _is_type_checking(test: ast.expr) -> bool:
    if isinstance(test, ast.Attribute):
        return test.attr == "TYPE_CHECKING"
    return isinstance(test, ast.Name) and test.id == "TYPE_CHECKING"


def _parse_python(source: str, parsed: ParsedFile) -> None:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        parsed.parse_warning = f"SyntaxError line {exc.lineno or 1}: {exc.msg}"
        parsed.imports = _scan_python_imports(source)
        return
    except (ValueError, RecursionError, MemoryError) as exc:
        parsed.parse_warning = f"{type(exc).__name__}: {exc}"
        parsed.imports = _scan_python_imports(source)
        return

    stack: list[tuple[ast.AST, bool]] = [(node, False) for node in reversed(tree.body)]
    while stack:
        node, type_only = stack.pop()
        kind = ImportKind.TYPE_ONLY if type_only else ImportKind.STATIC
        if isinstance(node, ast.Import):
            parsed.imports.extend(ImportRef(a.name, kind, node.lineno) for a in node.names)
            continue
        if isinstance(node, ast.ImportFrom):
            specifier = "." * node.level + (node.module or "")
            names = tuple(a.name for a in node.names)
            parsed.imports.append(ImportRef(specifier, kind, node.lineno, names))
            continue
        children: list[tuple[ast.AST, bool]] = []
        if isinstance(node, ast.If) and _is_type_checking(node.test):
            children.extend((child, True) for child in node.body)
            children.extend((child, type_only) for child in node.orelse)
        else:
            children.extend(
                (child, type_only)
                for child in ast.iter_child_nodes(node)
                if isinstance(child, ast.stmt | ast.excepthandler | ast.match_case)
            )
        stack.extend(reversed(children))

    explicit_all: list[str] | None = None
    public: list[str] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            _append_unique(parsed.functions, node.name)
            _append_unique(public, node.name)
        elif isinstance(node, ast.ClassDef):
            _append_unique(parsed.classes, node.name)
            _append_unique(public, node.name)
        elif isinstance(node, ast.Assign | ast.AnnAssign | ast.AugAssign):
            for name in _assigned_names(node):
                if name != "__all__":
                    _append_unique(public, name)
                    continue
                literal = _literal_names(node.value)
                if literal is None:
                    continue
                if isinstance(node, ast.AugAssign) and explicit_all is not None:
                    explicit_all.extend(literal)
                else:
                    explicit_all = literal
    if explicit_all is not None:
        for name in explicit_all:
            _append_unique(parsed.exports, name)
    else:
        for name in public:
            if not name.startswith("_"):
                _append_unique(parsed.exports, name)


def _assigned_names(node: ast.Assign | ast.AnnAssign | ast.AugAssign) -> list[str]:
    """Plain names bound by an assignment (tuple/list unpacking included, attributes ignored)."""
    targets: list[ast.expr] = node.targets if isinstance(node, ast.Assign) else [node.target]
    stack = list(reversed(targets))
    names: list[str] = []
    while stack:
        target = stack.pop()
        if isinstance(target, ast.Name):
            names.append(target.id)
        elif isinstance(target, ast.Tuple | ast.List):
            stack.extend(reversed(target.elts))
        elif isinstance(target, ast.Starred):
            stack.append(target.value)
    return names


def _literal_names(value: ast.expr | None) -> list[str] | None:
    if not isinstance(value, ast.List | ast.Tuple):
        return None
    names = [e.value for e in value.elts if isinstance(e, ast.Constant)]
    if len(names) != len(value.elts) or not all(isinstance(n, str) for n in names):
        return None
    return [str(n) for n in names]


def _scan_python_imports(source: str) -> list[ImportRef]:
    """Line-based fallback used when the file does not parse."""
    refs: list[ImportRef] = []
    for lineno, raw in enumerate(source.splitlines(), start=1):
        line = raw.split("#", 1)[0].rstrip().rstrip("\\")
        if match := _PY_FROM_RE.match(line):
            parts = match.group(2).strip("() ").split(",")
            names = [m.group(0) for p in parts if (m := _IDENT_RE.match(p.strip())) is not None]
            refs.append(ImportRef(match.group(1), ImportKind.STATIC, lineno, tuple(names)))
        elif match := _PY_IMPORT_RE.match(line):
            for part in match.group(1).split(","):
                ident = _IDENT_RE.match(part.strip())
                if ident is not None and ident.group(0) != "*":
                    refs.append(ImportRef(ident.group(0), ImportKind.STATIC, lineno))
    return refs


# --------------------------------------------------------------------------------------------
# JavaScript / TypeScript
# --------------------------------------------------------------------------------------------

_FUNCTION_VALUES = frozenset(
    {"arrow_function", "function_expression", "function", "generator_function"}
)
_CLASS_DECLS = frozenset({"class_declaration", "abstract_class_declaration"})
_FUNCTION_DECLS = frozenset(
    {"function_declaration", "generator_function_declaration", "function_signature"}
)
_NAMED_DECLS = frozenset(
    {
        "interface_declaration",
        "type_alias_declaration",
        "enum_declaration",
        "module",
        "internal_module",
    }
)


def _text(node: Node | None) -> str:
    text = node.text if node is not None else None
    return text.decode("utf-8", errors="replace") if text is not None else ""


def _line(node: Node) -> int:
    return node.start_point.row + 1


def _string_value(node: Node | None) -> str | None:
    """Value of a string literal, or of a template literal without substitutions."""
    if node is None:
        return None
    if node.type == "string":
        return _text(node)[1:-1]
    if node.type == "template_string" and not any(
        c.type == "template_substitution" for c in node.named_children
    ):
        return _text(node)[1:-1]
    return None


def _has_type_keyword(node: Node) -> bool:
    return any(child.type == "type" for child in node.children)


def _first_error(root: Node) -> Node | None:
    stack = [root]
    while stack:
        node = stack.pop()
        if node.is_error or node.is_missing:
            return node
        stack.extend(reversed([c for c in node.children if c.has_error or c.is_missing]))
    return None


def _parse_js(source: str, grammar: str, parsed: ParsedFile) -> None:
    tree = _parser(grammar).parse(source.encode("utf-8", errors="surrogatepass"))
    root = tree.root_node
    if root.has_error:
        error = _first_error(root)
        if error is not None and error.is_missing:
            parsed.parse_warning = f"Syntax error line {_line(error)}: missing {error.type}"
        else:
            line = _line(error) if error is not None else 1
            parsed.parse_warning = f"Syntax error line {line}: unexpected token"

    for statement in root.named_children:
        if statement.type == "import_statement":
            _js_import_statement(statement, parsed)
        elif statement.type == "export_statement":
            _js_export_statement(statement, parsed)
        else:
            _js_declaration(statement, parsed, exported=False)
    _js_calls(root, parsed)


def _js_import_statement(node: Node, parsed: ParsedFile) -> None:
    source = _string_value(node.child_by_field_name("source"))
    if source is None:
        # TypeScript `import x = require("y")`
        for child in node.named_children:
            if child.type == "import_require_clause":
                source = _string_value(
                    child.child_by_field_name("source")
                    or next((c for c in child.named_children if c.type == "string"), None)
                )
        if source is not None:
            parsed.imports.append(ImportRef(source, ImportKind.REQUIRE, _line(node)))
        return
    names: list[str] = []
    type_flags: list[bool] = []
    clause = next((c for c in node.named_children if c.type == "import_clause"), None)
    for part in clause.named_children if clause is not None else []:
        if part.type == "identifier":
            names.append("default")
            type_flags.append(False)
        elif part.type == "namespace_import":
            names.append("*")
            type_flags.append(False)
        elif part.type == "named_imports":
            for spec in part.named_children:
                if spec.type == "import_specifier":
                    name = spec.child_by_field_name("name")
                    names.append(_string_value(name) or _text(name))
                    type_flags.append(_has_type_keyword(spec))
    type_only = _has_type_keyword(node) or (bool(type_flags) and all(type_flags))
    kind = ImportKind.TYPE_ONLY if type_only else ImportKind.STATIC
    parsed.imports.append(ImportRef(source, kind, _line(node), tuple(names)))


def _js_export_statement(node: Node, parsed: ParsedFile) -> None:
    source = _string_value(node.child_by_field_name("source"))
    is_default = any(child.type == "default" for child in node.children)
    declaration = node.child_by_field_name("declaration")
    if declaration is not None:
        _js_declaration(declaration, parsed, exported=not is_default)
    if is_default:
        _append_unique(parsed.exports, "default")
        value = node.child_by_field_name("value")
        value_name = _text(value.child_by_field_name("name")) if value is not None else ""
        if value is not None and value_name and value.type in _FUNCTION_VALUES:
            _append_unique(parsed.functions, value_name)
        elif value is not None and value_name and value.type == "class":
            _append_unique(parsed.classes, value_name)
    imported: list[str] = []
    for child in node.named_children:
        if child.type == "export_clause":
            for spec in child.named_children:
                if spec.type != "export_specifier":
                    continue
                name_node = spec.child_by_field_name("name")
                alias_node = spec.child_by_field_name("alias")
                name = _string_value(name_node) or _text(name_node)
                alias = (_string_value(alias_node) or _text(alias_node)) if alias_node else name
                imported.append(name)
                _append_unique(parsed.exports, alias)
        elif child.type == "namespace_export":
            imported.append("*")
            alias_node = next(iter(child.named_children), None)
            if alias_node is not None:
                _append_unique(parsed.exports, _string_value(alias_node) or _text(alias_node))
    if source is None:
        return
    if not imported:  # export * from "x"
        imported.append("*")
    kind = ImportKind.TYPE_ONLY if _has_type_keyword(node) else ImportKind.REEXPORT
    parsed.imports.append(ImportRef(source, kind, _line(node), tuple(imported)))


def _js_declaration(node: Node, parsed: ParsedFile, *, exported: bool) -> None:
    if node.type == "ambient_declaration":  # `declare function f(): void;`
        for child in node.named_children:
            _js_declaration(child, parsed, exported=exported)
        return
    name = _text(node.child_by_field_name("name"))
    if node.type in _FUNCTION_DECLS and name:
        _append_unique(parsed.functions, name)
    elif node.type in _CLASS_DECLS and name:
        _append_unique(parsed.classes, name)
    elif node.type in {"lexical_declaration", "variable_declaration"}:
        for declarator in node.named_children:
            if declarator.type != "variable_declarator":
                continue
            target = declarator.child_by_field_name("name")
            value = declarator.child_by_field_name("value")
            if target is None or target.type != "identifier":
                continue
            var_name = _text(target)
            if value is not None and value.type in _FUNCTION_VALUES:
                _append_unique(parsed.functions, var_name)
            elif value is not None and value.type == "class":
                _append_unique(parsed.classes, var_name)
            if exported:
                _append_unique(parsed.exports, var_name)
        return
    elif node.type not in _NAMED_DECLS:
        return
    if exported and name:
        _append_unique(parsed.exports, name)


def _js_calls(root: Node, parsed: ParsedFile) -> None:
    """Find dynamic `import("x")` and `require("x")` calls anywhere in the tree."""
    found: list[ImportRef] = []
    stack = [root]
    while stack:
        node = stack.pop()
        if node.type == "call_expression":
            function = node.child_by_field_name("function")
            arguments = node.child_by_field_name("arguments")
            kind: ImportKind | None = None
            if function is not None and function.type == "import":
                kind = ImportKind.DYNAMIC
            elif function is not None and function.type == "identifier":
                kind = ImportKind.REQUIRE if _text(function) == "require" else None
            if kind is not None and arguments is not None and arguments.named_children:
                specifier = _string_value(arguments.named_children[0])
                if specifier is not None:
                    found.append(ImportRef(specifier, kind, _line(node)))
        stack.extend(reversed(node.named_children))
    if found:
        parsed.imports = sorted([*parsed.imports, *found], key=lambda r: r.line)
