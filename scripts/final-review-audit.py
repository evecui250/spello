#!/usr/bin/env python3
"""One-time, final decisive review of the 74 entries audit-exercise-prompts.py
sent to manual review — the minority where pass-1 and pass-2 disagreed or
expressed low confidence, without ever reaching a stable conclusion. A
human read all 74 and reported that several are simply being repeatedly
rewritten because English cannot always uniquely pin down a target German
word against a close synonym (e.g. denn vs weil) — no rewrite will ever
"fix" that, so this pass adds a third resting state for exactly that case
instead of forcing every entry into PASS/IMPROVE-forever.

This does NOT touch lib/words.ts and does NOT touch
scripts/.exercise-audit-apply.json (the already-applied 1,391 entries are
untouched). It only reads scripts/.exercise-audit-review.json and writes
scripts/.exercise-final-review.json (gitignored) — apply what's decided
here as a separate, explicit step later.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/final-review-audit.py
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REVIEW_PATH = os.path.join(SCRIPT_DIR, '.exercise-audit-review.json')
OUT_PATH = os.path.join(SCRIPT_DIR, '.exercise-final-review.json')

MODEL = 'gpt-5.6-sol'
MAX_WORKERS = 4

PRICE_PER_TOKEN_IN = 4.0 / 1_000_000
PRICE_PER_TOKEN_OUT = 20.0 / 1_000_000

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

REASONING_FALLBACK = {'high': 'medium', 'medium': 'low'}


def call_openai(body, reasoning_effort):
    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=json.dumps({**body, 'reasoning_effort': reasoning_effort}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {API_KEY}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        err_text = e.read().decode(errors='replace')
        fallback = REASONING_FALLBACK.get(reasoning_effort)
        if fallback and 'reasoning_effort' in err_text.lower():
            return call_openai(body, fallback)
        raise RuntimeError(f'HTTP {e.code}: {err_text}') from e


# ---------------------------------------------------------------------------
# Step 1: repair the two entries (Apparat, Rechner) whose pass-2 call never
# even returned content — a hard HTTP 400 "max_tokens or model output limit
# was reached", not the empty-content case audit-exercise-prompts.py already
# knows how to escalate past. Re-run pass-2 for just these two with a much
# larger starting budget before this script's own final-review call ever
# looks at them, so the final call has a real pass-2 opinion to weigh instead
# of a permanent gap.
# ---------------------------------------------------------------------------

PASS2_SCHEMA = {
    'type': 'object',
    'properties': {
        'status': {'type': 'string', 'enum': ['PASS', 'IMPROVE', 'REGENERATE']},
        'reason': {'type': 'string'},
        'englishSentence': {'type': 'string'},
        'canonicalGerman': {'type': 'string'},
        'chineseSentence': {'type': 'string'},
        'targetForm': {'type': 'string'},
        'confidence': {'type': 'string', 'enum': ['high', 'medium', 'low']},
    },
    'required': [
        'status', 'reason', 'englishSentence', 'canonicalGerman',
        'chineseSentence', 'targetForm', 'confidence',
    ],
    'additionalProperties': False,
}


def build_pass2_prompt(de, en, level, english_sentence, chinese_sentence):
    zh_line = f'"{chinese_sentence}"' if chinese_sentence else '(none provided)'
    return (
        f'You are re-validating a proposed German vocabulary app exercise sentence for '
        f'CEFR {level} learners, testing the target word "{de}" (English gloss: "{en}").\n\n'
        f'PROPOSED ENGLISH SENTENCE: "{english_sentence}"\n'
        f'PROPOSED CHINESE SENTENCE: {zh_line}\n\n'
        f'Judge whether this sentence naturally elicits the exact target word "{de}" '
        '(not merely a technically-possible answer, and not a different German word that a '
        'learner would reach for at least as readily), is grammatically correct and '
        'idiomatic German, and whether the English/German/Chinese all agree in meaning and '
        f'are appropriate for CEFR {level}.\n\n'
        'Respond with "PASS" (this proposal is good as-is — repeat it unchanged in every '
        'field) if it holds up, or "IMPROVE"/"REGENERATE" with a corrected replacement '
        'if not. Always fill every schema field. Respond only with the structured output '
        'required by the schema.'
    )


def run_pass2_repair(de, en, level, english_sentence, chinese_sentence):
    last_err = None
    for max_tokens in (4000, 8000, 12000):
        body = {
            'model': MODEL,
            'max_completion_tokens': max_tokens,
            'response_format': {
                'type': 'json_schema',
                'json_schema': {'name': 'pass2_repair', 'strict': True, 'schema': PASS2_SCHEMA},
            },
            'messages': [
                {'role': 'system', 'content': build_pass2_prompt(de, en, level, english_sentence, chinese_sentence)},
                {'role': 'user', 'content': f'Re-validate the proposal for target word "{de}".'},
            ],
        }
        try:
            result = call_openai(body, 'high')
        except RuntimeError as e:
            last_err = e
            continue
        raw = result['choices'][0]['message']['content']
        if not raw.strip():
            last_err = RuntimeError(f'empty content at max_completion_tokens={max_tokens}')
            continue
        return json.loads(raw), result.get('usage', {})
    raise last_err or RuntimeError('pass-2 repair failed for unknown reason')


# ---------------------------------------------------------------------------
# Step 2: the actual final decision — ACCEPT / REWRITE / INHERENTLY_AMBIGUOUS
# ---------------------------------------------------------------------------

FINAL_SCHEMA = {
    'type': 'object',
    'properties': {
        'status': {'type': 'string', 'enum': ['ACCEPT', 'REWRITE', 'INHERENTLY_AMBIGUOUS']},
        'reason': {'type': 'string'},
        'finalEnglishSentence': {'type': 'string'},
        'finalGerman': {'type': 'string'},
        'finalChinese': {'type': 'string'},
        'finalTargetForm': {'type': 'string'},
    },
    'required': [
        'status', 'reason', 'finalEnglishSentence', 'finalGerman',
        'finalChinese', 'finalTargetForm',
    ],
    'additionalProperties': False,
}


def describe_pass(label, pass_data):
    if pass_data is None:
        return f'{label}: (unavailable)'
    return (
        f'{label}: status={pass_data["status"]}, confidence={pass_data["confidence"]}\n'
        f'  reason: {pass_data["reason"]}\n'
        f'  EN: "{pass_data["englishSentence"]}"\n'
        f'  DE: "{pass_data["canonicalGerman"]}" (target form: "{pass_data["targetForm"]}")\n'
        f'  ZH: "{pass_data["chineseSentence"]}"'
    )


def build_final_prompt(entry, pass1, pass2):
    de, en, level = entry['de'], entry['en'], entry['level']
    return (
        f'You are making a FINAL, decisive quality call on one German vocabulary app '
        f'exercise sentence for CEFR {level} learners, testing the target word "{de}" '
        f'(English gloss: "{en}").\n\n'
        'This entry already went through two automated audit passes and was sent to '
        'manual review because the two passes disagreed or expressed low confidence. A '
        'human has since read all such entries and found that several are being '
        'repeatedly, pointlessly rewritten because a common German synonym simply cannot '
        'be uniquely pinned down by an English sentence alone (classic cases: denn vs '
        'weil, gewöhnlich vs normalerweise, or near-synonym nouns/verbs with heavy '
        'semantic overlap). Do not keep proposing new rewrites merely to try to eliminate '
        'every conceivable competing German word — the goal is that the target word is A '
        'natural, appropriate translation in context, not necessarily the ONLY '
        'conceivable one.\n\n'
        f'ORIGINAL (pre-audit) ENGLISH: "{entry["oldEnglishSentence"]}"\n'
        f'ORIGINAL (pre-audit) CHINESE: {entry["oldChineseSentence"] or "(none)"}\n\n'
        f'{describe_pass("PASS-1 PROPOSAL", pass1)}\n\n'
        f'{describe_pass("PASS-2 PROPOSAL", pass2)}\n\n'
        'Make exactly ONE final classification:\n\n'
        '- "ACCEPT" — the latest proposed EN/DE/ZH set (normally pass-2\'s, since it is '
        'the more validated judgment; fall back to pass-1\'s if pass-2 is unavailable or '
        'pass-1\'s is clearly the better version; or the untouched ORIGINAL if, on '
        'reflection, that was fine all along and the whole review cycle was unwarranted) '
        'is natural and pedagogically sound, the target word is a natural translation in '
        'context, and — even if another synonym could also work — the exercise is not '
        'misleading.\n'
        '- "REWRITE" — there is still a genuine, fixable problem: naturalness, meaning, '
        'grammar, CEFR fit, EN/DE/ZH disagreement, or the target word not being a '
        'sufficiently natural translation. Provide exactly ONE final, decisive replacement '
        '— do not hedge or propose something likely to need yet another round.\n'
        '- "INHERENTLY_AMBIGUOUS" — the target word IS a natural, correct choice, but no '
        'realistic English source sentence can distinguish it from another common German '
        'synonym without becoming artificial or over-engineered (e.g. denn vs weil, '
        'gewöhnlich vs normalerweise). This is a legitimate, final resting state — it is '
        'not a failure and does not need a replacement sentence.\n\n'
        'Always fill every schema field:\n'
        '- For ACCEPT or INHERENTLY_AMBIGUOUS: finalEnglishSentence/finalGerman/'
        'finalChinese/finalTargetForm must be EXACTLY the version you are accepting '
        '(copy it verbatim from whichever source — pass-2, pass-1, or the original — you '
        'judged best above; do not alter it).\n'
        '- For REWRITE: these fields are your new, final replacement sentence.\n\n'
        '"reason" should be one or two sentences, specific enough that a person can '
        'evaluate your judgment without re-deriving it, and — for INHERENTLY_AMBIGUOUS — '
        'should name the specific competing synonym.\n\n'
        'Respond only with the structured output required by the schema.'
    )


def run_final_review(entry, pass1, pass2):
    body = {
        'model': MODEL,
        'max_completion_tokens': 3000,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'final_review', 'strict': True, 'schema': FINAL_SCHEMA},
        },
        'messages': [
            {'role': 'system', 'content': build_final_prompt(entry, pass1, pass2)},
            {'role': 'user', 'content': f'Make the final call for target word "{entry["de"]}".'},
        ],
    }
    for max_tokens in (3000, 6000, 10000):
        body['max_completion_tokens'] = max_tokens
        result = call_openai(body, 'high')
        raw = result['choices'][0]['message']['content']
        if raw.strip():
            return json.loads(raw), result.get('usage', {})
    raise RuntimeError('final review returned empty content even after escalation')


def process_entry(wid, entry):
    pass1 = entry.get('pass1')
    pass2 = entry.get('pass2')
    usage = {}
    repaired_pass2 = False

    if pass2 is None and entry.get('pass2Error'):
        try:
            pass2, repair_usage = run_pass2_repair(
                entry['de'], entry['en'], entry['level'],
                pass1['englishSentence'], pass1['chineseSentence'],
            )
            usage['pass2_repair'] = repair_usage
            repaired_pass2 = True
        except Exception as e:
            usage['pass2_repair_error'] = str(e)

    final, final_usage = run_final_review(entry, pass1, pass2)
    usage['final'] = final_usage
    return wid, {
        'de': entry['de'], 'level': entry['level'],
        'oldEnglishSentence': entry['oldEnglishSentence'],
        'repairedPass2': repaired_pass2,
        'pass2Used': pass2,
        'final': final,
        'usage': usage,
    }


def main():
    with open(REVIEW_PATH, encoding='utf-8') as f:
        review = json.load(f)

    results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(process_entry, wid, entry): wid for wid, entry in review.items()}
        done = 0
        for fut in as_completed(futures):
            wid, record = fut.result()
            results[wid] = record
            done += 1
            print(f'{done}/{len(review)} done: {wid} ({record["de"]}) -> {record["final"]["status"]}', file=sys.stderr)

    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    counts = {'ACCEPT': 0, 'REWRITE': 0, 'INHERENTLY_AMBIGUOUS': 0}
    total_cost = 0.0
    for record in results.values():
        counts[record['final']['status']] += 1
        for u in record['usage'].values():
            if isinstance(u, dict):
                total_cost += (
                    u.get('prompt_tokens', 0) * PRICE_PER_TOKEN_IN
                    + u.get('completion_tokens', 0) * PRICE_PER_TOKEN_OUT
                )

    print('\n' + '=' * 70, file=sys.stderr)
    print(f'ACCEPT: {counts["ACCEPT"]}  REWRITE: {counts["REWRITE"]}  '
          f'INHERENTLY_AMBIGUOUS: {counts["INHERENTLY_AMBIGUOUS"]}', file=sys.stderr)
    print(f'Total cost: ${total_cost:.4f}', file=sys.stderr)
    print(f'Wrote {OUT_PATH}', file=sys.stderr)


if __name__ == '__main__':
    main()
