"""Self-healing documentation drift detection for tour steps.

Algorithm for `evaluate_step(anchor, new_content)`:
1. new_content is None -> BROKEN_FILE_DELETED.
2. Lines start..end of new file hash to anchor.snippet_hash -> HEALTHY (same lines).
3. Sliding window of the same length over the normalized new file; exact normalized matches
   -> DRIFTED_AUTO_FIXED at the match nearest to the original start_line (ties: earliest).
4. Otherwise the code itself changed -> OUTDATED_NEEDS_REVIEW. Find the best fuzzy window
   (difflib.SequenceMatcher ratio over normalized text; window lengths n-2..n+2). If its
   similarity >= AUTO_FIX_THRESHOLD report that window as the proposed location, else report the
   original range clamped to the new file length. Always attach a unified diff
   snapshot -> current for the UI's side-by-side review.

Implementation notes:
- Fuzzy candidates are bounded so cost is independent of file length (a 5k-line file evaluates
  well under a second): window starts within NEIGHBOURHOOD_LINES of the original start, plus
  the MAX_ALIGNMENTS start offsets most supported by unchanged (normalized-equal) lines anywhere
  in the file. A block that both moved far away *and* had every line edited is therefore not
  re-located (it is reported at the clamped original range for review — the safe outcome).
- Windows whose `real_quick_ratio` / `quick_ratio` upper bound is below AUTO_FIX_THRESHOLD are
  discarded; the rest get the expensive `ratio` in descending-bound order (branch and bound,
  at most MAX_RATIO_EVALUATIONS calls). Equal ratios resolve to the window nearest the
  original start, then earliest, then closest in length.
- When no window reaches the threshold, `similarity` describes the reported (clamped original)
  range so it always matches `current_snippet`.
- An empty new file yields OUTDATED_NEEDS_REVIEW with no location, similarity 0 and a diff
  against the empty file.
"""

import difflib
import hashlib
from collections import Counter

from app.engine.types import DriftResult, DriftStatus, StepAnchor

AUTO_FIX_THRESHOLD = 0.75
FUZZY_LENGTH_SLACK = 2  # fuzzy windows span n - slack .. n + slack lines
NEIGHBOURHOOD_LINES = 25  # fuzzy starts always scored within +/- this of the original start
MAX_ALIGNMENTS = 8  # best line-vote alignments scored anywhere in the file
MAX_RATIO_EVALUATIONS = 64  # cap on full SequenceMatcher.ratio() calls per step


def normalize_lines(lines: list[str]) -> list[str]:
    """Strip each line and collapse internal whitespace runs to one space. Blank lines kept."""
    return [" ".join(line.split()) for line in lines]


def snippet_hash(snippet: str) -> str:
    """sha256 hex of "\\n".join(normalize_lines(snippet.splitlines()))."""
    normalized = "\n".join(normalize_lines(snippet.splitlines()))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def extract_lines(content: str, start_line: int, end_line: int) -> str:
    """1-based inclusive slice joined with "\\n". Raises ValueError for an invalid range."""
    lines = content.splitlines()
    if not 1 <= start_line <= end_line <= len(lines):
        raise ValueError(
            f"invalid line range {start_line}-{end_line} for content with {len(lines)} lines"
        )
    return "\n".join(lines[start_line - 1 : end_line])


def _diff(anchor: StepAnchor, current: list[str], start: int | None, end: int | None) -> str:
    location = f"L{start}-{end}" if start is not None else "L0-0"
    return "\n".join(
        difflib.unified_diff(
            anchor.snippet_snapshot.splitlines(),
            current,
            fromfile=f"a/{anchor.file_path}@L{anchor.start_line}-{anchor.end_line}",
            tofile=f"b/{anchor.file_path}@{location}",
            lineterm="",
        )
    )


def _exact_match(norm: list[str], target: list[str], original: int) -> int | None:
    """0-based start of the exact normalized match nearest to `original` (ties: earliest)."""
    n = len(target)
    matches = [
        i for i in range(len(norm) - n + 1) if norm[i] == target[0] and norm[i : i + n] == target
    ]
    return min(matches, key=lambda i: (abs(i - original), i)) if matches else None


