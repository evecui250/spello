#!/usr/bin/env python3
"""Batch generator for A2 illustrations (public/images/words/{id}.webp).

Same picturability judgment as generate-a1-rest-images.py / generate-a1-more-nouns.py,
applied to all of A2's 451 words: skip prepositions/adverbs/conjunctions (no
picture conveys "already" or "although"), abstract/meta nouns (Meinung,
Interesse, Qualitat), numeric/duplicate/text-dependent concepts, and a
handful of individual verbs/adjectives judged too abstract on inspection
(marked 'SKIP' below and filtered out) to have a clear, unambiguous image.

Same style/quality/background settings as the other generator scripts —
gpt-image-1, "low" quality, transparent background, 512x512 WEBP, with the
anti-crop instruction. Two content failures were caught and reworded during
a full post-batch audit: a pharmacy storefront that rendered a "PHARMACY"
sign (violates the "no text" instruction) and "dunkel" (dark), which — like
"Mittag" in the A1 batch — got its entire described darkness stripped as
transparent background, leaving a blank image; reworded to a concrete lit
candle instead of relying on an atmospheric void.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-a2-images.py

Resumable: re-running only (re)does words missing from
scripts/.a2-image-manifest.json (gitignored).
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
MANIFEST_PATH = os.path.join(REPO_ROOT, 'scripts', '.a2-image-manifest.json')

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
    'w016': 'a traffic light',
    'w025': 'a pharmacy storefront with a large green cross symbol above the entrance, blank sign with no text',
    'w058': 'an office room with a desk and chair',
    'w086': 'a window with curtains',
    'w092': 'a river winding through a landscape',
    'w130': 'a wall calendar, no visible numbers',
    'w139': 'a hospital building exterior',
    'w152': 'an outdoor market with fruit stalls',
    'w173': 'a wrapped brown parcel box',
    'w174': 'a park with trees and a bench',
    'w177': 'a simple silhouette of a single standing person',
    'w281': "a man's formal suit on a hanger",
    'w297': 'a folded newspaper with gray printed-texture blocks, no readable text',
    'w359': 'a babysitter reading a book to a young child',
    'w367': 'a ball',
    'w380': 'a construction site with a crane and scaffolding',
    'w426': 'a mountain',
    'w482': 'a single green leaf',
    'w491': "a woman's blouse on a hanger",
    'w497': 'a handful of green beans',
    'w514': 'a pair of eyeglasses',
    'w519': 'a bridge over a river',
    'w543': 'a jar of skin cream, open',
    'w577': 'a simple wrapped box, generic object',
    'w759': 'an open drawer with compartments',
    'w777': 'an enthusiastic fan cheering with a foam finger',
    'w791': 'a television set',
    'w877': 'a fork',
    'w881': 'a garage with a car parked inside',
    'w924': 'a plated restaurant dish of food',
    'w929': 'an open storybook',
    'w937': "a close-up of a person's face",
    'w946': 'a thunderstorm with lightning',
    'w955': 'an acoustic guitar',
    'w997': "a close-up of a person's neck",
    'w1020': 'a spiral notebook',
    'w1026': 'a radiator heater',
    'w1031': 'a collared dress shirt on a hanger',
    'w1061': 'a pair of pants folded',
    'w1096': 'a small tropical island seen from above',
    'w1114': 'a person being interviewed with a microphone held toward them',
    'w1141': 'a camera',
    'w1157': 'a cat',
    'w1161': 'a cozy basement room',
    'w1171': 'a small church building with a steeple',
    'w1178': 'a piano',
    'w1214': 'a crowd at a concert with a stage and lights',
    'w1233': 'a road intersection seen from above',
    'w1259': 'a simple silhouette of a human body',
    'w1274': 'a table lamp, lit',
    'w1341': 'a spoon',
    'w1358': 'a winter coat on a hanger',
    'w1383': 'a crowd of people gathered together',
    'w1388': 'a busy trade fair hall with exhibition booths',
    'w1390': 'a knife',
    'w1412': 'a modern smartphone',
    'w1419': 'a car engine',
    'w1499': 'a small notepad with a pen, no visible text',
    'w1502': 'a plate of noodles',
    'w1520': "a close-up of a person's ear",
    'w1531': 'an orange fruit',
    'w1540': 'a couple holding hands',
    'w1546': 'a perfume bottle',
    'w1566': 'a horse',
    'w1567': 'a potted houseplant',
    'w1592': 'a postcard with a scenic picture, no visible text',
    'w1618': 'a knitted sweater',
    'w1635': 'a retro radio',
    'w1639': 'a grand city hall building',
    'w1668': 'a car tire',
    'w1697': 'a cow in a field',
    'w1698': 'a gold ring',
    'w1700': 'a pleated skirt',
    'w1703': 'a rose flower',
    'w1705': 'a hiking backpack',
    'w1709': "a close-up of a person's back",
    'w1747': 'a pair of scissors',
    'w1754': 'a large ship at sea',
    'w1757': 'an open umbrella',
    'w1767': 'a padlock',
    'w1772': 'a person wincing and holding their arm in mild pain',
    'w1800': 'a pig',
    'w1816': 'a plain oval bar of soap with bubbles, completely blank surface with no engraving or writing',
    'w1847': 'a pair of skis',
    'w1910': 'a folded city street map',
    'w1914': 'a celebrity in sunglasses signing an autograph',
    'w1937': 'a pair of boots',
    'w1952': 'a sandy beach with waves',
    'w1970': 'a wooden chair',
    'w1989': 'a plain T-shirt',
    'w1991': 'a single pill/tablet',
    'w2005': 'a cup on a saucer',
    'w2010': 'a sports team huddled together',
    'w2023': 'a dinner plate',
    'w2034': 'a grand theater building with columns',
    'w2040': 'a friendly fox, representing an animal',
    'w2053': 'a cooking pot',
    'w2066': 'a person lifting weights at the gym',
    'w2068': 'a person sleeping peacefully with a whimsical thought bubble above their head',
    'w2093': 'a wooden door',
    'w2113': 'a car with a small dent and a warning triangle beside it, no injury shown',
    'w2174': 'a car, a bicycle, and a train together, representing transportation',
    'w2228': 'a small bird',
    'w2264': 'a car',
    'w2270': 'a dense forest',
    'w2288': 'a winding path through nature',
    'w2344': 'a fluffy white cloud',
    'w2356': 'a sausage',
    'w2360': 'a laundry basket full of clothes',
    'w2367': 'a close-up of a single tooth',
    'w2379': 'a camping tent',
    'w2384': 'a small blank slip of paper, no visible text',
    'w2389': 'a target with an arrow in the bullseye, representing a goal',
    'w2394': 'a lemon',
    'w2397': 'a giraffe at a zoo',
    'w2613': 'a music band playing on stage',
    'w2615': 'a cafeteria with trays and tables',
    'w2616': 'a modern shopping mall exterior',
    'w2617': 'an e-reader device showing a book cover, no visible text',
    'w2618': 'an outdoor festival with tents and flags',
    'w2619': 'a leather wallet',
    'w2620': 'a hamburger',
    'w2622': 'a youth hostel building with bunk-bed dorm rooms',
    'w2625': 'a scooter/moped',
    'w2626': 'a knitted beanie cap',
    'w2627': 'a pizza',
    'w2628': 'a blank colorful poster board on a wall, no visible text',
    'w2630': 'a jigsaw puzzle piece',
    'w2633': 'a tablet computer',
    'w2634': 'a fancy layered torte cake',
    'w2635': 'a circus tent',
    # --- verbs ---
    'w314': 'a person tidying up a messy room',
    'w376': 'a person building a wall with bricks',
    'w501': 'a person frying food in a pan',
    'w520': 'a person booking a trip on a laptop',
    'w535': 'a person chatting happily on their phone',
    'w772': 'a person tripping and falling down',
    'w873': 'a person touching their own chest over their heart, feeling',
    'w1055': 'a person looking up hopefully with hands clasped',
    'w1066': 'a person coughing into their elbow',
    'w1071': 'a person hanging a picture frame on the wall',
    'w1132': 'a person jogging outdoors',
    'w1281': 'SKIP',
    'w1302': 'a person handing a book to another person, lending it',
    'w1317': 'a delivery person handing over a package',
    'w1345': 'a person lying with crossed fingers hidden behind their back',
    'w1352': 'a painter at an easel with a brush',
    'w1470': 'SKIP',
    'w1541': 'a person packing clothes into a suitcase',
    'w1547': 'a person parking a car',
    'w1554': 'a person checking a jacket fits well in a mirror',
    'w1621': 'a person mopping a floor',
    'w1638': 'SKIP',
    'w1647': 'a person calculating with a handheld calculator',
    'w1676': 'a person riding a horse',
    'w1680': 'a person painting a wall with a roller, renovating',
    'w1706': 'a person cupping their hands around their mouth, calling out',
    'w1726': 'a child collecting seashells on a beach',
    'w1756': 'a stern parent pointing a finger while scolding a child',
    'w1777': 'a pair of scissors cutting paper',
    'w1778': 'snowflakes falling gently',
    'w1841': 'a person singing into a microphone',
    'w1875': 'a hand dropping a coin into a piggy bank, saving money',
    'w1961': 'two people arguing face to face',
    'w1975': 'a person interrupting someone who is working at a desk',
    'w2015': 'a person splitting a cookie in half to share',
    'w2084': 'a person sleeping peacefully with a whimsical thought bubble',
    'w2106': 'a person transferring between two trains on a platform',
    'w2134': 'a doctor examining a patient with a stethoscope',
    'w2164': 'a person scratching their head, having forgotten something',
    'w2166': 'two different-sized objects being weighed on a balance scale',
    'w2180': 'a person with a small bandage on their arm',
    'w2182': 'two people gazing at each other with hearts, falling in love',
    'w2183': 'a person patting their pockets, confused, having lost something',
    'w2237': 'SKIP',
    'w2285': 'a currency exchange booth',
    'w2286': 'an alarm clock ringing loudly beside a bed',
    'w2294': 'a person crying with tears',
    'w2357': 'a hand choosing one item among several options',
    'w2372': 'a person sketching on paper with a pencil',
    'w2388': 'a person pulling a rope',
    'w2441': 'a person looking annoyed and irritated',
    'w2447': 'a person practicing a musical instrument',
    'w2462': 'a book with two different language covers side by side',
    'w2653': 'a person relaxing in a hammock, resting',
    'w2656': 'a person baking bread in an oven',
    'w2657': 'a graduate in a cap and gown holding a diploma, having passed',
    'w2658': 'a person surfing a wave',
    # --- adjectives ---
    'w295': 'worn, patched clothing and empty pockets, representing being poor',
    'w413': 'a person surrounded by admiring friends, popular',
    'w432': 'a celebrity signing autographs for a crowd',
    'w488': 'a close-up of blond hair',
    'w524': 'a colorful paint palette with many bright colors',
    'w571': 'a thick, chunky book',
    'w599': 'a person scratching their head with a confused expression',
    'w600': 'a single lit candle with a bright flame, glowing against complete darkness',
    'w609': 'a thin twig',
    'w684': 'a narrow alley between two tall buildings',
    'w782': 'a person lounging lazily on a couch, doing nothing',
    'w801': 'a greasy slice of pizza',
    'w813': 'a person doing push-ups, fit and healthy',
    'w818': 'a person focused and working hard at a desk with papers and a laptop, diligent',
    'w853': 'a person smiling warmly and waving hello',
    'w856': 'fresh vegetables with water droplets',
    'w859': 'SKIP',
    'w861': 'an alarm clock beside a very early sunrise',
    'w864': 'SKIP',
    'w899': 'a yellow hazard warning sign',
    'w941': 'a person eating a healthy salad with a thumbs up',
    'w1009': 'a solid gray rock',
    'w1027': 'steam rising from a hot cup of coffee',
    'w1072': 'SKIP',
    'w1103': 'a person with glasses reading a book with a lightbulb above their head',
    'w1140': 'a person shivering in a scarf with snow around them',
    'w1202': 'a person with a quirky, puzzled expression',
    'w1280': 'a person yawning, resting their head on their hand, bored',
    'w1294': 'an empty glass',
    'w1415': 'a sleek modern building with clean lines',
    'w1458': 'a wet, dripping umbrella and a puddle',
    'w1465': 'a foggy landscape with low visibility',
    'w1472': 'a person biting their nails nervously',
    'w1517': 'SKIP',
    'w1583': 'SKIP',
    'w1665': 'a person surrounded by luxury: a mansion, a fancy car, and jewelry',
    'w1729': 'a sparkling clean dish',
    'w1730': 'a person scrunching their face at a sour lemon',
    'w1737': 'a red chili pepper',
    'w1775': 'a pair of muddy, dirty shoes',
    'w1786': 'SKIP',
    'w1797': 'a pregnant woman, gentle silhouette',
    'w1836': 'a protective shield icon',
    'w1874': 'a person sitting on the edge of their seat, excited',
    'w1962': 'a stern teacher with arms crossed, strict',
    'w1988': 'a lollipop candy',
    'w2039': 'a deep canyon seen from above',
    'w2069': 'a person with a simple sad expression',
    'w2196': 'two visibly different, contrasting objects side by side',
    'w2229': 'a glass overflowing full of water',
    'w2253': 'a person carefully carrying a stack of glasses',
    'w2262': 'a person with wide-open alert eyes, awake',
    'w2276': 'a cozy blanket and a crackling fireplace',
    'w2291': 'a fluffy soft pillow',
    'w2637': 'a cozy armchair',
    'w2640': 'a fully overcast cloudy sky',
    'w2642': 'a person overwhelmed at a messy desk piled with work',
    'w2644': 'cracked, dry desert ground',
    'w2645': 'a simple round circle shape',
    'w2647': 'a candlelit dinner table set for two',
    'w2660': 'a person with a runny nose holding a tissue',
}

# Drop placeholder skips
CONCEPTS = {k: v for k, v in CONCEPTS.items() if v != 'SKIP'}


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
