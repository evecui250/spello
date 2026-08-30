#!/usr/bin/env python3
"""One-time (re-runnable) batch pass adding a fixed/idiomatic preposition
note to Spello's vocabulary where one genuinely applies — see
lib/words.ts's `prepositionNote` field. A real request: clicking a word
like "Bahnhof" only ever showed the bare word/gloss, with no hint that
it's almost always used as "am Bahnhof", or that "erkundigen" governs
"über etw. (Akk.)". Most words have no such fixed usage worth flagging
(this deliberately skips those, rather than forcing a note onto every
entry), so results are sparse by design.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-preposition-notes.py
    OPENAI_API_KEY=sk-... python3 scripts/generate-preposition-notes.py --level B2

Resumable: re-running only fills in words still missing a result in
scripts/.preposition-notes-cache.json (gitignored) — safe to re-run after a
rate-limit/quota interruption, or after adding new words to lib/words.ts.
Once satisfied, bake results into lib/words.ts with
scripts/apply-preposition-notes.py.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.preposition-notes-cache.json')

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

BATCH_SIZE = 20

# Only nouns/verbs/adjectives can plausibly have a genuinely fixed
# preposition usage worth teaching — skips pronouns, conjunctions,
# prepositions themselves, etc. entirely rather than wasting calls on them.
RELEVANT_TYPES = {'noun', 'verb', 'adjective'}

ENTRY_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>\w+)',\s*de:\s*'(?P<de>(?:[^'\\]|\\.)*)'"
    r"(?:,\s*article:\s*'(?P<article>[^']*)')?.*?"
    r"en:\s*'(?P<en>(?:[^'\\]|\\.)*)'.*?"
    r"type:\s*'(?P<type>\w+)'.*?"
    r"level:\s*'(?P<level>\w+)'"
)


def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"')


def parse_words(level_filter=None):
    with open(WORDS_PATH, encoding='utf-8') as f:
        content = f.read()
    words = []
    for m in ENTRY_RE.finditer(content):
        if m.group('type') not in RELEVANT_TYPES:
            continue
        if level_filter and m.group('level') != level_filter:
            continue
        words.append({
            'id': m.group('id'),
            'de': unescape(m.group('de')),
            'article': m.group('article'),
            'en': unescape(m.group('en')),
            'type': m.group('type'),
        })
    return words


SYSTEM_PROMPT = (
    "You are a German pedagogy expert helping build a vocabulary app. You will get a JSON "
    "array of entries, each with an id, the German word (de), its word type (noun/verb/"
    "adjective), optional article, and its English gloss (en). For each entry, decide "
    "whether it has a genuinely FIXED, idiomatic preposition (and case, for a verb/"
    "adjective) that's actually worth teaching a learner -- NOT every word has one, and "
    "most don't. Include a result ONLY when one of these genuinely applies:\n"
    "- A place/location NOUN with a strongly-associated locational preposition (e.g. "
    '"Bahnhof" -> "am Bahnhof (at the train station)", "Schule" -> "in der Schule (at '
    'school)").\n'
    "- A VERB or ADJECTIVE with a governed preposition (Rektion) that a learner needs to "
    'memorize alongside the word (e.g. "erkundigen" -> "sich über etw. (Akk.) erkundigen '
    '(to inquire about sth.)", "warten" -> "warten auf etw./jmdn. (Akk.) (to wait for)", '
    '"stolz" -> "stolz auf etw./jmdn. (Akk.) (proud of)").\n'
    "Do NOT include a result for a word with no such fixed idiom (an ordinary concrete "
    'noun like "Tisch" or "Buch", a verb with no governed preposition, etc.) -- when in '
    "doubt, leave it out rather than force a weak/uncommon example. For each entry you DO "
    "include, return a short, self-contained \"note\": the German usage phrase, followed by "
    "a brief English gloss in parentheses -- e.g. \"am Bahnhof (at the train station)\".\n"
    'Respond with exactly this JSON: {"results": [{"id": "...", "note": "..."}, ...]}, '
    "including ONLY entries that genuinely qualify (omit every entry that doesn't, don't "
    "pad the array to match the input length)."
)


def call_openai(batch):
    payload = [
        {'id': w['id'], 'de': w['de'], 'type': w['type'], 'en': w['en'], **({'article': w['article']} if w['article'] else {})}
        for w in batch
    ]
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    body = {
        "model": "gpt-4o-mini", "response_format": {"type": "json_object"},
        "messages": messages, "temperature": 0.2, "max_tokens": 3000,
    }
    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(body).encode('utf-8'),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
    )
    rate_limit_retries = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                result = json.loads(resp.read())
            raw = result['choices'][0]['message']['content']
            parsed = json.loads(raw)
            results = parsed.get('results', [])
            by_id = {r['id']: r for r in results if 'id' in r and r.get('note')}
            return by_id, None
        except urllib.error.HTTPError as e:
            if e.code == 429 and rate_limit_retries < 8:
                rate_limit_retries += 1
                time.sleep(min(2 ** rate_limit_retries, 30))
                continue
            return {}, f"HTTP {e.code}: {e.read()[:300]}"
        except Exception as e:
            if rate_limit_retries < 3:
                rate_limit_retries += 1
                time.sleep(2)
                continue
            return {}, str(e)


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--level', help='only process this level (default: every level)')
    args = ap.parse_args()

    words = parse_words(args.level)
    print(f"{len(words)} noun/verb/adjective entries parsed" + (f" for level {args.level}" if args.level else ""), file=sys.stderr)

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)

    # A word already checked and found to have NO fixed usage is cached as
    # {"checked": true} (no "note") so re-runs don't keep re-asking about
    # the same ordinary words forever -- only words never checked at all
    # are re-sent.
    targets = [w for w in words if w['id'] not in results]
    print(f"{len(targets)} words need checking (resuming {len(words) - len(targets)} already checked)", file=sys.stderr)
    if not targets:
        return

    batches = list(chunks(targets, BATCH_SIZE))
    start = time.time()
    done_batches = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(call_openai, b): b for b in batches}
        for fut in as_completed(futures):
            batch = futures[fut]
            by_id, err = fut.result()
            if err:
                print(f"Batch error ({[w['id'] for w in batch]}): {err}", file=sys.stderr)
                continue
            for w in batch:
                r = by_id.get(w['id'])
                results[w['id']] = {'note': r['note']} if r else {'checked': True}
            done_batches += 1
            if done_batches % 5 == 0:
                found_so_far = sum(1 for v in results.values() if v.get('note'))
                print(f"{done_batches}/{len(batches)} batches done, {found_so_far} notes found so far ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    found = sum(1 for v in results.values() if v.get('note'))
    print(f"Done. {found} words got a preposition note out of {len(results)} checked.", file=sys.stderr)


if __name__ == '__main__':
    main()