def _candidate_starts(norm: list[str], target: list[str], original: int) -> set[int]:
    """Window starts worth scoring: the neighbourhood of the original location plus the
    alignments best supported by unchanged lines (each equal line votes for `pos - offset`)."""
    wanted: dict[str, list[int]] = {}
    for offset, line in enumerate(target):
        if line:
            wanted.setdefault(line, []).append(offset)
    votes: Counter[int] = Counter()
    for pos, line in enumerate(norm):
        for offset in wanted.get(line, ()):
            votes[pos - offset] += 1
    anchors = sorted(votes, key=lambda s: (-votes[s], abs(s - original), s))[:MAX_ALIGNMENTS]
    starts = set(range(original - NEIGHBOURHOOD_LINES, original + NEIGHBOURHOOD_LINES + 1))
    for anchor in anchors:
        starts.update(range(anchor - FUZZY_LENGTH_SLACK, anchor + FUZZY_LENGTH_SLACK + 1))
    return {s for s in starts if 0 <= s < len(norm)}


def _best_fuzzy(norm: list[str], target: list[str], original: int) -> tuple[int, int, float]:
    """Best (start, length, ratio) window with ratio >= AUTO_FIX_THRESHOLD, or ratio 0."""
    n = len(target)
    lengths = range(max(1, n - FUZZY_LENGTH_SLACK), n + FUZZY_LENGTH_SLACK + 1)
    matcher = difflib.SequenceMatcher(None, autojunk=False)
    matcher.set_seq2("\n".join(target))  # seq2 analysis is cached across set_seq1 calls

    # Stage 1: cheap upper bounds; keep windows that could still reach the threshold.
    bounded: list[tuple[float, int, int, int, int]] = []
    for start in _candidate_starts(norm, target, original):
        for length in lengths:
            if start + length > len(norm):
                continue
            matcher.set_seq1("\n".join(norm[start : start + length]))
            if matcher.real_quick_ratio() < AUTO_FIX_THRESHOLD:
                continue
            bound = matcher.quick_ratio()
            if bound >= AUTO_FIX_THRESHOLD:
                bounded.append((-bound, abs(start - original), start, abs(length - n), length))

    # Stage 2: exact ratio in descending-bound order (branch and bound, capped).
    bounded.sort()
    best: tuple[float, int, int, int, int] | None = None  # (-ratio, distance, start, ...)
    for neg_bound, distance, start, length_gap, length in bounded[:MAX_RATIO_EVALUATIONS]:
        if best is not None and -neg_bound < -best[0]:
            break  # no remaining window can beat the current best
        matcher.set_seq1("\n".join(norm[start : start + length]))
        ratio = matcher.ratio()
        key = (-ratio, distance, start, length_gap, length)
        if ratio >= AUTO_FIX_THRESHOLD and (best is None or key < best):
            best = key
    return (best[2], best[4], -best[0]) if best is not None else (0, 0, 0.0)


def evaluate_step(anchor: StepAnchor, new_content: str | None) -> DriftResult:
    if new_content is None:
        return DriftResult(DriftStatus.BROKEN_FILE_DELETED, None, None, 0.0, None, None)

    lines = new_content.splitlines()
    if not lines:
        diff = _diff(anchor, [], None, None)
        return DriftResult(DriftStatus.OUTDATED_NEEDS_REVIEW, None, None, 0.0, "", diff)

    start, end = anchor.start_line, anchor.end_line
    if 1 <= start <= end <= len(lines):
        current = "\n".join(lines[start - 1 : end])
        if snippet_hash(current) == anchor.snippet_hash:
            return DriftResult(DriftStatus.HEALTHY, start, end, 1.0, current, None)

    norm = normalize_lines(lines)
    target = normalize_lines(anchor.snippet_snapshot.splitlines()) or [""]
    original = max(start - 1, 0)

    match = _exact_match(norm, target, original)
    if match is not None:
        new_start, new_end = match + 1, match + len(target)
        snippet = "\n".join(lines[match:new_end])
        return DriftResult(DriftStatus.DRIFTED_AUTO_FIXED, new_start, new_end, 1.0, snippet, None)

    best_start, best_length, similarity = _best_fuzzy(norm, target, original)
    if similarity >= AUTO_FIX_THRESHOLD:
        new_start, new_end = best_start + 1, best_start + best_length
    else:
        new_end = min(max(end, 1), len(lines))
        new_start = min(max(start, 1), new_end)
        similarity = difflib.SequenceMatcher(
            None, "\n".join(norm[new_start - 1 : new_end]), "\n".join(target), autojunk=False
        ).ratio()
    current_lines = lines[new_start - 1 : new_end]
    return DriftResult(
        status=DriftStatus.OUTDATED_NEEDS_REVIEW,
        start_line=new_start,
        end_line=new_end,
        similarity=round(similarity, 4),
        current_snippet="\n".join(current_lines),
        unified_diff=_diff(anchor, current_lines, new_start, new_end),
    )
