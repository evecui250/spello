#!/usr/bin/env python3
"""One-time (re-runnable) batch generator for verb conjugation forms shown
during study (see lib/words.ts's `thirdPerson`/`pastTense`/`perfectTense`
fields) — same idea as plural for nouns, just generated rather than already
present in the source data. For every verb: the 3rd-person-singular PRESENT
form (er/sie/es ___), the 3rd-person-singular simple PAST/Präteritum form
(er/sie/es ___), and the PERFECT form including its correct auxiliary
(hat/ist ___) — each as the learner would actually see it in a sentence,
including separable-prefix verbs written with the prefix split off (e.g.
"steht auf", not "aufsteht"), since that's the form that's actually
grammatical. The perfect form is what's shown during study (see
DailySessionFlow) — Perfekt is the tense actually used in spoken German for
most verbs, unlike Präteritum, which is mostly a written/narrative tense
outside of sein/haben/werden/modals; pastTense (Präteritum) is still
generated and kept in the data even though it isn't currently displayed.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-verb-forms.py

Resumable: re-running only fills in verbs still missing a result in
scripts/.verb-forms-cache.json (gitignored) — safe to re-run after a
rate-limit/quota interruption, or after adding new verbs to lib/words.ts.

Verification built in: after generation, a fixed set of well-known
irregular/strong verbs (sein, haben, werden, gehen, nehmen, essen, fahren,
...) is checked against hand-written correct answers and any mismatch is
printed loudly — these are common enough that a wrong answer here is a
strong signal something is off with the prompt/model, not just one hard
word. This does NOT prove every one of the ~896 results is correct (that
would need a human native-speaker review, or a from-scratch model
cross-check), just that the well-known cases aren't broken.
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
CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.verb-forms-cache.json')

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

# Hand-written ground truth for a spot-check pass — verbs common enough
# that any wrong answer here means the prompt/model is unreliable, not
# just that this one verb is obscure. (thirdPerson, pastTense, perfectTense)
KNOWN_ANSWERS = {
    'sein': ('ist', 'war', 'ist gewesen'),
    'haben': ('hat', 'hatte', 'hat gehabt'),
    'werden': ('wird', 'wurde', 'ist geworden'),
    'gehen': ('geht', 'ging', 'ist gegangen'),
    'kommen': ('kommt', 'kam', 'ist gekommen'),
    'nehmen': ('nimmt', 'nahm', 'hat genommen'),
    'essen': ('isst', 'aß', 'hat gegessen'),
    'fahren': ('fährt', 'fuhr', 'ist gefahren'),
    'sehen': ('sieht', 'sah', 'hat gesehen'),
    'sprechen': ('spricht', 'sprach', 'hat gesprochen'),
    'geben': ('gibt', 'gab', 'hat gegeben'),
    'lesen': ('liest', 'las', 'hat gelesen'),
    'schlafen': ('schläft', 'schlief', 'hat geschlafen'),
    'wissen': ('weiß', 'wusste', 'hat gewusst'),
    'können': ('kann', 'konnte', 'hat gekonnt'),
    'müssen': ('muss', 'musste', 'hat gemusst'),
    'aufstehen': ('steht auf', 'stand auf', 'ist aufgestanden'),
    'anfangen': ('fängt an', 'fing an', 'hat angefangen'),
}

ENTRY_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>\w+)',\s*de:\s*'(?P<de>(?:[^'\\]|\\.)*)'.*?"
    r"type:\s*'verb'.*?level:\s*'(?P<level>\w+)'"
)


def parse_verbs():
    with open(WORDS_PATH, encoding='utf-8') as f:
        content = f.read()
    verbs = []
    for line in content.splitlines():
        if "type: 'verb'" not in line:
            continue
        m = ENTRY_RE.search(line)
        if m:
            verbs.append({'id': m.group('id'), 'de': m.group('de'), 'level': m.group('level')})
    return verbs


def call_openai(verb):
    system_prompt = (
        "You are a German grammar reference. For the German verb given, provide three "
        "conjugated forms EXACTLY as they would appear in a real sentence: "
        '(1) "thirdPerson": the 3rd-person-singular PRESENT tense form (as in "er/sie/es ___"). '
        '(2) "pastTense": the 3rd-person-singular simple past/Präteritum form (as in "er/sie/es ___"). '
        '(3) "perfectTense": the PERFECT tense form INCLUDING its correct 3rd-person-singular '
        'auxiliary, "hat ___" or "ist ___". Determining the auxiliary is the single most important '
        'and most error-prone part of this task — think about it explicitly before answering: use '
        '"ist" ONLY for (a) sein, werden, bleiben themselves, or (b) a genuinely INTRANSITIVE verb '
        'of motion or change of state (gehen, kommen, fahren, fliegen, laufen, fallen, aufstehen, '
        'sterben, wachsen, and their compounds/separable-prefix forms). Use "hat" for EVERY other '
        'verb, including all transitive verbs, all reflexive verbs, and all modal verbs (können, '
        'müssen, wollen, ...) — this is the default; only switch to "ist" if the verb clearly '
        'matches (a) or (b) above. '
        "If the verb has a separable prefix (e.g. aufstehen, anfangen), write thirdPerson/pastTense "
        'with the prefix SEPARATED and at the end, the way it is actually used (e.g. "steht auf", '
        'not "aufsteht") — but perfectTense keeps the prefix ATTACHED to the participle as one word, '
        'the way German perfect tense actually works (e.g. "ist aufgestanden", not "steht auf '
        'gestanden" or "ist auf gestanden"). Do not include the pronoun "er/sie/es" itself in any '
        "field. For a reflexive verb, do not include the reflexive pronoun either. Respond with "
        'exactly this JSON: {"thirdPerson": "...", "pastTense": "...", "perfectTense": "..."}.'
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": 'The verb is "sein".'},
        {"role": "assistant", "content": '{"thirdPerson": "ist", "pastTense": "war", "perfectTense": "ist gewesen"}'},
        {"role": "user", "content": 'The verb is "aufstehen".'},
        {"role": "assistant", "content": '{"thirdPerson": "steht auf", "pastTense": "stand auf", "perfectTense": "ist aufgestanden"}'},
        {"role": "user", "content": 'The verb is "machen".'},
        {"role": "assistant", "content": '{"thirdPerson": "macht", "pastTense": "machte", "perfectTense": "hat gemacht"}'},
        {"role": "user", "content": f'The verb is "{verb["de"]}".'},
    ]
    rate_limit_retries = 0
    while True:
        body = {
            "model": "gpt-4o-mini", "response_format": {"type": "json_object"},
            "messages": messages, "temperature": 0, "max_tokens": 80,
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
            parsed = json.loads(raw)
            third = parsed.get('thirdPerson', '').strip()
            past = parsed.get('pastTense', '').strip()
            perfect = parsed.get('perfectTense', '').strip()
            if not third or not past or not perfect:
                return verb['id'], None, 'empty response'
            return verb['id'], {'thirdPerson': third, 'pastTense': past, 'perfectTense': perfect}, None
        except urllib.error.HTTPError as e:
            if e.code == 429 and rate_limit_retries < 8:
                rate_limit_retries += 1
                time.sleep(min(2 ** rate_limit_retries, 30))
                continue
            return verb['id'], None, f"HTTP {e.code}"
        except Exception as e:
            if rate_limit_retries < 3:
                rate_limit_retries += 1
                time.sleep(2)
                continue
            return verb['id'], None, str(e)


def spot_check(verbs, results):
    by_de = {v['de']: v['id'] for v in verbs}
    print("\n--- Spot-check against known-correct forms ---", file=sys.stderr)
    ok, bad = 0, 0
    for de, (expected_third, expected_past, expected_perfect) in KNOWN_ANSWERS.items():
        wid = by_de.get(de)
        if not wid or wid not in results:
            print(f"  SKIP {de}: not in corpus/results", file=sys.stderr)
            continue
        got = results[wid]
        match = (got['thirdPerson'] == expected_third and got['pastTense'] == expected_past
                  and got.get('perfectTense') == expected_perfect)
        status = 'OK ' if match else 'MISMATCH'
        if match:
            ok += 1
        else:
            bad += 1
        print(f"  {status} {de}: got thirdPerson={got['thirdPerson']!r} pastTense={got['pastTense']!r}"
              f" perfectTense={got.get('perfectTense')!r}"
              f" (expected {expected_third!r}/{expected_past!r}/{expected_perfect!r})", file=sys.stderr)
    print(f"--- {ok} matched, {bad} mismatched out of {ok+bad} known verbs checked ---\n", file=sys.stderr)
    return bad == 0


def main():
    verbs = parse_verbs()
    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)
    # Requires perfectTense specifically (not just presence in the cache) —
    # an earlier run of this script only generated thirdPerson/pastTense,
    # so those entries need a real re-request, not a skip.
    targets = [v for v in verbs if not results.get(v['id'], {}).get('perfectTense')]
    print(f"{len(targets)} verbs need forms (resuming {len(results)} already done, {len(verbs)} total)", file=sys.stderr)

    start = time.time()
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(call_openai, v): v for v in targets}
        done = 0
        for fut in as_completed(futures):
            vid, forms, err = fut.result()
            done += 1
            if forms:
                results[vid] = forms
            elif err:
                print(f"  FAILED {vid}: {err}", file=sys.stderr)
            if done % 100 == 0:
                print(f"{done}/{len(targets)} done ({time.time()-start:.0f}s)", file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print(f"Wrote {len(results)} verb forms to {CACHE_PATH}", file=sys.stderr)

    passed = spot_check(verbs, results)
    if not passed:
        print("*** Spot-check found mismatches above — review before baking into lib/words.ts. ***", file=sys.stderr)
    else:
        print("Spot-check passed on all known verbs. Next: bake these into lib/words.ts's "
              "thirdPerson/pastTense fields for each matching id.", file=sys.stderr)


if __name__ == '__main__':
    main()
