#!/usr/bin/env python3
"""Second-pass confirmation for scripts/audit-word-fit.py's flagged list —
see supabase/functions/confirm-word-fit's header for why. Reads
scripts/.audit-word-fit-flagged.json and writes
scripts/.confirm-word-fit-cache.json (resumable) plus
scripts/.confirm-word-fit-confirmed.json (the final, high-confidence list).

Usage:
    python3 scripts/confirm-word-fit.py
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FLAGGED_PATH = os.path.join(SCRIPT_DIR, '.audit-word-fit-flagged.json')
CACHE_PATH = os.path.join(SCRIPT_DIR, '.confirm-word-fit-cache.json')
CONFIRMED_PATH = os.path.join(SCRIPT_DIR, '.confirm-word-fit-confirmed.json')

SUPABASE_URL = 'https://whjiebzglefivvczvpfb.supabase.co'
SUPABASE_ANON_KEY = 'sb_publishable_Ebu1ILGhZKQ6XMiNcHsuwA_ny_A7z5s'
FUNCTION_URL = f'{SUPABASE_URL}/functions/v1/confirm-word-fit'

BATCH_SIZE = 15
MAX_WORKERS = 3


def call_batch(batch):
    items = [
        {'id': wid, 'wordDe': r['de'], 'wordEn': r['en'], 'sentence': r['sentence'],
         'firstPassReason': r.get('reason', '')}
        for wid, r in batch
    ]
    body = json.dumps({'items': items}).encode()
    req = urllib.request.Request(
        FUNCTION_URL, data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
            'apikey': SUPABASE_ANON_KEY,
        },
    )
    retries = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                result = json.loads(resp.read())
            return result.get('results', {})
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503) and retries < 6:
                retries += 1
                time.sleep(min(2 ** retries, 30))
                continue
            print(f"batch failed ({[wid for wid, _ in batch]}): HTTP {e.code} {e.read()}", file=sys.stderr)
            return {}
        except Exception as e:
            if retries < 3:
                retries += 1
                time.sleep(3)
                continue
            print(f"batch failed ({[wid for wid, _ in batch]}): {e}", file=sys.stderr)
            return {}


def main():
    with open(FLAGGED_PATH, encoding='utf-8') as f:
        flagged = json.load(f)
    print(f"{len(flagged)} first-pass flags to confirm", file=sys.stderr)

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)
    targets = [(wid, r) for wid, r in flagged.items() if wid not in results]
    print(f"{len(targets)} still need confirming (resuming {len(results)} already done)", file=sys.stderr)

    batches = [targets[i:i + BATCH_SIZE] for i in range(0, len(targets), BATCH_SIZE)]
    start = time.time()
    done_batches = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(call_batch, b): b for b in batches}
        for fut in as_completed(futures):
            batch_results = fut.result()
            for wid, r in batch_results.items():
                results[wid] = r
            done_batches += 1
            if done_batches % 5 == 0:
                print(f"{done_batches}/{len(batches)} batches done ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    confirmed = {
        wid: {**flagged[wid], 'confirmReason': results[wid].get('reason', '')}
        for wid in flagged if results.get(wid, {}).get('confirmed') is True
    }
    with open(CONFIRMED_PATH, 'w', encoding='utf-8') as f:
        json.dump(confirmed, f, ensure_ascii=False, indent=1)

    missing = [wid for wid in flagged if wid not in results]
    print(f"Confirmed: {len(confirmed)}/{len(flagged)}. Missing/failed: {len(missing)}.", file=sys.stderr)
    print(f"Confirmed list written to {CONFIRMED_PATH}", file=sys.stderr)


if __name__ == '__main__':
    main()
