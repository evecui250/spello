#!/usr/bin/env python3
"""One-time corpus audit for the round-1 translation exercise's pre-baked
sentences (lib/words.ts's `exercisePrompt`/`exercisePromptZh` fields).

This is a corpus-build tool, NOT a runtime Edge Function — it never touches
lib/words.ts itself (see apply-exercise-audit.py for that). It re-checks a
question generate-exercise-prompts.py's own original pass already tried to
get right but never re-verified since: does the sentence actually elicit the
EXACT German target word, not just some word that happens to share its
English gloss? (This session hand-fixed one real instance of this failure —
`gelangen`'s prompt inviting "arrive at" instead of the preposition
`gelangen` actually needs.) `audit-word-fit.py`/`confirm-word-fit.py` already
run a narrower, cheaper, ongoing sweep for a related but different failure
mode (a more-common synonym fitting better) — this is a broader, one-time,
higher-rigor pass using gpt-5.6-sol, deliberately not reusing that pipeline.

Pass 1 audits every word with a baked exercisePrompt, one word per call, and
classifies it PASS / IMPROVE / REGENERATE. Anything other than PASS gets a
pass-2 revalidation call against its own proposed replacement before it's
ever allowed into the apply file — PASS entries are always left untouched,
per "preserve the existing sentence unless there is a genuine reason to
change it." Medium/low-confidence results never reach the apply file; they
go to a review file for manual inspection instead.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/audit-exercise-prompts.py [--limit N] [--level LEVEL]

Resumable: re-running only audits words still missing a result in
scripts/.exercise-audit-cache.json (gitignored). Writes, on completion:
    scripts/.exercise-audit-cache.json   every raw result, resumable
    scripts/.exercise-audit-apply.json   {id: {englishSentence, chineseSentence}}
    scripts/.exercise-audit-review.json  medium/low-confidence or still-failing entries
    scripts/.exercise-audit-report.json  summary counts
Then run scripts/apply-exercise-audit.py separately (after looking at the
review file) to actually bake the apply file into lib/words.ts.
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
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(SCRIPT_DIR, '.exercise-audit-cache.json')
APPLY_PATH = os.path.join(SCRIPT_DIR, '.exercise-audit-apply.json')
REVIEW_PATH = os.path.join(SCRIPT_DIR, '.exercise-audit-review.json')
REPORT_PATH = os.path.join(SCRIPT_DIR, '.exercise-audit-report.json')

MODEL = 'gpt-5.6-sol'
MAX_WORKERS = 4

# gpt-5.6-sol's promotional pricing (through Nov 2026): $4/$20 per 1M
# input/output tokens. Corpus-build-tool-local — this is a one-off script,
# not the live app's admin-stats tracking, so it doesn't share that file's
# MODEL_PRICING table.
PRICE_PER_TOKEN_IN = 4.0 / 1_000_000
PRICE_PER_TOKEN_OUT = 20.0 / 1_000_000

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

ID_RE = re.compile(r"id:\s*'(\w+)'")
DE_RE = re.compile(r"\bde:\s*'((?:[^'\\]|\\.)*)'")
EN_RE = re.compile(r"\ben:\s*'((?:[^'\\]|\\.)*)'")
ZH_RE = re.compile(r"\bzh:\s*'((?:[^'\\]|\\.)*)'")
LEVEL_RE = re.compile(r"\blevel:\s*'(\w+)'")
PROMPT_RE = re.compile(r'exercisePrompt:\s*"((?:[^"\\]|\\.)*)"')
PROMPT_ZH_RE = re.compile(r'exercisePromptZh:\s*"((?:[^"\\]|\\.)*)"')


def unescape(s):
    return s.replace("\\'", "'").replace('\\"', '"')


def parse_words():
    with open(WORDS_PATH, encoding='utf-8') as f:
        lines = f.readlines()
    words = []
    for line in lines:
        id_m = ID_RE.search(line)
        prompt_m = PROMPT_RE.search(line)
        if not id_m or not prompt_m:
            continue
        de_m, en_m, zh_m, level_m, prompt_zh_m = (
            DE_RE.search(line), EN_RE.search(line), ZH_RE.search(line),
            LEVEL_RE.search(line), PROMPT_ZH_RE.search(line),
        )
        if not de_m or not en_m or not level_m:
            continue
        words.append({
            'id': id_m.group(1),
            'de': unescape(de_m.group(1)),
            'en': unescape(en_m.group(1)),
            'zh': unescape(zh_m.group(1)) if zh_m else None,
            'level': level_m.group(1),
            'exercisePrompt': unescape(prompt_m.group(1)),
            'exercisePromptZh': unescape(prompt_zh_m.group(1)) if prompt_zh_m else None,
        })
    return words


AUDIT_SCHEMA = {
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


def build_prompt(de, en, level, english_sentence, chinese_sentence):
    zh_line = f'"{chinese_sentence}"' if chinese_sentence else '(none provided)'
    return (
        f'You are auditing a German vocabulary app\'s translation-exercise sentences for '
        f'CEFR {level} learners. Each exercise gives a learner an English sentence to '
        f'translate into German; the exercise is testing one specific German target word.\n\n'
        f'TARGET WORD: "{de}" (English gloss: "{en}")\n'
        f'CEFR level: {level}\n'
        f'EXISTING ENGLISH EXERCISE SENTENCE: "{english_sentence}"\n'
        f'EXISTING CHINESE EXERCISE SENTENCE: {zh_line}\n\n'
        'THE CENTRAL QUESTION: does this exercise naturally elicit the exact German target '
        f'word being taught — i.e. if a learner correctly translates the English sentence '
        f'into German, would "{de}" (in its correct grammatical form) be one of the most '
        'natural words they\'d reach for, not merely a technically-possible one?\n\n'
        'A sentence should NOT pass merely because the target word is technically able to '
        'fit — German often has several words sharing the same English gloss, each with '
        f'different nuance/grammar/register, and an exercise that could just as easily (or '
        f'more easily) be answered with a different German word is a bad exercise even if '
        f'"{de}" isn\'t wrong per se.\n\n'
        'PASS only when ALL of the following hold:\n'
        f'- "{de}" is a natural, idiomatic way to translate the relevant part of the '
        'sentence\'s meaning;\n'
        f'- a learner arriving at the intended German translation would reasonably reach '
        f'for "{de}" specifically;\n'
        '- the sentence\'s context reflects the target word\'s actual semantic nuance and '
        'grammatical behavior (the case/preposition it governs, transitivity, etc.);\n'
        '- there is no clearly more natural German synonym that would make this exercise '
        'misleading (i.e. a learner translating naturally would likely reach for a '
        'DIFFERENT German word instead);\n'
        f'- the sentence is natural, meaningful, and appropriate in difficulty for CEFR '
        f'{level} (not needlessly complex, and not artificially simple);\n'
        '- the English and Chinese versions (when a Chinese version is given) express the '
        'same intended meaning as each other.\n\n'
        'Classify the existing sentence as exactly one of:\n'
        '- "PASS" — meets every criterion above; keep it as-is.\n'
        '- "IMPROVE" — the core scenario is basically fine but needs a targeted fix (e.g. '
        'wrong preposition/case cue, a detail nudging toward a competing synonym, a minor '
        'naturalness issue) while keeping roughly the same scenario.\n'
        '- "REGENERATE" — the sentence\'s whole scenario/structure doesn\'t naturally fit '
        'the target word\'s real usage and needs to be rebuilt from scratch around it.\n\n'
        'If IMPROVE or REGENERATE, you must also produce a replacement. Design the '
        'replacement AROUND THE GERMAN TARGET WORD\'S OWN MEANING, GRAMMAR, AND NUANCE — '
        'not around the English gloss in isolation (the English gloss is often ambiguous or '
        f'shared by several German words; build the scene from what "{de}" specifically '
        'means and how it\'s actually used in German, then write the English sentence that '
        f'scene would naturally translate into). The German target word must be one of the '
        'most natural ways a learner would translate your new English sentence — where '
        f'possible, make the sentence\'s context lean on "{de}"\'s own particular nuance '
        'clearly enough that a competing German synonym is noticeably less natural a fit, '
        'not just equally valid.\n\n'
        'This matters a lot for German, where one English gloss often maps to several German '
        'words with different grammatical patterns: a real, confirmed miss was generating '
        '"I advise you to check the address" for the target word "beraten" — that '
        'ADVISE-SOMEONE-TO-DO-X sentence shape is what "raten" (dative person + zu + '
        'infinitive) naturally fits, not "beraten" (accusative person, closer to '
        '"consult with/counsel", not naturally followed by "advise them TO DO a specific '
        'action"); a sentence like "I meet my lawyer because she advises me well in '
        f'financial matters" fits "beraten" instead. Before finalizing, recall "{de}"\'s '
        'actual German grammar (which case/preposition it governs, whether it takes a '
        'direct object, an infinitive clause, etc.) and make sure your sentence actually '
        'calls for that exact pattern.\n\n'
        'Whether PASS, IMPROVE, or REGENERATE, always also provide every schema field:\n'
        '- "englishSentence": the FINAL English sentence — the existing one, unchanged, if '
        'PASS; your new one if IMPROVE/REGENERATE.\n'
        f'- "canonicalGerman": a natural, correct German sentence using "{de}" (in its '
        'correct inflected/conjugated form) that translates the FINAL englishSentence. '
        'This is for corpus reference/validation, not necessarily what a learner must match '
        'exactly.\n'
        f'- "targetForm": the exact inflected/conjugated form of "{de}" as it appears in '
        'canonicalGerman.\n'
        '- "chineseSentence": a natural, fluent Simplified Chinese translation of the FINAL '
        'englishSentence (meaning-for-meaning, not word-for-word) — generate this FRESH from '
        'the final English/German meaning; do NOT simply reuse or lightly edit the existing '
        'Chinese sentence if the English changed, since the existing Chinese was translated '
        'from potentially-flawed old English. Keep the tense unambiguous (use 了 or an '
        'explicit time word for a completed/past action; keep it bare for present/habitual).\n'
        '- "confidence": how sure you are of this whole judgment — "high" only when you are '
        'certain; "medium" for real but small uncertainty (e.g. a borderline register/'
        'naturalness call); "low" if you are genuinely unsure (e.g. the target word\'s own '
        'usage is itself unusual or idiomatic, or you\'re not fully confident a claimed '
        'competing synonym is actually more natural). Be honest and conservative — a wrong '
        'low-confidence guess is far less costly than a wrong high-confidence one, since '
        'low-confidence results are reviewed by a person before anything is changed.\n'
        '- "reason": one or two sentences explaining your classification, specific enough '
        'that a person could evaluate your judgment without re-deriving it themselves.\n\n'
        'Respond only with the structured output required by the schema.'
    )


# gpt-5.6-sol is the same reasoning-tier family this session already learned
# the hard way with gpt-5.6-luna: no custom temperature, max_completion_tokens
# instead of max_tokens, and a reported (never yet observed here) risk that
# some non-default reasoning_effort values get rejected outright on
# /chat/completions. Each level falls back exactly one step (high->medium,
# medium->low) if OpenAI's own error text specifically calls out
# reasoning_effort as the problem — cheap insurance, not a real expectation.
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


# Pass 1 (first look at every entry in the corpus) runs at 'medium' — most
# entries are already fine, and spending high-reasoning tokens on thousands
# of obviously-good sentences is wasted cost. Pass 2 (revalidation) only
# ever runs for entries pass 1 flagged IMPROVE/REGENERATE — exactly the
# questionable/ambiguous minority worth the stronger, more expensive 'high'
# reasoning.
# Reasoning tokens are billed from (and truncate) the same
# max_completion_tokens budget as the visible JSON output — confirmed live:
# a real audit call spent 382 of a 700-token budget on hidden reasoning
# before writing its answer, and on harder entries the budget can run out
# entirely, leaving an empty message.content that fails to parse. 2000 gives
# generous headroom for that at negligible cost (unused budget isn't billed,
# only tokens actually generated are); a one-time escalation to 4000 covers
# the rare case even that isn't enough.
DEFAULT_MAX_TOKENS = 2000
ESCALATED_MAX_TOKENS = 4000


def run_audit(de, en, level, english_sentence, chinese_sentence, reasoning_effort,
               rate_limit_retries=0, max_tokens=DEFAULT_MAX_TOKENS, escalated=False):
    body = {
        'model': MODEL,
        'max_completion_tokens': max_tokens,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'exercise_audit', 'strict': True, 'schema': AUDIT_SCHEMA},
        },
        'messages': [
            {'role': 'system', 'content': build_prompt(de, en, level, english_sentence, chinese_sentence)},
            {'role': 'user', 'content': f'Audit the exercise for the target word "{de}".'},
        ],
    }
    try:
        result = call_openai(body, reasoning_effort)
    except RuntimeError as e:
        msg = str(e)
        if '429' in msg.split(':', 1)[0] and rate_limit_retries < 8:
            time.sleep(min(2 ** (rate_limit_retries + 1), 30))
            return run_audit(
                de, en, level, english_sentence, chinese_sentence, reasoning_effort,
                rate_limit_retries + 1, max_tokens, escalated,
            )
        raise
    raw = result['choices'][0]['message']['content']
    if not raw.strip():
        if escalated:
            raise RuntimeError(
                f"empty content even at {ESCALATED_MAX_TOKENS} max_completion_tokens "
                f"(finish_reason={result['choices'][0].get('finish_reason')})"
            )
        return run_audit(
            de, en, level, english_sentence, chinese_sentence, reasoning_effort,
            rate_limit_retries, ESCALATED_MAX_TOKENS, True,
        )
    return json.loads(raw), result.get('usage', {})


def audit_word(word):
    wid = word['id']
    try:
        pass1, usage1 = run_audit(
            word['de'], word['en'], word['level'],
            word['exercisePrompt'], word['exercisePromptZh'], 'medium',
        )
    except Exception as e:
        return wid, {'error': str(e)}

    record = {'pass1': pass1, 'usage': {'pass1': usage1}}
    if pass1['status'] == 'PASS':
        record['final'] = 'pass'
        return wid, record

    try:
        pass2, usage2 = run_audit(
            word['de'], word['en'], word['level'],
            pass1['englishSentence'], pass1['chineseSentence'], 'high',
        )
    except Exception as e:
        record['pass2_error'] = str(e)
        record['final'] = 'review'
        return wid, record

    record['pass2'] = pass2
    record['usage']['pass2'] = usage2
    if pass2['status'] == 'PASS' and pass2['confidence'] in ('high', 'medium') and pass1['confidence'] in ('high', 'medium'):
        record['final'] = 'apply'
    else:
        record['final'] = 'review'
    return wid, record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--level', type=str, default=None)
    parser.add_argument(
        '--ids', type=str, default=None,
        help='Comma-separated word ids to audit (e.g. w0123,w0456) — overrides --limit/--level scoping.',
    )
    parser.add_argument(
        '--words', type=str, default=None,
        help='Comma-separated German lemmas to audit (e.g. gelangen,beraten) — overrides --limit/--level scoping.',
    )
    args = parser.parse_args()

    words = parse_words()
    if args.level:
        words = [w for w in words if w['level'] == args.level]
    if args.ids:
        wanted_ids = {x.strip() for x in args.ids.split(',') if x.strip()}
        words = [w for w in words if w['id'] in wanted_ids]
        missing = wanted_ids - {w['id'] for w in words}
        if missing:
            print(f'--ids not found (no exercisePrompt, or unknown id): {sorted(missing)}', file=sys.stderr)
    if args.words:
        wanted_lemmas = {x.strip().lower() for x in args.words.split(',') if x.strip()}
        words = [w for w in words if w['de'].lower() in wanted_lemmas]
        found_lemmas = {w['de'].lower() for w in words}
        missing = wanted_lemmas - found_lemmas
        if missing:
            print(f'--words not found (no exercisePrompt, or unknown lemma): {sorted(missing)}', file=sys.stderr)

    results = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding='utf-8') as f:
            results = json.load(f)

    targets = [w for w in words if w['id'] not in results]
    if args.limit is not None:
        targets = targets[:args.limit]
    print(f'{len(targets)} words to audit (resuming {len(results)} already cached)', file=sys.stderr)

    by_id = {w['id']: w for w in words}
    start = time.time()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(audit_word, w): w for w in targets}
        done = 0
        for fut in as_completed(futures):
            wid, record = fut.result()
            done += 1
            results[wid] = record
            if done % 20 == 0:
                print(f'{done}/{len(targets)} done ({time.time() - start:.0f}s)', file=sys.stderr)
                with open(CACHE_PATH, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=1)

    with open(CACHE_PATH, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=1)

    apply_out, review_out = {}, {}
    counts = {'PASS': 0, 'IMPROVE': 0, 'REGENERATE': 0, 'error': 0}
    for wid, record in results.items():
        word = by_id.get(wid)
        if word is None:
            continue
        pass1 = record.get('pass1')
        if pass1 is None:
            counts['error'] += 1
            continue
        counts[pass1['status']] = counts.get(pass1['status'], 0) + 1
        if record['final'] == 'apply':
            pass2 = record['pass2']
            apply_out[wid] = {
                'englishSentence': pass2['englishSentence'],
                'chineseSentence': pass2['chineseSentence'],
            }
        elif record['final'] == 'review':
            review_out[wid] = {
                'de': word['de'], 'en': word['en'], 'level': word['level'],
                'oldEnglishSentence': word['exercisePrompt'],
                'oldChineseSentence': word['exercisePromptZh'],
                'pass1': pass1,
                'pass2': record.get('pass2'),
                'pass2Error': record.get('pass2_error'),
            }

    with open(APPLY_PATH, 'w', encoding='utf-8') as f:
        json.dump(apply_out, f, ensure_ascii=False, indent=1)
    with open(REVIEW_PATH, 'w', encoding='utf-8') as f:
        json.dump(review_out, f, ensure_ascii=False, indent=1)

    total_cost_usd, priced_entries, pass2_triggered = 0.0, 0, 0
    for record in results.values():
        usage = record.get('usage')
        if not usage:
            continue
        priced_entries += 1
        if 'pass2' in record or record.get('pass2_error'):
            pass2_triggered += 1
        for call_usage in usage.values():
            total_cost_usd += (
                call_usage.get('prompt_tokens', 0) * PRICE_PER_TOKEN_IN
                + call_usage.get('completion_tokens', 0) * PRICE_PER_TOKEN_OUT
            )

    report = {
        'totalChecked': len([r for r in results.values() if 'pass1' in r]),
        'passCount': counts['PASS'],
        'improveCount': counts['IMPROVE'],
        'regenerateCount': counts['REGENERATE'],
        'errorCount': counts['error'],
        'appliedCount': len(apply_out),
        'reviewCount': len(review_out),
        'pass2TriggeredCount': pass2_triggered,
        'totalCostUsd': round(total_cost_usd, 4),
        'avgCostPerEntryUsd': round(total_cost_usd / priced_entries, 4) if priced_entries else None,
        'costPricedEntryCount': priced_entries,
    }
    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    print(json.dumps(report, indent=1), file=sys.stderr)
    print(f'Wrote {len(apply_out)} auto-approved changes to {APPLY_PATH}', file=sys.stderr)
    print(f'Wrote {len(review_out)} entries needing manual review to {REVIEW_PATH}', file=sys.stderr)
    print('Next: inspect the review file, then run scripts/apply-exercise-audit.py.', file=sys.stderr)


if __name__ == '__main__':
    main()
