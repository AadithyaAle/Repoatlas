import hashlib
import random
import time

import pytest

from app.engine.drift_detector import (
    AUTO_FIX_THRESHOLD,
    evaluate_step,
    extract_lines,
    normalize_lines,
    snippet_hash,
)
from app.engine.types import DriftStatus, StepAnchor

PATH = "src/a.py"
WORDS = [
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "golf",
    "hotel",
    "india",
    "juliet",
    "kilo",
    "lima",
    "mike",
    "november",
    "oscar",
    "papa",
    "quebec",
    "romeo",
    "sierra",
    "tango",
    "uniform",
    "victor",
    "whiskey",
    "xray",
    "yankee",
    "zulu",
]
TEMPLATES = (
    "{a}_{b} = {c}.{d}({e}, {n})",
    "if {a} > {n}: return {b}({c})",
    "for {a} in {b}.{c}(): {d}.append({a})",
    "def {a}_{b}({c}, {d}={n}):",
    "class {A}{B}({C}):",
    "raise {A}Error('{b} {c} {n}')",
    "{a}[{n}] = await {b}_{c}()",
)


def make_lines(count: int, seed: int = 0) -> list[str]:
    rng = random.Random(seed)
    lines: list[str] = []
    for n in range(count):
        a, b, c, d, e = (rng.choice(WORDS) for _ in range(5))
        template = rng.choice(TEMPLATES)
        line = template.format(a=a, b=b, c=c, d=d, e=e, n=n, A=a.title(), B=b.title(), C=c.title())
        lines.append("    " * rng.randint(0, 2) + line)
    return lines


BASE = make_lines(40)


def anchor_for(lines: list[str], start: int, end: int) -> StepAnchor:
    snapshot = extract_lines("\n".join(lines), start, end)
    return StepAnchor(PATH, start, end, snippet_hash(snapshot), snapshot)


def evaluate(anchor: StepAnchor, lines: list[str]) -> tuple[DriftStatus, int | None, int | None]:
    result = evaluate_step(anchor, "\n".join(lines))
    return result.status, result.start_line, result.end_line


# --- helpers ---------------------------------------------------------------------------------


def test_normalize_lines() -> None:
    assert normalize_lines(["  a   b ", "", "\tc\t d", "   "]) == ["a b", "", "c d", ""]


def test_snippet_hash_is_whitespace_insensitive_sha256() -> None:
    expected = hashlib.sha256(b"a b\n\nc").hexdigest()
    assert snippet_hash("  a   b  \n\n\tc") == expected
    assert snippet_hash("a b\n\nc\n") == expected  # trailing newline does not add a line
    assert snippet_hash("a b\nc") != expected  # line structure is significant


def test_extract_lines() -> None:
    content = "a\nb\nc\n"
    assert extract_lines(content, 1, 3) == "a\nb\nc"
    assert extract_lines(content, 2, 2) == "b"


@pytest.mark.parametrize(
    ("content", "start", "end"),
    [("a\nb\nc", 0, 1), ("a\nb\nc", 2, 1), ("a\nb\nc", 1, 4), ("a\nb\nc", -1, 2), ("", 1, 1)],
)
def test_extract_lines_invalid_range(content: str, start: int, end: int) -> None:
    with pytest.raises(ValueError):
        extract_lines(content, start, end)


# --- evaluate_step -------------------------------------------------------------------------


def test_unchanged_is_healthy() -> None:
    anchor = anchor_for(BASE, 10, 14)
    result = evaluate_step(anchor, "\n".join(BASE))
    assert result.status is DriftStatus.HEALTHY
    assert (result.start_line, result.end_line, result.similarity) == (10, 14, 1.0)
    assert result.current_snippet == anchor.snippet_snapshot
    assert result.unified_diff is None


def test_whitespace_only_changes_stay_healthy() -> None:
    anchor = anchor_for(BASE, 10, 14)
    changed = BASE[:]
    changed[10] = "\t  " + changed[10].replace(" ", "   ") + "  \t"
    result = evaluate_step(anchor, "\n".join(changed))
    assert result.status is DriftStatus.HEALTHY
    assert (result.start_line, result.end_line) == (10, 14)
    assert result.current_snippet == "\n".join(changed[9:14])  # raw current lines


def test_shifted_down_is_auto_fixed() -> None:
    anchor = anchor_for(BASE, 10, 14)
    shifted = ["import os", "import sys", "", *BASE]
    result = evaluate_step(anchor, "\n".join(shifted))
    assert result.status is DriftStatus.DRIFTED_AUTO_FIXED
    assert (result.start_line, result.end_line, result.similarity) == (13, 17, 1.0)
    assert result.current_snippet == anchor.snippet_snapshot
    assert result.unified_diff is None


def test_shifted_up_is_auto_fixed() -> None:
    assert evaluate(anchor_for(BASE, 10, 14), BASE[4:]) == (DriftStatus.DRIFTED_AUTO_FIXED, 6, 10)


def test_shifted_with_whitespace_changes_is_auto_fixed() -> None:
    anchor = anchor_for(BASE, 10, 14)
    shifted = ["# header", *("  " + line + "   " for line in BASE)]
    result = evaluate_step(anchor, "\n".join(shifted))
    assert result.status is DriftStatus.DRIFTED_AUTO_FIXED
    assert (result.start_line, result.end_line) == (11, 15)
    assert result.current_snippet == "\n".join(shifted[10:15])


def test_duplicated_block_nearest_match_wins() -> None:
    anchor = anchor_for(BASE, 10, 14)
    block = BASE[9:14]
    content = ["# a", "# b", "# c", *BASE, *block]
    assert evaluate(anchor, content) == (DriftStatus.DRIFTED_AUTO_FIXED, 13, 17)


