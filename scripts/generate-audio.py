#!/usr/bin/env python3
"""Batch (re)generator for per-word pronunciation audio (public/audio/{id}.mp3).

Uses gpt-4o-mini-tts (the model that replaced the original tts-1-hd/nova
pipeline for a handful of previously-flagged A1/A2 words — see git history
around "Switch to gpt-4o-mini-tts with German-accent instructions") with an
explicit Hochdeutsch-accent instruction, since gpt-4o-mini-tts (unlike
tts-1/tts-1-hd) accepts free-text style/accent steering. Keeps the same
"nova" voice identity and the same speed: 0.85 pacing the corpus has used
since "Regenerate all audio slower and clearer" — only the model and accent
steering are new.

Each clip is volume-normalized to match TARGET_MEAN_VOLUME_DB (measured from
a random sample of this level's existing files before regeneration — see the
one-off ffmpeg volumedetect pass this script's own history was built from),
since gpt-4o-mini-tts's raw output runs louder than the old model's.

Verified via Whisper (whisper-1) transcription of the FINAL normalized clip
against the expected spoken text — one automatic retry (fresh TTS call) on a
mismatch, then flagged for a by-ear check if it still doesn't match.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-audio.py --level B1
    OPENAI_API_KEY=sk-... python3 scripts/generate-audio.py --level B1 --ids w003,w042
    OPENAI_API_KEY=sk-... python3 scripts/generate-audio.py --level B1 --dry-run  # pilot, doesn't overwrite public/audio

Resumable: re-running only (re)does words missing from, or flagged in,
scripts/.audio-regen-manifest-{level}.json (gitignored) — safe to re-run
after an interruption. Delete a word's entry from the manifest (or the
whole file) to force it to be redone.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import urllib.error
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_PATH = os.path.join(REPO_ROOT, 'lib', 'words.ts')
AUDIO_DIR = os.path.join(REPO_ROOT, 'public', 'audio')

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

MODEL = 'gpt-4o-mini-tts'
VOICE = 'nova'
SPEED = 1.0
ACCENT_INSTRUCTIONS = (
    "Speak in clear, authentic Standard High German (Hochdeutsch), as a native "
    "German speaker would. Use genuine German vowel sounds, consonants, and "
    "word stress throughout -- never American- or English-influenced "
    "pronunciation, even for words whose spelling happens to resemble an "
    "English word (e.g. pronounce them fully as German words, not as their "
    "English look-alikes). Speak at a normal, brisk conversational pace, as a "
    "short standalone dictionary-style pronunciation clip -- do not pause or "
    "add any silence before or after the word."
)

ENTRY_RE = re.compile(
    r"\{\s*id:\s*'(?P<id>\w+)',\s*de:\s*'(?P<de>(?:[^'\\]|\\.)*)'"
    r"(?:,\s*article:\s*'(?P<article>[^']*)')?.*?"
    r"level:\s*'(?P<level>\w+)'"
)


def parse_words(level_filter=None):
    with open(WORDS_PATH, encoding='utf-8') as f:
        content = f.read()
    words = []
    for m in ENTRY_RE.finditer(content):
        level = m.group('level')
        if level_filter and level != level_filter:
            continue
        words.append({'id': m.group('id'), 'de': m.group('de'), 'article': m.group('article')})
    return words


def spoken_text(word):
    return f"{word['article']} {word['de']}" if word.get('article') else word['de']


class InsufficientQuotaError(Exception):
    """Raised the moment the account's OpenAI balance actually runs out --
    distinct from an ordinary rate limit, which also surfaces as HTTP 429
    but is transient/worth retrying. Without this distinction, with_retry
    below would treat "out of money" exactly like "rate limited" and burn
    up to 8 exponential-backoff retries PER remaining word before finally
    giving up on each one individually -- looking like it's just slow
    rather than telling the caller to stop immediately. Checked directly
    against the response body's OpenAI-documented {"error": {"type":
    "insufficient_quota"}} shape rather than inferring it from anything
    weaker (e.g. HTTP code alone), since a real transient 429 must still
    retry normally.
    """
    pass


def _raise_if_insufficient_quota(http_error):
    try:
        body = json.loads(http_error.read())
    except Exception:
        return
    err = body.get('error') or {}
    if err.get('type') == 'insufficient_quota' or err.get('code') == 'insufficient_quota':
        raise InsufficientQuotaError(err.get('message') or 'OpenAI account balance exhausted (insufficient_quota).')


def call_tts(text):
    body = {
        'model': MODEL, 'voice': VOICE, 'input': text,
        'instructions': ACCENT_INSTRUCTIONS, 'speed': SPEED, 'response_format': 'mp3',
    }
    req = urllib.request.Request(
        'https://api.openai.com/v1/audio/speech',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {API_KEY}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        if e.code == 429:
            _raise_if_insufficient_quota(e)
        raise


def call_whisper(mp3_path):
    boundary = '----spelloaudio'
    with open(mp3_path, 'rb') as f:
        audio_bytes = f.read()
    parts = []
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde\r\n'.encode())
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp3"\r\n'
        'Content-Type: audio/mpeg\r\n\r\n'.encode()
    )
    parts.append(audio_bytes)
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    body = b''.join(parts)
    req = urllib.request.Request(
        'https://api.openai.com/v1/audio/transcriptions',
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}', 'Authorization': f'Bearer {API_KEY}'},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read()).get('text', '').strip()
    except urllib.error.HTTPError as e:
        if e.code == 429:
            _raise_if_insufficient_quota(e)
        raise


def with_retry(fn, *args, max_retries=8, **kwargs):
    attempt = 0
    while True:
        try:
            return fn(*args, **kwargs)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < max_retries:
                attempt += 1
                time.sleep(min(2 ** attempt, 30))
                continue
            raise
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError) as e:
            # Covers transient connection-refused/reset/timeout blips (seen
            # in practice under sustained concurrent load) — retried the
            # same as a 429, not treated as a permanent failure.
            if attempt < max_retries:
                attempt += 1
                time.sleep(min(2 ** attempt, 30))
                continue
            raise


def mean_volume_db(path):
    out = subprocess.run(
        ['ffmpeg', '-i', path, '-af', 'volumedetect', '-f', 'null', '/dev/null'],
        capture_output=True, text=True,
    ).stderr
    m = re.search(r'mean_volume:\s*(-?[\d.]+)\s*dB', out)
    return float(m.group(1)) if m else None


# gpt-4o-mini-tts's raw output tends to carry a substantial silent tail (and
# sometimes a short lead-in) that the old tts-1-hd clips never had — trimmed
# before volume normalization so duration/pacing actually matches the
# existing corpus instead of just sounding right with dead air added.
SILENCE_TRIM = 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05,areverse'


def normalize_volume(raw_bytes, target_db):
    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_in:
        tmp_in.write(raw_bytes)
        tmp_in_path = tmp_in.name
    try:
        tmp_trimmed_path = tmp_in_path + '.trimmed.mp3'
        subprocess.run(
            ['ffmpeg', '-y', '-i', tmp_in_path, '-af', SILENCE_TRIM, tmp_trimmed_path],
            capture_output=True, check=True,
        )
        current_db = mean_volume_db(tmp_trimmed_path)
        if current_db is None:
            with open(tmp_trimmed_path, 'rb') as f:
                result = f.read()
            os.remove(tmp_trimmed_path)
            return result
        gain = target_db - current_db
        tmp_out_path = tmp_in_path + '.out.mp3'
        subprocess.run(
            ['ffmpeg', '-y', '-i', tmp_trimmed_path, '-af', f'volume={gain}dB', tmp_out_path],
            capture_output=True, check=True,
        )
        os.remove(tmp_trimmed_path)
        with open(tmp_out_path, 'rb') as f:
            result = f.read()
        os.remove(tmp_out_path)
        return result
    finally:
        os.remove(tmp_in_path)


def normalize_de(s):
    return re.sub(r'[^a-zäöüß ]', '', s.lower()).strip()


def transcript_matches(expected_spoken, transcript):
    exp = normalize_de(expected_spoken)
    got = normalize_de(transcript)
    if exp == got:
        return True
    # Tolerate a missing/extra article, and the bare word appearing as a
    # standalone token in a slightly longer Whisper transcript.
    exp_words = exp.split()
    bare = exp_words[-1] if exp_words else exp
    return bare in got.split()


def process_word(word, target_db):
    text = spoken_text(word)
    for attempt in range(2):
        raw = with_retry(call_tts, text)
        normalized = normalize_volume(raw, target_db)
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp:
            tmp.write(normalized)
            tmp_path = tmp.name
        try:
            transcript = with_retry(call_whisper, tmp_path)
        except InsufficientQuotaError:
            raise  # hard stop -- must not be swallowed as "just a flaky transcript"
        except Exception as e:
            transcript = f'<whisper error: {e}>'
        finally:
            os.remove(tmp_path)
        ok = transcript_matches(text, transcript)
        if ok or attempt == 1:
            return {'id': word['id'], 'text': text, 'audio': normalized, 'transcript': transcript, 'ok': ok}
    return None  # unreachable


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--level', required=True)
    ap.add_argument('--ids', help='comma-separated word ids, overrides --level word selection (still used for manifest/target-db naming)')
    ap.add_argument('--dry-run', action='store_true', help="don't write into public/audio, just report")
    ap.add_argument('--target-db', type=float, help='override the measured target mean_volume (dB)')
    ap.add_argument('--workers', type=int, default=5)
    args = ap.parse_args()

    all_words = parse_words(args.level)
    if args.ids:
        wanted = set(args.ids.split(','))
        words = [w for w in all_words if w['id'] in wanted]
    else:
        words = all_words
    print(f'{len(words)} words selected for level {args.level}', file=sys.stderr)

    manifest_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), f'.audio-regen-manifest-{args.level}.json')
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding='utf-8') as f:
            manifest = json.load(f)

    targets = [w for w in words if manifest.get(w['id'], {}).get('ok') is not True]
    print(f'{len(targets)} need (re)generation (resuming {len(words) - len(targets)} already OK)', file=sys.stderr)
    if not targets:
        return

    if args.target_db is not None:
        target_db = args.target_db
    else:
        sample_ids = [w['id'] for w in all_words if os.path.exists(os.path.join(AUDIO_DIR, f"{w['id']}.mp3"))][:25]
        dbs = [mean_volume_db(os.path.join(AUDIO_DIR, f'{i}.mp3')) for i in sample_ids]
        dbs = [d for d in dbs if d is not None]
        target_db = sum(dbs) / len(dbs) if dbs else -31.0
    print(f'Target mean_volume: {target_db:.1f} dB (from {"override" if args.target_db is not None else "existing corpus sample"})', file=sys.stderr)

    start = time.time()
    done = 0
    out_of_credit = False
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_word, w, target_db): w for w in targets}
        for fut in as_completed(futures):
            w = futures[fut]
            try:
                result = fut.result()
            except InsufficientQuotaError as e:
                # A hard stop, not a per-word failure: the account's OpenAI
                # balance is actually exhausted, so every other in-flight/
                # queued word would fail the exact same way. Cancel
                # whatever hasn't started yet (already-running requests
                # still finish naturally) and stop asking for more, rather
                # than burning through the rest of `targets` printing the
                # same error hundreds of times.
                print(f'\nOUT OF OPENAI CREDIT -- stopping. ({e})', file=sys.stderr)
                for other in futures:
                    other.cancel()
                out_of_credit = True
                break
            except Exception as e:
                print(f'{w["id"]} FAILED: {e}', file=sys.stderr)
                manifest[w['id']] = {'ok': False, 'error': str(e)}
                done += 1
                continue
            if not args.dry_run:
                out_path = os.path.join(AUDIO_DIR, f"{result['id']}.mp3")
                with open(out_path, 'wb') as f:
                    f.write(result['audio'])
            manifest[result['id']] = {
                'ok': result['ok'], 'text': result['text'], 'transcript': result['transcript'],
            }
            status = 'ok' if result['ok'] else 'FLAGGED'
            print(f'[{status}] {result["id"]} "{result["text"]}" -> whisper: "{result["transcript"]}"', file=sys.stderr)
            done += 1
            if done % 25 == 0:
                print(f'{done}/{len(targets)} done ({time.time()-start:.0f}s)', file=sys.stderr)
                with open(manifest_path, 'w', encoding='utf-8') as f:
                    json.dump(manifest, f, ensure_ascii=False, indent=1)

    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    if out_of_credit:
        print(
            f'Stopped early after {done}/{len(targets)} words (out of OpenAI credit). '
            f'Re-run the same command once the account is topped up -- already-'
            f'completed words are skipped automatically (see the manifest).',
            file=sys.stderr,
        )
        sys.exit(2)

    flagged = [wid for wid, v in manifest.items() if v.get('ok') is not True and any(w['id'] == wid for w in words)]
    print(f'Done. {len(targets) - len(flagged)}/{len(targets)} verified clean via Whisper.', file=sys.stderr)
    if flagged:
        print(f'{len(flagged)} flagged for a by-ear check: {", ".join(flagged)}', file=sys.stderr)


if __name__ == '__main__':
    main()
