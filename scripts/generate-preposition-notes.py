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
    "You are a strict German pedagogy expert helping build a vocabulary app. You will get a "
    "JSON array of entries, each with an id, the German word (de), its word type (noun/verb/"
    "adjective), optional article, and its English gloss (en). For each entry, decide whether "
    "it has a genuinely FIXED, idiomatic preposition (and case) that a learner needs to "
    "memorize ALONGSIDE the word -- most words do NOT qualify, and a false positive is worse "
    "than a missed one, so when in doubt leave it out.\n"
    "\n"
    "HARD REQUIREMENT: the note you return MUST literally contain a real German preposition "
    "(an, auf, aus, bei, durch, für, gegen, hinter, in, mit, nach, neben, über, um, unter, "
    "von, vor, zu, zwischen, außer, statt, trotz, während, wegen, ohne, entlang, gemäß, laut, "
    "seit, bis, or a contraction like am/im/beim/zum/zur/vom/ins/ans). If the correct usage "
    "has NO preposition at all (a plain transitive verb with just a direct object, or a verb "
    "governing a bare dative/accusative with no preposition), that word does NOT qualify --\n"
    "REJECT it, don't invent one and don't return the bare verb alone.\n"
    "\n"
    "Only two categories genuinely qualify:\n"
    "1. A place/location NOUN with ONE STRONGLY-CONVENTIONALIZED preposition that's specific "
    'to that word (not just "any noun + in/an" works) -- e.g. "Bahnhof" -> "am Bahnhof (at the '
    'train station)" (idiomatic "am", not "in dem"), "Schule" -> "in der Schule (at school)" '
    "(idiomatic for attending, not just physical location). An ordinary place noun where any "
    'preposition would work equally unremarkably (e.g. "Einbahnstraße" -> "in der '
    'Einbahnstraße" -- any street works with "in der", nothing special) does NOT qualify.\n'
    "2. A VERB or ADJECTIVE whose preposition is GOVERNED (Rektion) -- the preposition is "
    'part of the verb/adjective\'s own grammar, not just describing location. Correct: '
    '"erkundigen" -> "sich über etw. (Akk.) erkundigen", "warten" -> "warten auf etw./jmdn. '
    '(Akk.)", "stolz" -> "stolz auf etw. (Akk.)", "gehören" -> "gehören zu etw. (Dat.)", '
    '"gelten" -> "gelten für etw. (Akk.)". REJECTED (verified wrong -- do not repeat these '
    'mistakes): "anrufen" (plain accusative object, jmdn. anrufen -- no preposition), '
    '"beachten" (plain accusative object -- no preposition), "befinden" (sich befinden -- no '
    'preposition, just reflexive), "begegnen" (jmdm. begegnen -- bare dative, no preposition), '
    '"begrüßen" (plain accusative object -- no preposition), "empfehlen" (jmdm. etw. '
    'empfehlen -- bare dative+accusative, no preposition), "entgegenkommen" (jmdm. '
    'entgegenkommen -- bare dative, no preposition), "ablehnen" (etw. ablehnen -- plain '
    'accusative object, NOT "ablehnen von").\n'
    "\n"
    'For each entry you DO include, return a "note": the exact German usage phrase containing '
    'a real preposition, followed by a brief English gloss in parentheses -- e.g. "am Bahnhof '
    '(at the train station)".\n'
    'Respond with exactly this JSON: {"results": [{"id": "...", "note": "..."}, ...]}, '
    "including ONLY entries that genuinely qualify per the hard requirement above -- omit "
    "every entry that doesn't, don't pad the array to match the input length."
)


# Mechanical safety net on top of the prompt: a "prepositionNote" that
# doesn't actually contain one of these (as a whole word, case-sensitive
# where it matters -- "In" the middle of a sentence is still lowercase in
# German) is a hallucination (the model returning the bare verb/phrase
# with no real preposition, as happened before this check existed:
# "anrufen (to call, phone)" had no preposition anywhere in it) and gets
# dropped regardless of what the model claims.
REAL_PREPOSITIONS = {
    'an', 'auf', 'aus', 'bei', 'durch', 'für', 'gegen', 'hinter', 'in', 'mit',
    'nach', 'neben', 'über', 'um', 'unter', 'von', 'vor', 'zu', 'zwischen',
    'außer', 'statt', 'trotz', 'während', 'wegen', 'ohne', 'entlang',
    'gemäß', 'laut', 'seit', 'bis',
    'am', 'im', 'beim', 'zum', 'zur', 'vom', 'ins', 'ans',
}


def has_real_preposition(note):
    tokens = re.findall(r"[A-Za-zÄÖÜäöüß]+", note.lower())
    return any(t in REAL_PREPOSITIONS for t in tokens)


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
            by_id = {
                r['id']: r for r in results
                if 'id' in r and r.get('note') and has_real_preposition(r['note'])
            }
            return by_id, None
        except urllib.error.HTTPError as e:
            body_text = e.read()
            if e.code == 429:
                try:
                    err = json.loads(body_text).get('error', {})
                    if err.get('type') == 'insufficient_quota' or err.get('code') == 'insufficient_quota':
                        return {}, 'INSUFFICIENT_QUOTA'
                except Exception:
                    pass
                if rate_limit_retries < 8:
                    rate_limit_retries += 1
                    time.sleep(min(2 ** rate_limit_retries, 30))
                    continue
            return {}, f"HTTP {e.code}: {body_text[:300]}"
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
    stop_all = False
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(call_openai, b): b for b in batches}
        for fut in as_completed(futures):
            if stop_all:
                fut.cancel()
                continue
            batch = futures[fut]
            by_id, err = fut.result()
            if err == 'INSUFFICIENT_QUOTA':
                print('\nOUT OF OPENAI CREDIT -- stopping.', file=sys.stderr)
                stop_all = True
                for other in futures:
                    other.cancel()
                break
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
    if stop_all:
        sys.exit(2)


if __name__ == '__main__':
    main()