def test_duplicated_block_equidistant_prefers_earliest() -> None:
    block = BASE[20:25]
    snapshot = "\n".join(block)
    anchor = StepAnchor(PATH, 10, 14, snippet_hash(snapshot), snapshot)
    filler = make_lines(30, seed=5)
    content = [*filler[:6], *block, filler[6], *block, *filler[7:20]]  # block at 7 and 13
    assert evaluate(anchor, content) == (DriftStatus.DRIFTED_AUTO_FIXED, 7, 11)


def test_small_edit_proposes_new_location_for_review() -> None:
    anchor = anchor_for(BASE, 10, 14)
    changed = ["# one", "# two", *BASE]
    changed[13] = changed[13] + "  # tweaked"  # original line 12, now line 14
    result = evaluate_step(anchor, "\n".join(changed))
    assert result.status is DriftStatus.OUTDATED_NEEDS_REVIEW
    assert (result.start_line, result.end_line) == (12, 16)
    assert AUTO_FIX_THRESHOLD <= result.similarity < 1.0
    assert result.similarity == round(result.similarity, 4)
    assert result.current_snippet == "\n".join(changed[11:16])
    assert result.unified_diff is not None
    diff = result.unified_diff.splitlines()
    assert diff[0] == f"--- a/{PATH}@L10-14"
    assert diff[1] == f"+++ b/{PATH}@L12-16"
    assert f"-{BASE[11]}" in diff
    assert f"+{changed[13]}" in diff


def test_deleted_line_proposes_shorter_window() -> None:
    anchor = anchor_for(BASE, 10, 14)
    changed = ["# moved", *BASE[:11], *BASE[12:]]  # drop original line 12, shift by one
    result = evaluate_step(anchor, "\n".join(changed))
    assert result.status is DriftStatus.OUTDATED_NEEDS_REVIEW
    assert result.start_line == 11
    assert result.end_line in {14, 15}
    assert result.similarity >= AUTO_FIX_THRESHOLD


def test_heavy_rewrite_reports_original_range() -> None:
    anchor = anchor_for(BASE, 10, 14)
    rewritten = ["raise NotImplementedError", "pass", "# TODO", "x = 1", "return None"]
    changed = BASE[:9] + rewritten + BASE[14:]
    result = evaluate_step(anchor, "\n".join(changed))
    assert result.status is DriftStatus.OUTDATED_NEEDS_REVIEW
    assert (result.start_line, result.end_line) == (10, 14)
    assert result.similarity < AUTO_FIX_THRESHOLD
    assert result.current_snippet == "\n".join(rewritten)
    assert result.unified_diff is not None
    assert "+raise NotImplementedError" in result.unified_diff.splitlines()


def test_rewrite_in_truncated_file_clamps_range() -> None:
    anchor = anchor_for(BASE, 10, 14)
    result = evaluate_step(anchor, "totally\ndifferent\ncontent here")
    assert result.status is DriftStatus.OUTDATED_NEEDS_REVIEW
    assert (result.start_line, result.end_line) == (3, 3)
    assert result.current_snippet == "content here"
    assert result.unified_diff is not None


def test_deleted_file_is_broken() -> None:
    result = evaluate_step(anchor_for(BASE, 10, 14), None)
    assert result.status is DriftStatus.BROKEN_FILE_DELETED
    assert (result.start_line, result.end_line, result.similarity) == (None, None, 0.0)
    assert result.current_snippet is None and result.unified_diff is None


def test_empty_file_needs_review_without_location() -> None:
    result = evaluate_step(anchor_for(BASE, 10, 14), "")
    assert result.status is DriftStatus.OUTDATED_NEEDS_REVIEW
    assert (result.start_line, result.end_line, result.similarity) == (None, None, 0.0)
    assert result.unified_diff is not None
    assert result.unified_diff.startswith(f"--- a/{PATH}@L10-14")


def test_evaluation_is_deterministic() -> None:
    anchor = anchor_for(BASE, 10, 14)
    changed = ["# x", *BASE]
    changed[12] = "value = 42"
    assert evaluate_step(anchor, "\n".join(changed)) == evaluate_step(anchor, "\n".join(changed))


# --- performance -----------------------------------------------------------------------------

BIG = make_lines(5000, seed=1)
BIG_ANCHOR = anchor_for(BIG, 2501, 2512)


def _move_to_end(block: list[str]) -> list[str]:
    return BIG[:2500] + BIG[2512:] + block


EDITED_BLOCK = BIG[2500:2512]
EDITED_BLOCK[5] += "  # edited"
REWRITTEN = BIG[:2500] + [f"x{i} = {i}" for i in range(12)] + BIG[2512:]


@pytest.mark.parametrize(
    ("name", "lines", "expected"),
    [
        ("unchanged", BIG, (DriftStatus.HEALTHY, 2501, 2512)),
        ("moved far", _move_to_end(BIG[2500:2512]), (DriftStatus.DRIFTED_AUTO_FIXED, 4989, 5000)),
        ("edited", _move_to_end(EDITED_BLOCK), (DriftStatus.OUTDATED_NEEDS_REVIEW, 4989, 5000)),
        ("heavy rewrite", REWRITTEN, (DriftStatus.OUTDATED_NEEDS_REVIEW, 2501, 2512)),
    ],
)
def test_large_file_is_fast(
    name: str, lines: list[str], expected: tuple[DriftStatus, int, int]
) -> None:
    content = "\n".join(lines)
    started = time.perf_counter()
    result = evaluate_step(BIG_ANCHOR, content)
    elapsed = time.perf_counter() - started
    assert (result.status, result.start_line, result.end_line) == expected, name
    assert elapsed < 1.0, f"{name} took {elapsed:.3f}s"
