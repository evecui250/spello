#!/usr/bin/env python3
"""Batch generator for B2 illustrations (public/images/words/{id}.webp).

Same picturability judgment as the A1/A2/B1 generator scripts, applied to
all of B2's 893 words. B2 (repopulated from a DTZ B2 coursebook — see
project memory on the word corpus) is overwhelmingly abstract: economics,
psychology, technology, and environmental-policy vocabulary (Verantwortung-
tier words but more so — Globalisierung, Nachhaltigkeit, Investition...).
Of 336 nouns, 325 verbs, and 203 adjectives, only ~131 had a clear,
concrete, unambiguous depiction.

Same style/quality/background settings as the other generator scripts. One
content failure was caught during the post-batch audit: "Dissertation"
rendered garbled pseudo-text on a book cover despite the "no text"
instruction — reworded to explicitly demand a "completely plain blank
cover".

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-b2-images.py

Resumable: re-running only (re)does words missing from
scripts/.b2-image-manifest.json (gitignored).
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
MANIFEST_PATH = os.path.join(REPO_ROOT, 'scripts', '.b2-image-manifest.json')

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
    'w507': 'a bicycle brake lever on a handlebar',
    'w595': 'a pressure gauge dial',
    'w717': 'an upward trending bar chart',
    'w1404': 'two people with confused thought bubbles, talking past each other, misunderstanding',
    'w2994': 'a person slumped exhausted at a desk surrounded by papers, burnout',
    'w2996': 'a thick bound book with a completely plain blank cover, no text, no letters, no title',
    'w3000': 'a person with a disgusted, scrunched-up expression',
    'w3009': 'sound waves emanating from a speaker',
    'w3010': 'a face showing a surprised expression',
    'w3011': 'a person making expressive hand gestures while talking',
    'w3021': 'a person standing with excellent upright posture',
    'w3035': 'a person panicking, wide-eyed, hands on head',
    'w3043': 'a therapist and patient in a counseling session',
    'w3056': 'a support group of people sitting in a circle talking',
    'w3080': 'a person with their face blurred out, anonymous',
    'w3125': 'a microphone with headphones, representing a podcast',
    'w3126': 'a natural spring bubbling up from the ground',
    'w3193': 'a glowing globe with connecting network lines, representing globalization',
    'w3195': 'a hooded figure typing on a laptop',
    'w3202': 'a small plant sprouting from a pile of coins, representing investment growth',
    'w3224': 'a person taking a selfie photo with their phone',
    'w3232': 'a magnifying glass over a computer screen, representing a search engine',
    'w3234': 'a wooden Trojan horse toy, representing a computer virus',
    'w3281': 'a disposable plastic cup and container',
    'w3288': 'a flooded street with water',
    'w3293': 'a glass greenhouse with plants inside',
    'w3295': 'a person balancing on one leg with arms out',
    'w3305': 'a natural habitat scene with a few animals',
    'w3308': 'diverse people holding hands in a circle around a globe',
    'w3314': 'a diverse forest ecosystem with plants and small animals',
    'w3315': 'a spray bottle spraying crops',
    'w3317': 'a colorful ringed planet in space',
    'w3318': 'rows of crop plants on a plantation',
    'w3326': 'a radioactive warning symbol',
    'w3335': 'a weed growing through a crack in pavement',
    'w3344': 'a grassy pasture with a grazing animal',
    'w3361': 'a small side dish on a plate',
    'w3363': 'a shipping container',
    'w3365': 'a bowl of hearty stew',
    'w3368': 'a person with an outraged, open-mouthed expression',
    'w3400': 'a wrapped product package',
    'w3410': 'a plant root system',
    'w3447': 'a factory assembly conveyor belt',
    'w3462': 'a person working from home on a laptop at a kitchen table',
    'w3520': 'a person surrounded by laptops and coffee cups, working late, a workaholic',
    'w3591': 'a hurdle obstacle, like in athletics',
    'w3603': 'a tall corporate skyscraper building',
    'w3632': 'a pile of raw ore and materials',
    'w3640': 'two people trading items with each other',
    'w3681': 'a stylized bacteria cell shape, modern icon style',
    'w3710': 'a medical syringe',
    'w3712': 'a plate of bread and pasta, representing carbohydrates',
    'w3715': 'a small gap in a wooden fence',
    'w3718': 'a prosthetic leg, respectfully depicted',
    'w3723': 'a friendly robot',
    'w3724': 'a wifi router device',
    'w3730': 'a hand touching a tablet touchscreen',
    'w3732': 'a smartphone showing a software update download icon',
    'w3742': 'a rechargeable battery icon',
    'w3763': 'an electric car charging at a charging station',
    'w3774': 'a folding hand fan',
    'w3778': 'a tube of hair gel',
    'w3813': 'an electric desk fan',
    'w3826': 'a stylized biological cell shape, modern icon style',
    # --- verbs ---
    'w508': 'a car braking hard with visible skid marks',
    'w1949': 'a person accidentally bumping into another person',
    'w2976': 'a person distracted by their phone while trying to work',
    'w2980': 'a person with visibly tense, clenched shoulders',
    'w3007': 'a coffee filter dripping into a cup',
    'w3016': 'a person mimicking another person\'s pose',
    'w3049': 'a person looking at a broken, failed project, dejected',
    'w3064': 'a person climbing over a tall obstacle wall',
    'w3087': 'a person with a regretful expression, head in hands',
    'w3115': 'a person clinging tightly to a pole',
    'w3141': 'a person comforting a crying friend',
    'w3142': 'a person quickly flipping through pages of a book',
    'w3164': 'a person winking playfully',
    'w3172': 'a hand tightening a screw with a screwdriver',
    'w3208': 'a hand tapping a heart-shaped like icon on a phone screen',
    'w3221': 'a person coding at a computer with abstract code symbols on screen',
    'w3235': 'a security camera monitoring an area',
    'w3245': 'a worn-out shoe sole with a hole',
    'w3268': 'a bee pollinating a flower',
    'w3270': 'a person admiring something with heart-shaped eyes',
    'w3323': 'an ice cube melting into a small puddle',
    'w3324': 'a kid sneaking away from school, looking around nervously',
    'w3337': 'a small fish caught in a net',
    'w3355': 'a person sorting items into organized piles',
    'w3364': 'a solid frozen block of ice',
    'w3387': 'a slice of bread popping up from a toaster',
    'w3401': 'a person wastefully pouring food down the drain',
    'w3409': 'a person covering their eyes, looking away',
    'w3413': 'a person leaning casually against a wall',
    'w3475': 'a bird circling in the sky',
    'w3495': 'a person sighing deeply, shoulders drooping',
    'w3532': 'a person holding two options, weighing them on a small balance scale',
    'w3568': 'a cartoon-style explosion burst, non-violent',
    'w3569': 'a cargo ship loaded with shipping containers',
    'w3608': 'a person rolling up their sleeves, ready to start',
    'w3685': 'a car with a blinking turn signal light',
    'w3704': 'a glowing healing light around a bandaged wound',
    'w3719': 'the recycling symbol above a recycling bin',
    'w3746': 'a chameleon changing color to blend in, adapting',
    'w3760': 'a fist breaking through a wall',
    'w3768': 'steam rising off a heated pot on a stove',
    'w3783': 'jars of preserved food on a shelf',
    'w3798': 'an X-ray image showing bones',
    'w3804': 'bubbling sparkling water in a glass',
    'w3814': 'a person hiding behind a tree, peeking out',
    'w3817': 'a dog burying a bone in the ground',
    'w3828': 'a frozen lake surface',
    # --- adjectives ---
    'w3063': 'a person with a surprised expression, mouth open wide eyes',
    'w3105': 'a rough, coarse textured tree bark surface',
    'w3294': 'a person greedily hugging a huge pile of gold coins',
    'w3388': 'a moldy slice of bread with green spots',
    'w2997': 'a person climbing a ladder reaching toward a star',
    'w3034': 'a person looking confused with spinning arrows around their head',
    'w3078': 'a vintage rotary telephone',
    'w3097': 'a glowing infinity symbol',
    'w3167': 'a person with a paper bag over their head, anonymous',
    'w3171': 'a self-driving car with no visible driver',
    'w3199': 'a person in a trench coat, hat, and sunglasses, incognito',
    'w3374': 'a lost child looking around confused',
    'w3391': 'a person raising one eyebrow skeptically',
    'w3497': 'a perfectly balanced stack of wooden blocks',
    'w3526': 'a runner trailing far behind in a race',
    'w3655': 'a person desperate, hands clasped pleading',
    'w3659': 'a friendly cartoon dinosaur',
    'w3695': 'a person admiring themselves in a hand mirror',
    'w3713': 'two jigsaw puzzle pieces fitting together perfectly',
    'w3811': 'a cutaway view of underground tree roots and soil layers',
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
