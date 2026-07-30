#!/usr/bin/env python3
"""Batch generator for per-word illustrations (public/images/words/{id}.webp).

Covers only the ~94 of A1's 220 "highFrequency" bootstrap words (see
lib/words.ts / lib/practice.ts's isBootstrapCopyWord) that have a clear,
concrete, single-image depiction — CONCEPTS below deliberately excludes
prepositions/adverbs/greetings/question-words/numbers (no picture conveys
"on" or "already" or "eleven"), weekdays and months (visually
indistinguishable from each other without rendering text), abstract time
units (year/hour/minute/second/week/weekend), modal or copula verbs
(can/must/should/want/to be/to have/to know), and evaluative adjectives
(good/bad/right/wrong/important/simple) where a picture risks pointing to
the wrong word rather than just being plain.

Uses gpt-image-1 at "low" quality with a transparent background, so the
result drops cleanly onto the app's own card background (bg-amber-50/75
over the ForestBackground gradient) instead of shipping a baked-in color
that would clash if the theme ever changes. Style prompt was tuned across a
few manual preview rounds: isolated subject (no room/scene clutter), the
subject's own true color kept (not desaturated), no artificial warm
pink/peach cast, no text/numbers anywhere.

Each image is generated at 1024x1024 (~1.5MB raw PNG) then downsized to
512x512 WEBP (~35-40KB) — the raw size was never meant to ship; committing
the PNGs directly would have added ~150MB to the repo for this batch alone.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-bootstrap-images.py

Resumable: re-running only (re)does words missing from
scripts/.bootstrap-image-manifest.json (gitignored) — safe to re-run after
an interruption or to extend CONCEPTS with more words later.
"""

