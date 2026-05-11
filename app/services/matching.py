from re import findall

from app.models.job import Job
from app.schemas.vacancy import VacancyCreate


SPELLING_CORRECTIONS = {
    "artifical": "artificial",
    "bekend": "backend",
    "devloper": "developer",
    "developper": "developer",
    "fullstak": "full stack",
    "fullstack": "full stack",
    "inteligence": "intelligence",
    "javasript": "javascript",
    "javscript": "javascript",
    "machin": "machine",
    "pyton": "python",
    "pythn": "python",
    "reactjs": "react",
    "recat": "react",
    "uniti": "unity",
}

PHRASE_COLLAPSES = {
    "artificial intelligence": "ai",
    "machine learning": "ml",
}

TOKEN_ALIASES = {
    "ai": [
        "ai",
        "artificial intelligence",
        "machine learning",
        "ml",
        "llm",
        "genai",
        "openai",
        "computer vision",
        "nlp",
    ],
    "backend": ["backend", "back end", "server side"],
    "frontend": ["frontend", "front end", "client side"],
    "full": ["full", "full stack", "fullstack"],
    "stack": ["stack", "full stack", "fullstack"],
    "js": ["javascript", "typescript", "node", "node.js"],
    "ml": ["ml", "machine learning", "ai", "artificial intelligence"],
    "node": ["node", "node.js", "nodejs"],
    "qa": ["qa", "quality assurance", "test automation", "automation tester"],
    "react": ["react", "react.js", "reactjs", "next", "next.js", "frontend"],
    "unity": ["unity", "unity3d", "game developer", "game development"],
}

SCRAPE_EXPANSIONS = {
    "ai": ["ai", "artificial intelligence", "machine learning", "llm"],
    "ml": ["machine learning", "ml", "ai"],
    "qa": ["qa", "automation qa", "test automation"],
}


def normalize_query(query: str, collapse_phrases: bool = True) -> str:
    words = []
    for token in findall(r"[\w+#.]+", query.lower().replace("-", " ")):
        replacement = SPELLING_CORRECTIONS.get(token, token)
        words.extend(replacement.split())
    normalized = " ".join(words)
    if collapse_phrases:
        for phrase, replacement in PHRASE_COLLAPSES.items():
            normalized = normalized.replace(phrase, replacement)
    return normalized


def query_tokens(query: str, collapse_phrases: bool = True) -> list[str]:
    return [token for token in normalize_query(query, collapse_phrases=collapse_phrases).split() if len(token) > 1]


def query_variants(query: str) -> list[str]:
    normalized = normalize_query(query)
    tokens = query_tokens(query)
    variants = [normalized] if normalized else []

    if len(tokens) == 1:
        variants.extend(SCRAPE_EXPANSIONS.get(tokens[0], []))
        variants.extend(TOKEN_ALIASES.get(tokens[0], [])[:3])

    if tokens == ["full", "stack"]:
        variants.extend(["full stack", "fullstack"])

    deduped = []
    for variant in variants:
        if variant and variant not in deduped:
            deduped.append(variant)
    return deduped[:5] or [query]


def searchable_terms(query: str) -> set[str]:
    terms = set(query_tokens(query))
    for token in list(terms):
        for alias in TOKEN_ALIASES.get(token, []):
            terms.update(query_tokens(alias))
    return terms


def job_matches_query(job: Job | VacancyCreate, query: str) -> bool:
    tokens = query_tokens(query)
    if not tokens:
        return True

    words = _job_words(job)
    title_words = _title_words(job)
    if len(tokens) == 1 and tokens[0] not in {"ai", "ml", "qa"}:
        return _token_matches(tokens[0], title_words)
    return all(_token_matches(token, words) for token in tokens)


def _job_words(job: Job | VacancyCreate) -> set[str]:
    haystack = " ".join(
        [
            job.title or "",
            job.company_name or "",
            job.description or "",
        ]
    ).lower()
    return set(findall(r"[\w+#.]+", haystack.replace("-", " ")))


def _title_words(job: Job | VacancyCreate) -> set[str]:
    haystack = " ".join([job.title or "", job.company_name or ""]).lower()
    return set(findall(r"[\w+#.]+", haystack.replace("-", " ")))


def _token_matches(token: str, words: set[str]) -> bool:
    aliases = TOKEN_ALIASES.get(token, [token])
    for alias in aliases:
        alias_tokens = query_tokens(alias, collapse_phrases=False)
        if alias_tokens and all(_word_matches(alias_token, words) for alias_token in alias_tokens):
            return True
    return _word_matches(token, words)


def _word_matches(token: str, words: set[str]) -> bool:
    if token in words:
        return True
    if len(token) <= 2:
        return False
    return any(_levenshtein_is_close(token, word) for word in words if abs(len(word) - len(token)) <= 2)


def _levenshtein_is_close(left: str, right: str) -> bool:
    threshold = 1 if max(len(left), len(right)) <= 6 else 2
    if abs(len(left) - len(right)) > threshold:
        return False

    previous = list(range(len(right) + 1))
    for index_left, char_left in enumerate(left, start=1):
        current = [index_left]
        row_min = index_left
        for index_right, char_right in enumerate(right, start=1):
            cost = 0 if char_left == char_right else 1
            current.append(
                min(
                    previous[index_right] + 1,
                    current[index_right - 1] + 1,
                    previous[index_right - 1] + cost,
                )
            )
            row_min = min(row_min, current[-1])
        if row_min > threshold:
            return False
        previous = current

    return previous[-1] <= threshold
