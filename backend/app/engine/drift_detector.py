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
"""

from app.engine.types import DriftResult, StepAnchor

AUTO_FIX_THRESHOLD = 0.75


def normalize_lines(lines: list[str]) -> list[str]:
    """Strip each line and collapse internal whitespace runs to one space. Blank lines kept."""
    raise NotImplementedError


def snippet_hash(snippet: str) -> str:
    """sha256 hex of "\\n".join(normalize_lines(snippet.splitlines()))."""
    raise NotImplementedError


def extract_lines(content: str, start_line: int, end_line: int) -> str:
    """1-based inclusive slice joined with "\\n". Raises ValueError for an invalid range."""
    raise NotImplementedError


def evaluate_step(anchor: StepAnchor, new_content: str | None) -> DriftResult:
    raise NotImplementedError
