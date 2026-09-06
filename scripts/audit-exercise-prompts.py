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

# Bumped whenever build_prompt's audit criteria change materially — a
# cached result whose promptVersion doesn't match this is treated as if it
# were never audited at all (see main()'s cache-loading), so a criteria
# change can never silently reuse a judgment made under the old rules. v1
# was the original strict-CEFR pass (the 50-word sample test run); v2
# relaxed sentence length and vocabulary from hard limits to soft
# preferences.
PROMPT_VERSION = 'v2-soft-cefr'

# Sentence-length target per level — a SOFT preference now (see
# build_prompt below), kept in sync with the same dict in
# generate-exercise-prompts.py and the generate-sentence Edge Function.
WORD_RANGE = {
    'A1': (3, 6), 'A2': (4, 8), 'B1': (6, 12), 'B2': (8, 14),
    'C1': (10, 16), 'C2': (12, 18),
}

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

_AUDIT_REQUIRED_FIELDS = AUDIT_SCHEMA['required']


# Defensive validation of the model's own Structured Output — strict-mode
# Structured Outputs SHOULD guarantee this shape server-side, but this
# script runs unattended for hours across a real paid batch, so a single
# malformed/truncated response must never crash the whole run (or the
# whole ThreadPoolExecutor batch, since an uncaught exception inside a
# worker re-raises when its Future.result() is read in main()). Raising
# here routes a bad response through the exact same error-handling path
# genuine API/network failures already use, rather than a KeyError
# surfacing somewhere unrelated.
def validate_audit_result(d):
    if not isinstance(d, dict):
        raise ValueError(f'response was not a JSON object: {d!r}')
    missing = [k for k in _AUDIT_REQUIRED_FIELDS if k not in d]
    if missing:
        raise ValueError(f'response missing required field(s): {missing}')
    if d['status'] not in ('PASS', 'IMPROVE', 'REGENERATE'):
        raise ValueError(f"invalid status: {d['status']!r}")
    if d['confidence'] not in ('high', 'medium', 'low'):
        raise ValueError(f"invalid confidence: {d['confidence']!r}")
    return d


LEVEL_VOCAB_GUIDANCE = {
    'A1': 'strongly prefer high-frequency A1 vocabulary and very simple sentences',
    'A2': 'strongly prefer A1 vocabulary or common A2 words',
    'B1': 'prefer A1/A2 vocabulary; a B1-level word is fine when it is genuinely useful',
    'B2': 'prefer A1-B1 vocabulary; a B2-level word is fine when it is genuinely useful',
    'C1': 'vocabulary restriction loosens further at this level — prioritize natural, idiomatic usage',
    'C2': 'vocabulary restriction loosens further at this level — prioritize natural, idiomatic usage',
}


