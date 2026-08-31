#!/usr/bin/env python3
"""One-time (re-runnable) batch generator for the round-1 translation
exercise's pre-baked English sentences (see lib/words.ts's `exercisePrompt`
field). Each sentence uses ONLY a word's level's guaranteed-safe baseline
vocabulary (every word in lower CEFR levels, or A1's ~220 `highFrequency`
words for A1 itself) plus the target word — never an individual learner's
own progress, so results are static and safe to bake into shipped data.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-exercise-prompts.py

Resumable: re-running only fills in words still missing a result in
scripts/.exercise-prompts-cache.json (gitignored) — safe to re-run after a
rate-limit/quota interruption, or after adding new words to lib/words.ts.
Once satisfied, bake results into lib/words.ts with the accompanying
apply step described in this file's __main__ block.
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
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.exercise-prompts-cache.json')

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

# Kept in sync with lib/practice.ts's EXERCISE_SENTENCE_WORD_RANGE and the
# generate-sentence Edge Function's WORD_RANGE — chosen by level difficulty.
WORD_RANGE = {
    'A1': (3, 6), 'A2': (4, 8), 'B1': (6, 12), 'B2': (8, 14),
    'C1': (10, 16), 'C2': (12, 18),
}
PREREQUISITE_LEVELS = {
    'A1': [], 'A2': ['A1'], 'B1': ['A1', 'A2'], 'B2': ['A1', 'A2', 'B1'],
    'C1': ['A1', 'A2', 'B1', 'B2'],
    'C2': ['A1', 'A2', 'B1', 'B2', 'C1'],
}

ENTRY_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>\w+)',\s*de:\s*'(?P<de>(?:[^'\\]|\\.)*)'.*?"
    r"en:\s*'(?P<en>(?:[^'\\]|\\.)*)'.*?"
    r"level:\s*'(?P<level>\w+)'(?P<hf>,\s*highFrequency:\s*true)?\s*\}"
)


def parse_words():
    with open(WORDS_PATH, encoding='utf-8') as f:
        content = f.read()
    words = []
    for m in ENTRY_RE.finditer(content):
        words.append({
            'id': m.group('id'), 'de': m.group('de'), 'en': m.group('en'),
            'level': m.group('level'), 'highFrequency': bool(m.group('hf')),
        })
    return words


def known_vocab_for(by_level, level):
    pool = []
    for l in PREREQUISITE_LEVELS.get(level, []):
        pool.extend(by_level.get(l, []))
    if level == 'A1':
        pool.extend([w for w in by_level.get('A1', []) if w['highFrequency']])
    seen, result = set(), []
    for w in pool:
        key = w['en'].lower()
        if key not in seen:
            seen.add(key)
            result.append(w['en'])
    return result


def word_count(s):
    return len(re.findall(r"[A-Za-z']+", s))


def call_openai(word, vocab_cache):
    level = word['level']
    vocab = vocab_cache.get(level, [])
    min_w, max_w = WORD_RANGE.get(level, (6, 14))
    system_prompt = (
        f"You are writing a translation exercise for a CEFR {level} German learner. "
        f'Write ONE natural English sentence that: (1) uses the word "{word["en"]}" (or a '
        'close natural inflection, e.g. its plural or a verb form) — this is the new word '
        'being introduced, and the sentence MUST include it; (2) otherwise ONLY uses '
        f'vocabulary from this list of words the learner already knows: {", ".join(vocab)}. '
        'You may always use ordinary English function words and grammar (a, the, is, was, '
        'to, in, and, of, etc.) even if not in that list. (3) The sentence MUST be between '
        f'{min_w} and {max_w} words long (inclusive) — count every word, this is a hard '
        'requirement, not a suggestion. The sentence should be meaningful and make sense on '
        'its own, not a trivial or random-sounding string of words. '
        f'(4) CRITICAL: the German word actually being practiced is "{word["de"]}", not just '
        f'any word meaning "{word["en"]}" — the English sentence will later be translated '
        f'back into German and checked specifically for "{word["de"]}", so it must be written '
        f'so that "{word["de"]}" (in its correct grammatical form) is a genuinely natural, '
        'idiomatic way to render it — not merely translatable using some other, more common '
        'German word that happens to share the same English gloss. This matters a lot for '
        'German, where one English gloss often maps to several German words with different '
        'grammatical patterns: a real, confirmed miss was generating "I advise you to check '
        'the address" for the target word "beraten" — that ADVISE-SOMEONE-TO-DO-X sentence '
        'shape is what "raten" (dative person + zu + infinitive) naturally fits, not '
        '"beraten" (accusative person, closer to "consult with/counsel", not naturally '
        'followed by "advise them TO DO a specific action"); a sentence like "I meet my '
        'lawyer because she advises me well in financial matters" fits "beraten" instead. '
        f'Before finalizing, recall "{word["de"]}"\'s actual German grammar (which case/'
        'preposition it governs, whether it takes a direct object, an infinitive clause, '
        'etc.) and make sure the English sentence you write actually calls for that exact '
        'pattern. Respond with exactly this JSON: {"sentence": "..."}.'
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f'Write the sentence for the word "{word["en"]}".'},
    ]
    last_sentence, length_attempts, rate_limit_retries = None, 0, 0
    while length_attempts < 2:
        body = {
            "model": "gpt-4o-mini", "response_format": {"type": "json_object"},
            "messages": messages, "temperature": 0.7, "max_tokens": 120,
        }
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read())
            raw = result['choices'][0]['message']['content']
            sentence = json.loads(raw).get('sentence', '').strip()
        except urllib.error.HTTPError as e:
            # OpenAI returns 429 for both rate limits AND exhausted quota —
            # back off and retry either way, it's indistinguishable here.
            if e.code == 429 and rate_limit_retries < 8:
                rate_limit_retries += 1
                time.sleep(min(2 ** rate_limit_retries, 30))
                continue
            return word['id'], last_sentence, f"HTTP {e.code}"
        except Exception as e:
            if rate_limit_retries < 3:
                rate_limit_retries += 1
                time.sleep(2)
                continue
            return word['id'], last_sentence, str(e)
        wc = word_count(sentence)
        length_attempts += 1
        if min_w <= wc <= max_w or length_attempts >= 2:
            return word['id'], sentence, None
        last_sentence = sentence
        messages.append({"role": "assistant", "content": raw})
        messages.append({"role": "user", "content": (
            f'Your sentence "{sentence}" has {wc} words — that is outside the required '
            f'{min_w}-{max_w} word range. Try again, strictly within that range.'
        )})
    return word['id'], last_sentence, None


def main():
    words = parse_words()
    by_level = {}
    for w in words:
        by_level.setdefault(w['level'], []).append(w)
    vocab_cache = {lvl: known_vocab_for(by_level, lvl) for lvl in PREREQUISITE_LEVELS}

    targets = [w for w in words if not (w['level'] == 'A1' and w['highFrequency'])]
    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)
    targets = [w for w in targets if w['id'] not in results]
    print(f"{len(targets)} words need a prompt sentence (resuming {len(results)} already done)", file=sys.stderr)

    start = time.time()
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(call_openai, w, vocab_cache): w for w in targets}
        done = 0
        for fut in as_completed(futures):
            wid, sentence, err = fut.result()
            done += 1
            if sentence:
                results[wid] = sentence
            if done % 100 == 0:
                print(f"{done}/{len(targets)} done ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print(f"Wrote {len(results)} sentences to {CACHE_PATH}", file=sys.stderr)
    print("Next: bake these into lib/words.ts's exercisePrompt field for each matching id "
          "(insert `, exercisePrompt: \"...\"` right after each entry's `level` field).",
          file=sys.stderr)


if __name__ == '__main__':
    main()
