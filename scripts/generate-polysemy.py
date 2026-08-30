#!/usr/bin/env python3
"""Continuation of the manual "genuine same-gender polysemy" pass (see git
history: "Add a second sense to 6 corpus words...", "...add 8 more words
to the alternates pass") -- scripted so it can run over the WHOLE corpus
instead of a hand-picked handful. For each NOUN, asks whether it has a
genuinely distinct, frequently-used SECOND (or third) sense that shares
the exact same article/gender and plural as the existing entry -- e.g.
"Karte" (card) also means map/ticket, all as "die Karte". Deliberately
conservative: a look-alike second "sense" that's actually a DIFFERENT
grammatical word (different gender/plural) doesn't qualify -- same
rejections as the manual pass (Bank/bank vs Bank/bench, Mutter/mother vs
Mutter/nut, Golf/golf vs Golf/gulf, Steuer/tax vs Steuer/steering wheel
are all different words, not one word with two senses).

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-polysemy.py
    OPENAI_API_KEY=sk-... python3 scripts/generate-polysemy.py --level B2

Resumable: re-running only checks words still missing a result in
scripts/.polysemy-cache.json (gitignored). Once satisfied, bake results
into lib/words.ts with scripts/apply-polysemy.py.
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
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.polysemy-cache.json')

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

BATCH_SIZE = 20

ENTRY_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>\w+)',\s*de:\s*'(?P<de>(?:[^'\\]|\\.)*)'"
    r"(?:,\s*article:\s*'(?P<article>[^']*)')?"
    r"(?:,\s*plural:\s*'(?P<plural>(?:[^'\\]|\\.)*)')?.*?"
    r"en:\s*'(?P<en>(?:[^'\\]|\\.)*)'"
    r"(?:,\s*zh:\s*'(?P<zh>(?:[^'\\]|\\.)*)')?.*?"
    r"type:\s*'(?P<type>\w+)'.*?"
    r"level:\s*'(?P<level>\w+)'"
)


def unescape(s):
    if s is None:
        return None
    return s.replace("\\'", "'").replace('\\"', '"')


def parse_words(level_filter=None):
    with open(WORDS_PATH, encoding='utf-8') as f:
        content = f.read()
    words = []
    for m in ENTRY_RE.finditer(content):
        # Only nouns are eligible -- gender/plural agreement is the whole
        # qualifying mechanism, and only nouns carry an article/plural.
        if m.group('type') != 'noun' or not m.group('article'):
            continue
        if level_filter and m.group('level') != level_filter:
            continue
        en = unescape(m.group('en'))
        # Already has a "/" -- either from a prior batch or from the
        # original corpus import -- skip re-checking it.
        if '/' in en:
            continue
        words.append({
            'id': m.group('id'),
            'de': unescape(m.group('de')),
            'article': m.group('article'),
            'plural': unescape(m.group('plural')),
            'en': en,
            'zh': unescape(m.group('zh')),
        })
    return words


SYSTEM_PROMPT = (
    "You are a strict German lexicographer helping extend a vocabulary app. You will get a "
    "JSON array of entries, each with an id, the German noun (de), its article (der/die/das), "
    "plural form, current English gloss (en), and current Chinese gloss (zh, may be null). "
    "For each entry, decide whether this EXACT noun (same article, same plural) has a genuine "
    "SECOND, DISTINCT real-world referent beyond the sense already given -- most nouns do NOT "
    "qualify, and a false positive is worse than a missed one, so when in doubt leave it out.\n"
    "\n"
    "THE TEST: the additional sense must name a DIFFERENT KIND OF THING or DIFFERENT CONCEPT "
    "-- something the current gloss could NOT be substituted for in a sentence using that "
    'sense. "Karte" (card) also means a map and a ticket -- three genuinely different physical '
    'objects, none interchangeable with another -- QUALIFIES. Do NOT include a "second sense" '
    "that is just a synonym, a more technical/formal word, or a slightly different shade of "
    "the SAME concept as the existing gloss -- that is padding, not polysemy, and must be "
    'REJECTED. REJECTED (verified wrong -- these are the same concept restated, do not repeat '
    'this mistake): "Standort: location, site / location, position" (same concept, "site" and '
    '"position" both just mean location), "Neuheit: novelty / innovation, newness" (same '
    'concept), "Kompetenz: competence, skill / expertise, ability" (same concept), "Entwurf: '
    'draft, design / plan, outline" (same concept), "Zusammenbruch: collapse, breakdown / '
    'failure, crash" (same concept), "Regelung: regulation, arrangement / rule, regulation" '
    '(literally repeats "regulation" -- clearly the same sense), "Hierarchie: hierarchy / '
    'pecking order, ranking" (same concept, reworded), "Konzern: corporation, conglomerate / '
    'group, association" (same concept). ACCEPTED (genuinely different referents -- keep '
    'finding ones like these): "Absatz: paragraph / heel (of a shoe)", "Bogen: sheet (of '
    'paper) / arc, bow (curved shape)", "Schloss: lock / castle", "Birne: pear / light bulb", '
    '"Strom: electricity / current, stream".\n'
    "Also reject anything where the other sense is actually a DIFFERENT grammatical word (a "
    "true homonym with a different gender or plural, just spelled the same) -- e.g. Bank "
    "(bank, plural Banken) vs Bank (bench, plural Bänke) are different words, not one word "
    "with two senses; Mutter (mother, plural Mütter) vs Mutter (nut/bolt, plural Muttern) are "
    "different words too. Only merge senses that share the exact same article AND plural.\n"
    "For each entry that DOES qualify, return the FULL updated \"en\" field: the ORIGINAL "
    'sense first, then " / " then each additional sense (comma-separate near-synonyms of the '
    'SAME added sense, use another " / " only for a genuinely distinct additional sense) -- '
    'e.g. "paragraph / heel", "row / series", "sheet / arc, bow". Also return the full '
    'updated "zh" field the same way but using the fullwidth slash "／" as the separator '
    'instead of " / ", translating the added sense(s) into Simplified Chinese -- if the input '
    "zh was null, still produce a complete zh value covering every sense with best judgment.\n"
    'Respond with exactly this JSON: {"results": [{"id": "...", "en": "...", "zh": "..."}, '
    "...]}, including ONLY entries that genuinely qualify -- omit every entry that doesn't, "
    "don't pad the array to match the input length."
)


def call_openai(batch):
    payload = [
        {'id': w['id'], 'de': w['de'], 'article': w['article'], 'plural': w['plural'], 'en': w['en'], 'zh': w['zh']}
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
            by_id = {r['id']: r for r in results if 'id' in r and r.get('en')}
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
    print(f"{len(words)} noun entries without an existing '/' parsed" + (f" for level {args.level}" if args.level else ""), file=sys.stderr)

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)

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
                results[w['id']] = {'en': r['en'], 'zh': r.get('zh')} if r else {'checked': True}
            done_batches += 1
            if done_batches % 5 == 0:
                found_so_far = sum(1 for v in results.values() if v.get('en'))
                print(f"{done_batches}/{len(batches)} batches done, {found_so_far} qualifying words so far ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    found = sum(1 for v in results.values() if v.get('en'))
    print(f"Done. {found} words got a second sense out of {len(results)} checked.", file=sys.stderr)
    if stop_all:
        sys.exit(2)


if __name__ == '__main__':
    main()
