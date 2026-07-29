"""
This is a Python port of the Aqua JavaScript code that aligns Greek and Latin tokens using Aqua scores.
Primary entry point: align_greek_latin(greek_tokens, latin_tokens, score_rows, score_type="threshold")
"""

import unicodedata
from typing import Any, Callable, Iterable

def normalize_token(token: str | None) -> str | None:
    """Normalize a token the same way Aqua's UI does before score lookup.

    Strips the special colon "꞉", leading/trailing punctuation, and lowercases.
    """
    if token is None:
        return None

    text = token.replace("꞉", "")

    def is_punct(ch: str) -> bool:
        return unicodedata.category(ch).startswith("P")

    while text and is_punct(text[0]):
        text = text[1:]
    while text and is_punct(text[-1]):
        text = text[:-1]
    return text.lower()


def positional_distance(
    greek_index: int,
    latin_index: int,
    greek_count: int,
    latin_count: int,
) -> float:
    """Relative positional distance between greek index i and latin index j."""
    return abs(latin_index / latin_count - greek_index / greek_count)


def unique_by_key(
    candidates: Iterable[dict[str, Any]],
    key_fn: Callable[[dict[str, Any]], str],
    greek_count: int,
    latin_count: int,
) -> list[dict[str, Any]]:
    """Keep one candidate per key, preferring the smaller positional distance."""
    best: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        key = key_fn(candidate)
        previous = best.get(key)
        if previous is None or positional_distance(
            candidate["greek_index"],
            candidate["latin_index"],
            greek_count,
            latin_count,
        ) < positional_distance(
            previous["greek_index"],
            previous["latin_index"],
            greek_count,
            latin_count,
        ):
            best[key] = candidate
    return list(best.values())


def find_score(
    normalized_scores: list[dict[str, Any]],
    source_norm: str | None,
    target_norm: str | None,
) -> float | None:
    """Look up the Aqua score for a normalized (source, target) pair.
    First matching row wins.
    """
    for entry in normalized_scores:
        if entry["source"] == source_norm and entry["target"] == target_norm:
            return entry["score"]
    return None


def aqua_browser_align(
    greek_tokens: list[str],
    latin_tokens: list[str],
    score_rows: list[dict[str, Any]],
    score_type: str = "threshold",
) -> list[dict[str, Any]]:
    """Align Greek (reference) tokens to Latin (revision) tokens using Aqua scores.
    Returns dicts with greek_index, latin_index, greek, latin, score, weight.
    """
    normalized_scores = [
        {
            "source": normalize_token(row["source"]),
            "target": normalize_token(row["target"]),
            "score": row["score"],
        }
        for row in score_rows
    ]

    is_threshold = score_type == "threshold"
    score_cutoff = 0.3 if is_threshold else 0.15

    def normalize_weight(score: float) -> float:
        if is_threshold:
            return max(0.0, min(1.0, (score - 0.3) / 0.7))
        return score

    greek_count = len(greek_tokens)
    latin_count = len(latin_tokens)
    pairs: list[dict[str, Any]] = []

    if is_threshold:
        candidates: list[dict[str, Any]] = []
        for greek_index, greek_word in enumerate(greek_tokens):
            greek_norm = normalize_token(greek_word)
            for latin_index, latin_word in enumerate(latin_tokens):
                latin_norm = normalize_token(latin_word)
                score = find_score(normalized_scores, greek_norm, latin_norm)
                if score is not None and score > score_cutoff:
                    candidates.append(
                        {
                            "greek_index": greek_index,
                            "latin_index": latin_index,
                            "greek_norm": greek_norm,
                            "latin_norm": latin_norm,
                            "score": score,
                        }
                    )

        after_greek_slots = unique_by_key(
            candidates,
            lambda c: f"{c['greek_index']}|{c['latin_norm']}",
            greek_count,
            latin_count,
        )
        final_candidates = unique_by_key(
            after_greek_slots,
            lambda c: f"{c['greek_norm']}|{c['latin_index']}",
            greek_count,
            latin_count,
        )

        for candidate in final_candidates:
            pairs.append(
                {
                    "latin_index": candidate["latin_index"],
                    "greek_index": candidate["greek_index"],
                    "greek": greek_tokens[candidate["greek_index"]],
                    "latin": latin_tokens[candidate["latin_index"]],
                    "score": candidate["score"],
                    "weight": normalize_weight(candidate["score"]),
                }
            )
    else:
        for greek_index, greek_word in enumerate(greek_tokens):
            greek_norm = normalize_token(greek_word)
            latin_candidates = []
            for latin_index, latin_word in enumerate(latin_tokens):
                latin_norm = normalize_token(latin_word)
                score = find_score(normalized_scores, greek_norm, latin_norm)
                if score is not None and score > score_cutoff:
                    latin_candidates.append(
                        {"latin_index": latin_index, "score": score}
                    )

            if not latin_candidates:
                continue

            best = min(
                latin_candidates,
                key=lambda c: positional_distance(
                    greek_index,
                    c["latin_index"],
                    greek_count,
                    latin_count,
                ),
            )
            pairs.append(
                {
                    "latin_index": best["latin_index"],
                    "greek_index": greek_index,
                    "greek": greek_word,
                    "latin": latin_tokens[best["latin_index"]],
                    "score": best["score"],
                    "weight": best["score"],
                }
            )

    pairs.sort(key=lambda p: (p["latin_index"], p["greek_index"]))

    # Turn into dictionary, with the latin index as the key and value as a dictionary of greek index and score
    pair_dict = dict()
    for item in pairs:
        if item["latin_index"] not in pair_dict:
            pair_dict[item["latin_index"]] = {}
        pair_dict[item["latin_index"]].update({item["greek_index"]: item["score"]})
    return pair_dict
