#!/usr/bin/env python3
"""Regenerates exercisePrompt/exercisePromptZh for words confirmed broken by
the audit-word-fit -> confirm-word-fit -> manual-review pipeline (see
scripts/.final-keep-list.json). Calls the LIVE generate-sentence Edge
Function (same one the app itself uses) via the public anon key, then
re-checks each new sentence with audit-word-fit before accepting it.

Usage:
    python3 scripts/regenerate-flagged-sentences.py

Resumable: writes scripts/.regenerate-cache.json (gitignored) as it goes.
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
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
KEEP_LIST_PATH = os.path.join(SCRIPT_DIR, '.final-keep-list.json')
CACHE_PATH = os.path.join(SCRIPT_DIR, '.regenerate-cache.json')

SUPABASE_URL = 'https://whjiebzglefivvczvpfb.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_Ebu1ILGhZKQ6XMiNcHsuwA_ny_A7z5s'
GENERATE_URL = f'{SUPABASE_URL}/functions/v1/generate-sentence'
AUDIT_URL = f'{SUPABASE_URL}/functions/v1/audit-word-fit'

MAX_WORKERS = 4
MAX_ATTEMPTS = 3

PREREQUISITE_LEVELS = {
    'A1': [], 'A2': ['A1'], 'B1': ['A1', 'A2'], 'B2': ['A1', 'A2', 'B1'],
}

ID_RE = re.compile(r"id:\s*'(\w+)'")
DE_RE = re.compile(r"\bde:\s*'((?:[^'\\]|\\.)*)'")
EN_RE = re.compile(r"\ben:\s*'((?:[^'\\]|\\.)*)'")
LEVEL_RE = re.compile(r"\blevel:\s*'(\w+)'")
HF_RE = re.compile(r"highFrequency:\s*true")


def parse_words():
    words = []
    with open(WORDS_PATH, encoding='utf-8') as f:
        for line in f:
            if "id:" not in line or "de:" not in line:
                continue
            m_id, m_de, m_en, m_level = ID_RE.search(line), DE_RE.search(line), EN_RE.search(line), LEVEL_RE.search(line)
            if not (m_id and m_de and m_en and m_level):
                continue
            words.append({
                'id': m_id.group(1), 'de': m_de.group(1), 'en': m_en.group(1),
                'level': m_level.group(1), 'highFrequency': bool(HF_RE.search(line)),
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


def post_json(url, payload, timeout=90):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
            'apikey': SUPABASE_ANON_KEY,
        },
    )
    retries = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and retries < 6:
                retries += 1
                time.sleep(min(2 ** retries, 30))
                continue
            raise
        except Exception:
            if retries < 3:
                retries += 1
                time.sleep(3)
                continue
            raise


def fix_word(word, vocab):
    last_sentence, last_zh = None, None
    for attempt in range(MAX_ATTEMPTS):
        gen = post_json(GENERATE_URL, {
            'wordId': word['id'], 'wordDe': word['de'], 'wordEn': word['en'],
            'level': word['level'], 'knownVocabulary': vocab, 'nativeLanguage': 'zh',
        })
        sentence = gen.get('sentence')
        zh = gen.get('sentenceZh')
        if not sentence:
            continue
        last_sentence, last_zh = sentence, zh
        audit = post_json(AUDIT_URL, {'items': [
            {'id': word['id'], 'wordDe': word['de'], 'wordEn': word['en'], 'sentence': sentence},
        ]})
        result = audit.get('results', {}).get(word['id'], {})
        if result.get('fits') is True:
            return {'status': 'fixed', 'sentence': sentence, 'sentenceZh': zh, 'attempts': attempt + 1}
    return {'status': 'unresolved', 'sentence': last_sentence, 'sentenceZh': last_zh, 'attempts': MAX_ATTEMPTS}


def main():
    with open(KEEP_LIST_PATH, encoding='utf-8') as f:
        keep = json.load(f)
    words = parse_words()
    by_id = {w['id']: w for w in words}
    by_level = {}
    for w in words:
        by_level.setdefault(w['level'], []).append(w)
    vocab_cache = {lvl: known_vocab_for(by_level, lvl) for lvl in PREREQUISITE_LEVELS}

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)

    targets = [wid for wid in keep if wid not in results and wid in by_id]
    print(f"{len(targets)} words to regenerate (resuming {len(results)} already done)", file=sys.stderr)

    def run_one(wid):
        word = by_id[wid]
        vocab = vocab_cache.get(word['level'], [])
        try:
            return wid, fix_word(word, vocab)
        except Exception as e:
            return wid, {'status': 'error', 'error': str(e)}

    start = time.time()
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(run_one, wid): wid for wid in targets}
        for fut in as_completed(futures):
            wid, r = fut.result()
            results[wid] = r
            done += 1
            if done % 20 == 0:
                print(f"{done}/{len(targets)} done ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    fixed = sum(1 for r in results.values() if r.get('status') == 'fixed')
    unresolved = sum(1 for r in results.values() if r.get('status') == 'unresolved')
    errored = sum(1 for r in results.values() if r.get('status') == 'error')
    print(f"Fixed: {fixed}. Unresolved (kept trying, still flagged): {unresolved}. Errored: {errored}.", file=sys.stderr)


if __name__ == '__main__':
    main()
