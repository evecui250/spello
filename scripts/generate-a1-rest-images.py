#!/usr/bin/env python3
"""Batch generator for the rest of A1's illustrations (public/images/words/{id}.webp).

Covers the ~237 picturable words among A1's 503 non-bootstrap words (i.e.
everything outside the 220 "highFrequency" words handled by
generate-bootstrap-images.py) — same picturability judgment call as that
script: skip abstract/meta nouns (Beruf, Information, Ort...), duplicate/
redundant concepts already covered elsewhere (Ehefrau vs Frau, Bahn vs Zug),
numeric/compass/text-dependent words (Postleitzahl, Norden, Buchstabe), and
sensitive content inappropriate for an all-ages app (Zigarette, sterben).
Together with the bootstrap set, this is meant to be "every reasonably
illustrable word in A1."

Same style/quality/background settings as generate-bootstrap-images.py —
gpt-image-1, "low" quality, transparent background, 512x512 WEBP output.
The anti-crop instruction below was added after the first bootstrap batch
came back with several vehicles/nature scenes cut off at the frame edges.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-a1-rest-images.py

Resumable: re-running only (re)does words missing from
scripts/.a1-rest-image-manifest.json (gitignored).
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
MANIFEST_PATH = os.path.join(REPO_ROOT, 'scripts', '.a1-rest-image-manifest.json')

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
    'w020': 'a traveler arriving at a train platform with a suitcase, waving happily',
    'w028': 'a doctor in a white coat with a stethoscope',
    'w038': 'a highway with cars driving, seen from above, fully visible with margin',
    'w039': 'a bakery storefront with bread in the window',
    'w040': 'a train station platform (no train)',
    'w041': 'a bank building exterior with tall columns',
    'w052': 'a framed picture hanging on a wall',
    'w054': 'a sealed envelope with a letter',
    'w061': 'a confident boss in a suit standing at an office desk',
    'w062': 'a desktop computer',
    'w068': 'a small countryside village with a few houses',
    'w069': 'a printer',
    'w071': 'an elegant invitation card with a wax seal',
    'w073': 'an envelope popping out of a smartphone screen',
    'w084': 'a piece of paper with a mistake crossed out in red pen',
    'w088': 'a film reel and clapperboard',
    'w090': 'a cut of raw meat',
    'w091': 'an airport terminal with an airplane visible through the window',
    'w096': "two friends smiling together, arms around each other's shoulders",
    'w097': 'a breakfast plate with eggs and toast',
    'w099': 'a birthday cake with lit candles',
    'w102': 'a basket of fresh vegetables',
    'w103': 'a pile of luggage suitcases',
    'w110': 'a drinking glass',
    'w114': 'a group of diverse people standing together smiling',
    'w120': 'a hotel building exterior',
    'w121': 'a person holding their stomach, looking hungrily at a plate of food',
    'w134': 'a cinema building with a marquee (no visible text on it)',
    'w135': 'a rack of hanging clothes',
    'w142': 'a kitchen interior',
    'w146': 'a grocery bag full of food',
    'w147': 'a teacher standing at a chalkboard (blank chalkboard)',
    'w158': 'a living room with furniture, a sofa and table',
    'w168': 'a bowl of fresh fruit',
    'w175': 'a passport booklet',
    'w176': 'a person relaxing on a bench with a coffee, taking a break',
    'w180': 'a red mailbox',
    'w183': 'a student taking a written exam at a desk',
    'w187': 'a suitcase and a folded map, ready for a journey',
    'w262': 'a person talking on a phone',
    'w320': 'an elevator with open doors',
    'w321': 'a close-up of a single eye',
    'w348': 'an ID card (blank, no visible text)',
    'w352': 'a vending machine',
    'w358': 'a smiling baby',
    'w360': 'a bathroom interior with a sink and mirror',
    'w366': 'a small balcony with a plant',
    'w368': 'a banana',
    'w375': "a close-up of a person's belly",
    'w379': 'a tree',
    'w405': "a person's leg",
    'w461': 'a neatly made bed',
    'w471': 'a glass of beer with foam',
    'w476': 'a pear',
    'w485': 'a pencil',
    'w490': 'a single flower',
    'w511': 'a postage stamp',
    'w518': 'a bread roll',
    'w525': 'a pat of butter on a small plate',
    'w532': 'a cozy café storefront',
    'w533': 'a CD disc',
    'w605': 'a person reaching thirstily for a glass of water',
    'w606': 'a shower',
    'w625': 'an egg',
    'w764': 'a person driving a car, hands on the wheel',
    'w765': 'a paper ticket stub, no visible text',
    'w767': 'a bicycle',
    'w803': 'a campfire flame',
    'w806': 'a thermometer showing a high fever, no visible numbers',
    'w812': 'a fish',
    'w816': 'a glass bottle',
    'w825': 'an airplane in flight, fully visible with margin',
    'w865': "a person's bare foot",
    'w866': 'a soccer ball',
    'w885': 'a lush backyard garden',
    'w928': 'a wrapped gift box with a ribbon',
    'w935': 'a small shop storefront',
    'w962': 'a railway track',
    'w988': 'a lock of flowing hair',
    'w1001': 'a bus stop sign with a bench',
    'w1003': 'an open hand',
    'w1014': 'a notebook with homework and a pencil',
    'w1033': 'a kitchen stove',
    'w1053': 'a bride and groom at their wedding',
    'w1063': 'a dog',
    'w1068': 'a roast chicken',
    'w1120': 'a jacket',
    'w1137': 'a young boy',
    'w1152': 'a potato',
    'w1153': 'a cash register at a checkout counter',
    'w1167': 'a colorful kindergarten building with a playground',
    'w1170': 'a small street kiosk',
    'w1200': 'a suitcase',
    'w1215': "a person's head",
    'w1240': 'a slice of cake',
    'w1241': 'a ballpoint pen',
    'w1262': 'a refrigerator',
    'w1312': 'a glowing lightbulb',
    'w1316': 'musical notes floating in the air',
    'w1372': 'the sea with gentle waves',
    'w1421': 'a close-up of a smiling mouth',
    'w1429': 'a young girl',
    'w1544': 'a blank sheet of paper',
    'w1552': 'a festive party scene with balloons and confetti',
    'w1586': 'a police officer in uniform',
    'w1661': 'rain falling from clouds',
    'w1673': 'a bowl of rice',
    'w1683': 'a person repairing something with a wrench',
    'w1688': 'a restaurant interior with tables',
    'w1718': 'a glass of orange juice',
    'w1722': 'a fresh salad bowl',
    'w1725': 'a small bowl of salt',
    'w1769': 'a house key',
    'w1784': 'a wooden cabinet',
    'w1793': 'a shoe',
    'w1804': 'a swimming pool',
    'w1809': 'a student with a backpack and books',
    'w1812': 'a calm lake surrounded by trees',
    'w1853': 'a sofa',
    'w1862': 'a bright sun in the sky',
    'w1954': 'a tram, viewed from a three-quarter angle with generous space around it',
    'w2002': 'a handbag',
    'w2043': 'a wooden table',
    'w2047': 'a toilet',
    'w2050': 'a tomato',
    'w2076': 'a staircase',
    'w2096': 'a wall clock with hands but no visible numbers',
    'w2137': 'a beach chair and sun umbrella on a sunny beach',
    'w2293': 'a glass of red wine',
    'w2297': 'a globe of the world',
    'w2322': 'leaves blowing in a strong wind',
    'w2378': 'a folded newspaper with gray printed-texture blocks, no readable text',
    'w2445': 'a bottle of cooking oil',
    'w2521': 'a late-morning sky with the sun higher up',
    'w2541': 'an airplane taking off, fully visible with margin',
    'w2542': "a person's arm and bicep",
    'w2544': 'a disco dance floor with colorful lights',
    'w2548': 'a plate of food',
    'w2552': 'grandparents standing together smiling',
    'w2557': 'a delivery truck, viewed from a three-quarter angle with generous space around it',
    'w2559': 'a paper cone of french fries',
    'w2561': 'a slice of ham',
    # --- verbs ---
    'w205': 'a train departing a station',
    'w209': 'a person picking up a child from school, holding hands',
    'w258': 'a person arriving at a destination with a suitcase, smiling',
    'w264': 'a person talking on a phone',
    'w280': 'a person putting on a shirt, getting dressed',
    'w340': 'a hand turning off a light switch',
    'w350': 'a person taking off their jacket',
    'w361': 'a person relaxing in a bathtub full of bubbles',
    'w410': 'a person receiving a wrapped gift with both hands',
    'w442': 'a tourist taking a photo of a famous landmark',
    'w449': 'a person ordering food from a waiter at a restaurant table',
    'w454': 'two people hugging warmly at a doorway, visiting',
    'w515': 'a person carrying a tray of food to bring to someone',
    'w556': 'a person with hands clasped in gratitude, smiling',
    'w596': 'a printer printing a page',
    'w598': 'a finger pressing a button',
    'w607': 'a shower head with water flowing and steam rising, no people',
    'w645': 'a person pushing a shopping cart full of groceries',
    'w647': 'a person handing an invitation card to another person',
    'w659': 'a person boarding a train, stepping through the doors',
    'w721': 'a teacher explaining something on a blank chalkboard, pointing',
    'w744': 'a person telling an animated story to an attentive listener',
    'w763': 'a person driving a car',
    'w787': 'people celebrating with confetti and raised arms',
    'w790': 'a person watching television on a couch',
    'w820': 'an airplane flying through clouds',
    'w862': 'a person eating breakfast at a table',
    'w944': 'a person celebrating with a trophy, having won',
    'w969': 'two people shaking hands, one congratulating the other with a smile',
    'w973': 'a barbecue grill with food cooking on it',
    'w1000': 'a hand holding a cup',
    'w1024': 'a bride and groom exchanging rings',
    'w1199': 'a person cooking at a stove with a pan',
    'w1270': 'a person laughing joyfully',
    'w1284': 'a person running',
    'w1315': 'a heart shape held gently in two hands',
    'w1319': 'a person lying down relaxed on a bed',
    'w1394': 'a person receiving keys to an apartment from a landlord',
    'w1675': 'a person with a suitcase and map, traveling',
    'w1695': 'a person smelling a flower with eyes closed',
    'w1750': 'a person sending a letter into a mailbox',
    'w1759': 'a person sleeping peacefully in bed',
    'w1764': 'a hand closing a door',
    'w1771': 'a person tasting food with a delighted expression',
    'w1805': 'a person swimming in a pool',
    'w1846': 'a person sitting on a chair',
    'w1927': 'a person standing upright',
    'w1966': 'a university student studying with books at a desk',
    'w1979': 'a person searching, holding a magnifying glass',
    'w2000': 'a person dancing joyfully',
    'w2071': 'two friends meeting and waving at each other',
    'w2109': 'a person carrying moving boxes into a new house',
    'w2158': 'a person receiving cash payment for work',
    'w2172': 'a person selling an item to a customer at a market stall',
    'w2255': 'two people shaking hands, being introduced',
    'w2272': 'a person hiking with a backpack on a mountain trail',
    'w2278': 'a person waiting patiently on a bench, looking at a clock',
    'w2281': 'a person washing their hands under a tap',
    'w2444': 'a hand opening a door',
    'w2454': 'a person sleeping in a hotel room bed',
    'w2566': 'a hand clicking a computer mouse',
    'w2567': 'a hand marking a checkbox with a checkmark',
    'w2568': 'a hand turning on a light switch',
    'w2569': 'a person stepping off a train onto the platform',
    'w2584': 'a person gently caring for a sick child in bed',
    # --- adjectives ---
    'w233': 'a person standing by themselves in an empty room, neutral expression',
    'w370': 'a hand holding paper cash banknotes',
    'w480': "a person scrunching their face after tasting something bitter, like a lemon",
    'w503': 'a paint swatch card of the color brown',
    'w505': 'a wide open road stretching horizontally',
    'w526': 'a person with an angry scowling expression',
    'w629': 'a person running while looking at their watch, in a hurry',
    'w792': 'a person giving a thumbs up next to a finished, checked-off task',
    'w846': 'an empty, unoccupied park bench',
    'w970': 'a paint swatch card of the color gray',
    'w1030': 'a bright sunlit room with light streaming in',
    'w1040': 'two people embracing in a warm, friendly hug',
    'w1147': 'a broken vase lying in pieces on the floor',
    'w1175': 'a perfectly clear, transparent glass of water, completely clean and see-through, with a bright highlight of light passing through it',
    'w1287': "a person shouting loudly with sound waves around their mouth",
    'w1303': 'a person whispering with a finger to their lips',
    'w1336': 'a person laughing hysterically at a joke',
    'w1623': 'a person checking their watch, arriving right on time',
    'w1707': 'a person meditating peacefully by a calm lake',
    'w1902': 'a clock with hands pointing to a late hour, no visible numbers',
    'w2295': 'a long winding road disappearing into the distant horizon',
    'w2321': 'a welcome mat in front of an open door',
    'w2352': 'a person with arms outstretched, amazed by a beautiful sunset',
    'w2402': 'a person smiling contentedly with eyes closed, relaxed',
    'w2578': "a shop's closed metal shutter door, rolled down",
    'w2580': "a shop's open door, welcoming and unobstructed",
    'w2597': 'a red circle with a diagonal line, a no-entry prohibition symbol',
    'w2598': 'two hands wearing wedding rings, intertwined',
    'w2599': 'a huge overflowing pile of coins',
    'w2601': 'a single small coin alone on a plain surface',
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
