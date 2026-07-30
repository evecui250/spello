#!/usr/bin/env python3
"""Top-up batch for A1 nouns initially judged too abstract/ambiguous to
illustrate (public/images/words/{id}.webp).

A second look at generate-a1-rest-images.py's skip list, after feedback that
several of those calls were too conservative (e.g. "Großmutter", "Halle",
"Herr" are perfectly picturable even though they're near-synonyms of words
already covered, or plain concrete nouns/roles that got lumped in with
truly abstract ones). This covers the reasonably-picturable remainder;
still-skipped nouns are the genuinely abstract/numeric/text-dependent/
duplicate ones (Ordnung, Postleitzahl, Buchstabe, Wetter-duplicates, etc.)
where a picture would still risk pointing to the wrong word.

Same style/quality/background settings as the other two generator scripts.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-a1-more-nouns.py

Resumable: re-running only (re)does words missing from
scripts/.a1-more-nouns-manifest.json (gitignored).
"""

import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request

from PIL import Image

API_KEY = os.environ.get('OPENAI_API_KEY')
if not API_KEY:
    sys.exit('Set OPENAI_API_KEY in the environment before running this script.')

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, 'public', 'images', 'words')
os.makedirs(OUT_DIR, exist_ok=True)
MANIFEST_PATH = os.path.join(REPO_ROOT, 'scripts', '.a1-more-nouns-manifest.json')

STYLE_TEMPLATE = (
    "A modern, softly colorful illustration of {concept}, isolated with "
    "nothing else in the frame beyond what's specified — no walls, floor, "
    "or room setting unless mentioned above. The ENTIRE subject must fit "
    "comfortably within the frame with clear empty margin on all four "
    "sides — nothing touching, cut off, or cropped by any edge; zoom out "
    "further if needed so the whole subject, including any extremities "
    "(wheels, branches, limbs), is fully visible. Simple, clean, minimal "
    "linework and shading, easy to recognize at a glance. Keep the "
    "subject's own natural, true-to-life color exactly as it looks in "
    "real life (e.g. a red apple stays red) — nothing grayed out or "
    "desaturated. Avoid an artificial warm pink/peach/orange lighting "
    "cast; overall lighting should be clean, soft, and neutral. Wholesome "
    "and appropriate for a language-learning app used by all ages. No "
    "text, no letters, no numbers, no words anywhere in the image."
)

CONCEPTS = {
    'w2553': 'a smiling grandmother figure with gray hair in a cozy cardigan',
    'w2554': 'a smiling grandfather figure with gray hair and a cardigan',
    'w1036': 'a well-dressed gentleman in a formal suit and tie',
    'w550': 'an elegant lady in a nice dress',
    'w995': 'a large empty exhibition hall with high ceilings and tall windows',
    'w586': 'an academic in a graduation cap and gown holding a diploma',
    'w839': 'an instant polaroid-style photograph',
    'w843': 'a large bold question mark',
    'w887': 'a host warmly welcoming a guest at the front door with open arms',
    'w1151': 'a folded paper map',
    'w1311': 'a diverse crowd of people walking together, seen from behind',
    'w1384': 'a simple silhouette of a single standing person',
    'w2176': 'a friendly shop salesperson standing behind a counter',
    'w2188': 'a landlord standing in front of an apartment building, holding a key',
    'w1246': 'a customer receiving a shopping bag from a shop assistant',
    'w1814': 'a tourist taking a photo in front of a famous landmark tower',
    'w486': 'a scenic panoramic view from a mountain overlook',
    'w2314': "a sky that's half sunny and half rainy with clouds, showing changeable weather",
    'w1893': 'a collection of sports equipment: a ball, a racket, and running shoes',
    'w2252': 'a yellow triangular warning sign with an exclamation mark',
    'w338': 'a world map with a small airplane flying over it toward a highlighted destination',
    'w1755': 'a blank rectangular signpost mounted on a pole',
    'w663': 'a ticket turnstile entrance gate',
    'w1176': 'a classroom full of students sitting at desks',
    'w1211': 'a small piggy bank with a bank card resting beside it',
    'w2160': 'a group of people wearing matching team scarves, cheering together',
    'w1595': 'a young intern taking notes while shadowing a mentor at a desk',
    'w2028': 'a wall calendar with a single date circled in red, no visible numbers',
    'w1690': 'a hotel reception desk with a bell and a rack of keys',
    'w137': 'two coworkers collaborating together at a shared desk',
    'w089': 'a modern glass office building exterior',
    'w615': 'the inside corner of a room where two walls meet',
    'w081': 'a tall adult standing next to a small child, for size comparison',
    'w129': 'a teenager wearing a backpack and headphones',
    'w042': 'a civil servant in an official uniform sitting at a government office desk',
}


def load_manifest():
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as f:
            return json.load(f)
    return {}


def save_manifest(m):
    with open(MANIFEST_PATH, 'w') as f:
        json.dump(m, f, indent=2)


def generate(concept):
    prompt = STYLE_TEMPLATE.format(concept=concept)
    body = json.dumps({
        'model': 'gpt-image-1',
        'prompt': prompt,
        'size': '1024x1024',
        'quality': 'low',
        'background': 'transparent',
        'n': 1,
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.openai.com/v1/images/generations',
        data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {API_KEY}',
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    return base64.b64decode(data['data'][0]['b64_json'])


def main():
    manifest = load_manifest()
    ids = list(CONCEPTS.keys())
    print(f'{len(ids)} words to generate.')
    done = 0
    for wid in ids:
        out_path = os.path.join(OUT_DIR, f'{wid}.webp')
        if manifest.get(wid) == 'done' and os.path.exists(out_path):
            continue
        concept = CONCEPTS[wid]
        print(f'Generating {wid}: {concept[:60]}...')
        try:
            raw = generate(concept)
        except urllib.error.HTTPError as e:
            print(f'  FAILED (HTTP {e.code}): {e.read()[:300]}')
            continue
        except Exception as e:
            print(f'  FAILED: {e}')
            continue
        im = Image.open(io.BytesIO(raw)).convert('RGBA')
        im = im.resize((512, 512), Image.LANCZOS)
        im.save(out_path, 'WEBP', quality=82, method=6)
        manifest[wid] = 'done'
        save_manifest(manifest)
        done += 1
        time.sleep(0.2)
    print(f'Done. Generated {done} new images ({len(ids)} total in set).')


if __name__ == '__main__':
    main()