import base64
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
MANIFEST_PATH = os.path.join(REPO_ROOT, 'scripts', '.bootstrap-image-manifest.json')

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
    # --- nouns ---
    'w001': 'an evening sky at sunset, warm colors low on the horizon',
    'w024': 'a single apple',
    'w026': 'a person working at a desk with a laptop and papers',
    'w037': 'a car, viewed from a three-quarter angle with generous space around it',
    'w055': 'a loaf of bread',
    'w056': 'a boy and a slightly younger boy standing together with arms around each other’s shoulders, as brothers',
    'w057': 'a book',
    'w059': 'a bus, viewed from a three-quarter angle with generous space around it',
    'w072': 'a mother and father standing together',
    'w082': 'a mother, father, and child standing together as a family',
    'w094': 'a smiling adult woman',
    'w133': 'a single young child playing',
    'w144': 'a scenic countryside landscape with rolling green hills',
    'w151': 'a smiling adult man',
    'w157': 'the midday sun high overhead with a couple of small soft clouds nearby and gentle sun rays, high noon',
    'w160': 'a sunrise over hills with soft morning light',
    'w162': 'a mother holding her young child’s hand',
    'w165': 'a night sky full of stars with a crescent moon',
    'w166': 'a blank name tag badge pinned to a shirt',
    'w191': 'a school building with a small bell tower',
    'w192': 'two girls of different ages standing together with arms around each other’s shoulders, as sisters',
    'w196': 'a city skyline with several buildings',
    'w910': 'a small stack of coins and banknotes',
    'w1008': 'a modern smartphone',
    'w1013': 'a house',
    'w1139': 'a cup of coffee',
    'w1398': 'a glass of milk',
    'w1522': 'a smiling elderly woman',
    'w1525': 'a smiling elderly man',
    'w1857': 'a father with his young son, both smiling (no waving/raised arms)',
    'w1953': 'a street lined with buildings',
    'w2009': 'a taxi cab, viewed from a three-quarter angle with generous space around it',
    'w2013': 'a cup of tea',
    'w2021': 'a classic landline telephone',
    'w2045': 'a father with his young daughter, both smiling (no waving/raised arms)',
    'w2140': 'a smiling adult man holding a young child’s hand',
    'w2283': 'a glass of water',
    'w2341': 'an apartment building exterior',
    'w2392': 'a cozy, simple bedroom interior',
    'w2404': 'a train, viewed from a three-quarter angle with generous space around it',
    'w2522': 'an afternoon sun partway down a clear sky',
    'w2535': 'spring blossoms on a tree branch with fresh green sprouts',
    'w2536': 'a bright sun and a blooming sunflower',
    'w2537': 'autumn leaves in orange and red falling from a tree',
    'w2538': 'a snowy winter scene with falling snowflakes',
    # --- adjectives ---
    'w240': 'an elderly person with gray hair and a walking cane',
    'w475': 'a single small, plain coin',
    'w483': 'a paint swatch card of the color blue',
    'w909': 'a paint swatch card of the color yellow',
    'w963': 'a person smiling broadly with joyful body language, arms raised',
    'w975': 'a tall redwood tree, shown in full from roots to treetop',
    'w980': 'a paint swatch card of the color green',
    'w1052': 'a mountain peak, shown in full from base to summit',
    'w1136': 'an energetic young child or teenager mid-jump',
    'w1181': 'a tiny ladybug next to a single blade of grass',
    'w1224': 'a person in bed with a thermometer in their mouth and a cold compress on their forehead',
    'w1251': 'a short coiled piece of rope',
    'w1278': 'a long piece of rope stretched out across the ground',
    'w1279': 'a snail slowly crawling, leaving a visible trail',
    'w1298': 'a single feather floating gently in the air',
    'w1438': 'a person yawning widely with heavy droopy eyes, looking exhausted',
    'w1475': 'a brand new gift box wrapped with a ribbon and bow, sparkling',
    'w1704': 'a paint swatch card of the color red',
    'w1779': 'a cheetah running at full speed with a motion-blur effect',
    'w1799': 'a paint swatch card of the color black',
    'w1801': 'a person straining hard to lift a very heavy boulder',
    'w1808': 'a small cluster of a few blooming flowers, fully visible',
    'w2032': 'a small pile of gold coins and a sparkling gem',
    'w2296': 'a paint swatch card of the color white',
    # --- verbs ---
    'w286': 'a person working at a desk with a laptop and papers',
    'w469': 'a person handing a credit card to a cashier at a checkout counter',
    'w748': 'a person eating a forkful of food at a table',
    'w810': 'a person picking up a coin they just found on the ground, with a delighted expression',
    'w844': 'a person raising their hand with a curious expression and a question mark above their head',
    'w889': 'a person handing a wrapped gift to another person',
    'w907': 'a person walking mid-stride',
    'w1029': 'one person helping another person up who has fallen, extending a hand',
    'w1077': 'a person with a hand cupped behind their ear, listening closely',
    'w1203': 'a person walking toward the viewer with arms open, arriving',
    'w1289': 'a small green sprout growing out of soil',
    'w1309': 'a student reading a book with a lightbulb idea above their head',
    'w1310': 'a person closely reading an open book',
    'w1346': 'a pair of hands building something out of wood with simple tools',
    'w1434': 'a person smiling with a heart symbol floating above their open hand',
    'w1468': 'a hand reaching out and grabbing an apple from a table',
    'w1719': 'a person speaking with a speech bubble above their head',
    'w1787': 'a person writing with a pen in a notebook',
    'w1813': 'a close-up of a single open eye looking forward',
    'w1888': 'a child playing with a colorful toy ball',
    'w1897': 'two people facing each other in conversation, with speech bubbles between them',
    'w2078': 'a person drinking from a glass of water',
    'w2337': 'a small cozy house with a welcoming front door',
    'w2476': 'a person at a shop counter buying an item, holding a shopping bag',
    'w2583': 'a small price tag hanging from an item',
}

# 512x512 keeps a comfortable margin over the ~48px thumbnail this actually
# renders at (app/words/page.tsx), while still landing around 35-40KB/image
# as WEBP — a fraction of the ~1.5MB raw PNG gpt-image-1 returns.
THUMBNAIL_SIZE = (512, 512)
WEBP_QUALITY = 82


def load_manifest():
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH) as f:
            return json.load(f)
    return {}


def save_manifest(m):
    with open(MANIFEST_PATH, 'w') as f:
        json.dump(m, f, indent=2)


def generate_raw_png(concept):
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
            raw = generate_raw_png(concept)
        except urllib.error.HTTPError as e:
            print(f'  FAILED (HTTP {e.code}): {e.read()[:300]}')
            continue
        except Exception as e:
            print(f'  FAILED: {e}')
            continue
        im = Image.open(__import__('io').BytesIO(raw)).convert('RGBA')
        im = im.resize(THUMBNAIL_SIZE, Image.LANCZOS)
        im.save(out_path, 'WEBP', quality=WEBP_QUALITY, method=6)
        manifest[wid] = 'done'
        save_manifest(manifest)
        done += 1
        time.sleep(0.3)
    print(f'Done. Generated {done} new images ({len(ids)} total in set).')


if __name__ == '__main__':
    main()