def build_prompt(de, en, level, english_sentence, chinese_sentence):
    zh_line = f'"{chinese_sentence}"' if chinese_sentence else '(none provided)'
    min_w, max_w = WORD_RANGE.get(level, (6, 14))
    vocab_guidance = LEVEL_VOCAB_GUIDANCE.get(level, LEVEL_VOCAB_GUIDANCE['B1'])
    return (
        f'You are auditing a German vocabulary app\'s translation-exercise sentences for '
        f'CEFR {level} learners. Each exercise gives a learner an English sentence to '
        f'translate into German; the exercise is testing one specific German target word.\n\n'
        f'TARGET WORD: "{de}" (English gloss: "{en}")\n'
        f'CEFR level: {level}\n'
        f'EXISTING ENGLISH EXERCISE SENTENCE: "{english_sentence}"\n'
        f'EXISTING CHINESE EXERCISE SENTENCE: {zh_line}\n\n'
        'Judge this exercise against these priorities, IN ORDER. A higher-priority issue '
        'always matters more than a lower one, and a LOWER-priority nitpick alone should '
        'NEVER by itself cause an IMPROVE/REGENERATE classification:\n\n'
        '1. NATURAL ENGLISH — does the English sentence itself read naturally, not stilted '
        'or artificial?\n'
        '2. TARGET WORD FIT (the central question) — does this exercise naturally elicit '
        f'the exact German target word being taught? If a learner correctly translates the '
        f'English sentence into German, would "{de}" (in its correct grammatical form) be '
        'one of the most natural words they\'d reach for — not merely a technically-possible '
        'one? German often has several words sharing the same English gloss, each with '
        'different nuance/grammar/register; an exercise that could just as easily (or more '
        f'easily) be answered with a DIFFERENT German word is a bad exercise even if "{de}" '
        'isn\'t wrong per se.\n'
        '3. NATURAL/CORRECT CANONICAL GERMAN — is the German translation itself '
        'grammatically correct and idiomatic (right case/preposition, transitivity, word '
        'order)?\n'
        '4. EN/DE/ZH AGREEMENT — do the English sentence, the canonical German, and the '
        'Chinese version (when one is given) all express the same intended meaning?\n'
        f'5. CEFR-APPROPRIATE DIFFICULTY — is the sentence\'s overall difficulty roughly '
        f'right for CEFR {level} (not needlessly complex for the level, not so trivial it '
        'teaches nothing)? This is a soft judgment call, not a precise gate.\n'
        '6. NON-TARGET VOCABULARY DIFFICULTY — is vocabulary OTHER than the target '
        f'unnecessarily hard for the level? {vocab_guidance}. A word from the SAME level, or '
        'one genuinely useful for natural phrasing or a natural collocation, is FINE — do '
        'not flag this alone. Only a CLEARLY higher-level word used where a simpler one '
        'would have worked just as naturally is worth noting here.\n'
        f'7. SENTENCE LENGTH — roughly {min_w}-{max_w} words is a soft preference for this '
        'level when practical, not a requirement. Do not flag a sentence for being '
        'moderately shorter or longer than this range if it otherwise reads naturally.\n\n'
        'The decision to IMPROVE/REGENERATE should be driven overwhelmingly by priorities '
        '1-4 (does the sentence naturally elicit the target word, and is everything correct '
        'and mutually consistent) — never by priority 6 or 7 alone. Naturalness and correct '
        'target-word usage always outrank vocabulary/length polish: a sentence that '
        'correctly, naturally elicits the target word but contains one same-level word or '
        'runs a bit long/short should PASS, not IMPROVE.\n\n'
        'PASS unless a real priority-1-through-5 issue exists — a priority-6/7 observation '
        'alone is never sufficient grounds for IMPROVE/REGENERATE:\n'
        f'- "{de}" is a natural, idiomatic way to translate the relevant part of the '
        'sentence\'s meaning, and there is no clearly more natural German synonym that would '
        'make this exercise misleading (priority 2);\n'
        '- the sentence\'s context reflects the target word\'s actual semantic nuance and '
        'grammatical behavior (priorities 2-3);\n'
        '- the English, canonical German, and Chinese (when given) agree in meaning '
        '(priority 4);\n'
        f'- the sentence is natural and roughly appropriate in difficulty for CEFR {level} '
        '(priority 5) — this is a loose fit check, not a strict one.\n\n'
        'Classify the existing sentence as exactly one of:\n'
        '- "PASS" — no real priority-1-through-5 issue; keep it as-is, even if it has a '
        'minor priority-6/7 quirk.\n'
        '- "IMPROVE" — the core scenario is basically fine but needs a targeted fix to a '
        'priority-1-through-5 issue (e.g. wrong preposition/case cue, a detail nudging '
        'toward a competing synonym, an EN/DE/ZH mismatch) while keeping roughly the same '
        'scenario.\n'
        '- "REGENERATE" — the sentence\'s whole scenario/structure doesn\'t naturally fit '
        'the target word\'s real usage (priority 2) and needs to be rebuilt from scratch '
        'around it.\n\n'
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
    parsed = validate_audit_result(json.loads(raw))
    return parsed, result.get('usage', {})


# A network/HTTP failure at the pass-1 stage wastes essentially no money
# (nothing was generated yet) and is usually transient, so it's worth
# retrying automatically across resumes rather than requiring a person to
# notice and re-run it manually — but a persistently-broken entry (a real,
# non-transient problem: content-policy refusal, a permanently malformed
# prompt, etc.) must eventually stop being retried and surface for a human
# to look at, rather than silently burning a request every single run
# forever. attempts is carried forward from any prior cached attempt (see
# main()'s resumability logic) so this cap holds across separate
# invocations, not just within one.
MAX_ERROR_RETRIES = 3


def audit_word(word, prior_attempts=0):
    wid = word['id']
    try:
        pass1, usage1 = run_audit(
            word['de'], word['en'], word['level'],
            word['exercisePrompt'], word['exercisePromptZh'], 'medium',
        )
    except Exception as e:
        attempts = prior_attempts + 1
        return wid, {
            'error': str(e), 'attempts': attempts,
            'terminal': attempts >= MAX_ERROR_RETRIES,
            'promptVersion': PROMPT_VERSION,
        }

    record = {'pass1': pass1, 'usage': {'pass1': usage1}, 'promptVersion': PROMPT_VERSION}
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
        stale_ids = [wid for wid, r in results.items() if r.get('promptVersion') != PROMPT_VERSION]
        if stale_ids:
            preview = sorted(stale_ids)[:10]
            more = f' and {len(stale_ids) - 10} more' if len(stale_ids) > 10 else ''
            print(
                f'{len(stale_ids)} cached result(s) predate audit-prompt version '
                f'{PROMPT_VERSION!r} (or have none recorded) and will be RE-AUDITED under the '
                f'current prompt, not reused: {preview}{more}', file=sys.stderr,
            )

    # An id needs (re-)auditing if: never audited, audited under a stale
    # prompt version (full re-audit, not a "retry" — attempts resets to 0),
    # or left as a non-terminal error by a prior run (retried, carrying its
    # attempt count forward so MAX_ERROR_RETRIES holds across invocations).
    def needs_audit(wid):
        record = results.get(wid)
        if record is None:
            return True, 0
        if record.get('promptVersion') != PROMPT_VERSION:
            return True, 0
        if 'error' in record and not record.get('terminal'):
            return True, record.get('attempts', 0)
        return False, 0

    targets, target_attempts = [], {}
    for w in words:
        needs, attempts = needs_audit(w['id'])
        if needs:
            targets.append(w)
            target_attempts[w['id']] = attempts
    if args.limit is not None:
        targets = targets[:args.limit]
    already_done = len(words) - len(targets)
    print(f'{len(targets)} words to audit ({already_done} already done under the current prompt version)', file=sys.stderr)

    by_id = {w['id']: w for w in words}
    start = time.time()
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(audit_word, w, target_attempts.get(w['id'], 0)): w for w in targets}
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
    counts = {'PASS': 0, 'IMPROVE': 0, 'REGENERATE': 0}
    by_level = {}
    error_count, terminal_error_count = 0, 0
    for wid, record in results.items():
        word = by_id.get(wid)
        if word is None:
            continue
        # Excludes any entry not yet re-audited this run under the current
        # prompt (e.g. left outside a --limit/--ids slice) — it'll be
        # picked up and reported once it actually gets re-audited.
        if record.get('promptVersion') != PROMPT_VERSION:
            continue

        level_counts = by_level.setdefault(word['level'], {
            'PASS': 0, 'IMPROVE': 0, 'REGENERATE': 0, 'applied': 0, 'review': 0, 'error': 0,
        })

        if 'error' in record:
            error_count += 1
            level_counts['error'] += 1
            if record.get('terminal'):
                terminal_error_count += 1
            # Always surfaced, terminal or not — an entry that failed
            # every attempt is never silently dropped, and one still
            # eligible for retry is still visible (flagged pendingRetry)
            # rather than invisibly missing from every output file.
            review_out[wid] = {
                'de': word['de'], 'en': word['en'], 'level': word['level'],
                'oldEnglishSentence': word['exercisePrompt'],
                'oldChineseSentence': word['exercisePromptZh'],
                'error': record['error'],
                'attempts': record.get('attempts', 1),
                'pendingRetry': not record.get('terminal', False),
            }
            continue

        pass1 = record['pass1']
        counts[pass1['status']] += 1
        level_counts[pass1['status']] += 1
        if record['final'] == 'apply':
            pass2 = record['pass2']
            apply_out[wid] = {
                'englishSentence': pass2['englishSentence'],
                'chineseSentence': pass2['chineseSentence'],
                'canonicalGerman': pass2['canonicalGerman'],
                'targetForm': pass2['targetForm'],
            }
            level_counts['applied'] += 1
        elif record['final'] == 'review':
            review_out[wid] = {
                'de': word['de'], 'en': word['en'], 'level': word['level'],
                'oldEnglishSentence': word['exercisePrompt'],
                'oldChineseSentence': word['exercisePromptZh'],
                'pass1': pass1,
                'pass2': record.get('pass2'),
                'pass2Error': record.get('pass2_error'),
            }
            level_counts['review'] += 1

    with open(APPLY_PATH, 'w', encoding='utf-8') as f:
        json.dump(apply_out, f, ensure_ascii=False, indent=1)
    with open(REVIEW_PATH, 'w', encoding='utf-8') as f:
        json.dump(review_out, f, ensure_ascii=False, indent=1)

    # Cost is summed across EVERY priced entry ever recorded in the cache
    # (including a stale prompt version) — this is real cumulative spend,
    # not just this run's — but stalePricedEntryCount says how much of that
    # reflects superseded (pre-relaunch) judgments, so the two numbers are
    # never confused with each other.
    total_cost_usd, priced_entries, stale_priced_entries, pass2_triggered = 0.0, 0, 0, 0
    for record in results.values():
        usage = record.get('usage')
        if not usage:
            continue
        priced_entries += 1
        if record.get('promptVersion') != PROMPT_VERSION:
            stale_priced_entries += 1
        if 'pass2' in record or record.get('pass2_error'):
            pass2_triggered += 1
        for call_usage in usage.values():
            total_cost_usd += (
                call_usage.get('prompt_tokens', 0) * PRICE_PER_TOKEN_IN
                + call_usage.get('completion_tokens', 0) * PRICE_PER_TOKEN_OUT
            )

    report = {
        'promptVersion': PROMPT_VERSION,
        'totalChecked': counts['PASS'] + counts['IMPROVE'] + counts['REGENERATE'],
        'passCount': counts['PASS'],
        'improveCount': counts['IMPROVE'],
        'regenerateCount': counts['REGENERATE'],
        'errorCount': error_count,
        'terminalErrorCount': terminal_error_count,
        'appliedCount': len(apply_out),
        'reviewCount': len(review_out),
        'pass2TriggeredCount': pass2_triggered,
        'totalApiCalls': priced_entries + pass2_triggered,
        'totalCostUsd': round(total_cost_usd, 4),
        'avgCostPerEntryUsd': round(total_cost_usd / priced_entries, 4) if priced_entries else None,
        'costPricedEntryCount': priced_entries,
        'stalePricedEntryCount': stale_priced_entries,
        'byLevel': by_level,
    }
    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    print(json.dumps(report, indent=1), file=sys.stderr)
    print(f'Wrote {len(apply_out)} auto-approved changes to {APPLY_PATH}', file=sys.stderr)
    print(f'Wrote {len(review_out)} entries needing manual review to {REVIEW_PATH}', file=sys.stderr)
    print('Next: inspect the review file, then run scripts/apply-exercise-audit.py.', file=sys.stderr)


if __name__ == '__main__':
    main()
