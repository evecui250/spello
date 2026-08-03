#!/usr/bin/env python3
"""One-time (re-runnable) batch translator adding a Chinese version of
Spello's vocabulary — see lib/words.ts's `zh`/`exercisePromptZh` fields.
Translates each word's English gloss (`en` -> `zh`) and, where present, its
pre-baked round-1 translation-exercise sentence (`exercisePrompt` ->
`exercisePromptZh`), in the SAME batched call per group of words (cheaper
and faster than one call per field).

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/translate-to-chinese.py

Resumable: re-running only fills in words still missing a result in
scripts/.zh-translations-cache.json (gitignored) — safe to re-run after a
rate-limit/quota interruption, or after adding new words to lib/words.ts.
Once satisfied, bake results into lib/words.ts with
scripts/apply-chinese-translations.py.
"""
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
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.zh-translations-cache.json')

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

BATCH_SIZE = 15

ENTRY_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>\w+)',\s*de:\s*'(?P<de>(?:[^'\\]|\\.)*)'.*?"
    r"en:\s*'(?P<en>(?:[^'\\]|\\.)*)'.*?"
    r"level:\s*'(?P<level>\w+)'"
    r"(?:,\s*highFrequency:\s*true)?"
    r"(?:,\s*exercisePrompt:\s*\"(?P<prompt>(?:[^\"\\]|\\.)*)\")?"
    r"\s*\}"
)


def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"')


def parse_words():
    with open(WORDS_PATH, encoding='utf-8') as f:
        content = f.read()
    words = []
    for m in ENTRY_RE.finditer(content):
        words.append({
            'id': m.group('id'),
            'de': unescape(m.group('de')),
            'en': unescape(m.group('en')),
            'level': m.group('level'),
            'prompt': unescape(m.group('prompt')) if m.group('prompt') else None,
        })
    return words


SYSTEM_PROMPT = (
    "You are a professional German-Chinese-English trilingual translator helping "
    "build a German vocabulary app for Simplified-Chinese-speaking learners. You will "
    "get a JSON array of entries, each with an id, the German word (de), its English "
    "gloss (en), and optionally an English example sentence (prompt) that uses that "
    "word's meaning. For each entry, return:\n"
    '- "zh": a concise, natural Simplified Chinese gloss for the English meaning — '
    "dictionary-entry style (a short word or phrase a learner would look up), not a "
    "full explanation. If the English gloss has multiple alternatives separated by "
    '"/", translate each and join them the same way with "／". Base the translation on '
    "the actual German word's meaning, not just the English gloss in isolation, in "
    "case the English gloss is ambiguous on its own.\n"
    '- "promptZh": ONLY if a "prompt" field was given — a natural, fluent Simplified '
    "Chinese translation of that exact English sentence (meaning-for-meaning, not "
    "word-for-word).\n"
    'Respond with exactly this JSON: {"results": [{"id": "...", "zh": "...", '
    '"promptZh": "..." (omit this key entirely if no prompt was given)}, ...]}, one '
    "result per input entry, same order, every id accounted for."
)


def call_openai(batch):
    payload = [
        {'id': w['id'], 'de': w['de'], 'en': w['en'], **({'prompt': w['prompt']} if w['prompt'] else {})}
        for w in batch
    ]
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    body = {
        "model": "gpt-4o-mini", "response_format": {"type": "json_object"},
        "messages": messages, "temperature": 0.3, "max_tokens": 4000,
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
            by_id = {r['id']: r for r in results if 'id' in r}
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
    words = parse_words()
    print(f"{len(words)} total word entries parsed", file=sys.stderr)

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)

    targets = [w for w in words if w['id'] not in results]
    print(f"{len(targets)} words need translation (resuming {len(results)} already done)", file=sys.stderr)

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
            for w in batch:
                r = by_id.get(w['id'])
                if r and r.get('zh'):
                    entry = {'zh': r['zh']}
                    if w['prompt'] and r.get('promptZh'):
                        entry['promptZh'] = r['promptZh']
                    results[w['id']] = entry
            done_batches += 1
            if done_batches % 5 == 0:
                print(f"{done_batches}/{len(batches)} batches done ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    missing = [w['id'] for w in words if w['id'] not in results]
    print(f"Wrote {len(results)} translations to {CACHE_PATH}", file=sys.stderr)
    if missing:
        print(f"{len(missing)} words still missing a translation (re-run to retry): {missing[:20]}", file=sys.stderr)


if __name__ == '__main__':
    main()
