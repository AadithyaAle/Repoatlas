import io
import tarfile

import pytest

from app.core.errors import AppError, ErrorCode
from app.services.github_service import Snapshot, extract_snapshot

PREFIX = "octo-repo-abc1234/"


def make_tar(
    files: dict[str, bytes],
    *,
    prefix: str = PREFIX,
    symlinks: dict[str, str] | None = None,
    hardlinks: dict[str, str] | None = None,
) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        top = tarfile.TarInfo(prefix.rstrip("/"))
        top.type = tarfile.DIRTYPE
        tf.addfile(top)
        for name, data in files.items():
            info = tarfile.TarInfo(name if name.startswith(("/", "..")) else prefix + name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
        for kind, links in ((tarfile.SYMTYPE, symlinks), (tarfile.LNKTYPE, hardlinks)):
            for name, target in (links or {}).items():
                info = tarfile.TarInfo(prefix + name)
                info.type = kind
                info.linkname = target
                tf.addfile(info)
    return buf.getvalue()


def extract(data: bytes, *, max_files: int = 100, max_file_bytes: int = 10_000) -> Snapshot:
    return extract_snapshot(data, max_files=max_files, max_file_bytes=max_file_bytes)


def test_strips_prefix_and_keeps_supported_sources() -> None:
    snap = extract(
        make_tar(
            {
                "src/a.ts": b"export const a = 1\n",
                "main.py": b"import os\n",
                "README.md": b"# hi",
                "web/App.jsx": b"export default 1",
                "lib/x.mjs": b"",
            }
        )
    )
    assert list(snap.sources) == ["lib/x.mjs", "main.py", "src/a.ts", "web/App.jsx"]
    assert snap.sources["src/a.ts"] == "export const a = 1\n"
    assert snap.total_source_files == 4
    assert not snap.truncated


def test_rejects_traversal_absolute_and_links() -> None:
    data = make_tar(
        {"ok.py": b"x = 1", "../evil.py": b"x", "/etc/abs.py": b"x", "a/../../up.py": b"x"},
        symlinks={"link.py": "/etc/passwd"},
        hardlinks={"hard.py": PREFIX + "ok.py"},
    )
    snap = extract(data)
    assert list(snap.sources) == ["ok.py"]


def test_skips_vendor_dirs_minified_and_declarations() -> None:
    files = {
        f"{d}/x.js": b"1"
        for d in ("node_modules/pkg", "dist", "build", ".next", "venv", "a/__pycache__", "vendor")
    }
    files |= {"app/app.min.js": b"1", "types/index.d.ts": b"1", "app/ok.ts": b"1"}
    snap = extract(make_tar(files))
    assert list(snap.sources) == ["app/ok.ts"]


def test_oversize_binary_and_non_utf8_are_recorded_as_skipped() -> None:
    snap = extract(
        make_tar(
            {
                "big.py": b"x" * 2_000,
                "latin.py": "café".encode("latin-1"),
                "nul.js": b"a\x00b",
                "ok.py": b"pass",
            }
        ),
        max_file_bytes=1_000,
    )
    assert list(snap.sources) == ["ok.py"]
    assert snap.skipped_files == ["big.py", "latin.py", "nul.js"]


def test_captures_config_files_outside_skipped_dirs() -> None:
    snap = extract(
        make_tar(
            {
                "tsconfig.json": b'{"compilerOptions": {}}',
                "packages/web/tsconfig.app.json": b"{}",
                "jsconfig.json": b"{}",
                "node_modules/x/tsconfig.json": b"{}",
                "index.ts": b"1",
            }
        )
    )
    assert list(snap.config_files) == [
        "jsconfig.json",
        "packages/web/tsconfig.app.json",
        "tsconfig.json",
    ]
    assert list(snap.sources) == ["index.ts"]


def test_prioritised_truncation_is_deterministic() -> None:
    files = {
        "z.py": b"1",
        "deep/a/b/c.py": b"1",
        "scripts/s.py": b"1",
        "src/deep/x/y.ts": b"1",
        "src/a.ts": b"1",
        "lib/b.js": b"1",
        "packages/core/src/index.ts": b"1",
        "packages/core/test/t.ts": b"1",
    }
    snap = extract(make_tar(files), max_files=4)
    assert snap.truncated
    assert snap.total_source_files == 8
    assert list(snap.sources) == [
        "lib/b.js",
        "packages/core/src/index.ts",
        "src/a.ts",
        "src/deep/x/y.ts",
    ]
    snap = extract(make_tar(files), max_files=5)
    assert "z.py" in snap.sources


def test_corrupt_archive_maps_to_github_unavailable() -> None:
    with pytest.raises(AppError) as exc:
        extract(b"not a tarball")
    assert exc.value.code == ErrorCode.GITHUB_UNAVAILABLE
