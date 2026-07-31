#!/usr/bin/env python3
"""Batch generator for B1 illustrations (public/images/words/{id}.webp).

Same picturability judgment as the A1/A2 generator scripts, applied to all
of B1's 1343 words. B1 skews far more abstract than A1/A2 (Verantwortung,
Zusammenhang, Voraussetzung...), so the skip rate here is higher — of 754
nouns, 307 verbs, and 168 adjectives, only ~381 had a clear, unambiguous,
concrete depiction. A handful of verbs/adjectives that looked reasonable at
a glance turned out too abstract on closer inspection and are marked
'SKIP' below (filtered out at import time) rather than deleted, so the
judgment call stays visible in the diff.

Same style/quality/background settings as the other generator scripts.
Four content failures were caught and fixed during the full post-batch
audit: three storefront/building words ("Buchhandlung", "Museum",
"Konsulat") that rendered readable signage text despite the style
prompt's "no text" instruction, "Tante" (aunt) which rendered "AUNT" on
the subject's shirt, a game-show buzzer that rendered "BUZZER" on it, a
close-up shoulder shot that tripped the image API's sexual-content safety
filter (reworded to a clearly clothed gesture), and "Hackfleisch" (ground
meat) which rendered as an anatomically convincing brain rather than food
— reworded to browned, clearly-cooked crumbles in a bowl.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-b1-images.py

Resumable: re-running only (re)does words missing from
scripts/.b1-image-manifest.json (gitignored).
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
MANIFEST_PATH = os.path.join(REPO_ROOT, 'scripts', '.b1-image-manifest.json')

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
    'w051': 'a library interior with tall bookshelves',
    'w132': 'a waiter in an apron holding a serving tray',
    'w153': 'a medicine bottle with pills beside it',
    'w163': 'two neighbors chatting over a garden fence',
    'w188': 'a recipe card propped against a wooden spoon, no visible text',
    'w198': 'a bright lightning-bolt icon, representing electricity',
    'w241': 'a retirement home building with elderly residents sitting outside',
    'w277': 'a lawyer in a suit holding a briefcase',
    'w377': 'a farmer in overalls holding a pitchfork',
    'w378': 'a farm with a red barn and open fields',
    'w474': 'a computer monitor screen',
    'w512': 'a mail carrier delivering letters with a shoulder bag',
    'w521': 'a bookstore storefront with books visible in the window, blank sign with no text',
    'w531': 'a hairbrush',
    'w545': 'a house roof with red tiles',
    'w561': 'a cozy folded blanket',
    'w572': 'a cartoon burglar in a striped shirt and mask carrying a loot bag',
    'w630': 'a one-way street arrow road sign',
    'w638': 'a driveway entrance leading up to a house',
    'w670': 'an ice cream cone with two scoops',
    'w685': 'a grandparent playing with a young grandchild',
    'w699': 'a person with a disappointed, slumped expression',
    'w702': 'the planet Earth as seen from space',
    'w707': 'a glowing lightbulb with gears around it, representing an invention',
    'w754': 'an expert professional pointing confidently at a chart',
    'w758': 'a factory building with smokestacks',
    'w786': 'a person leaving the office happily at sunset, end of the workday',
    'w789': 'a TV remote control',
    'w798': 'a computer hard drive',
    'w804': 'a red fire truck',
    'w805': 'a small lighter with a flame',
    'w811': 'a close-up of a single raised index finger',
    'w817': 'a stain on a white shirt',
    'w826': 'an apartment hallway interior',
    'w828': 'a glass of blue liquid being poured',
    'w834': 'a circle, a square, and a triangle together, representing shapes',
    'w847': 'a bird flying freely out of an open cage',
    'w857': 'a hairdresser cutting a client\'s hair',
    'w868': 'a pedestrian shopping street with people walking, no cars',
    'w884': 'a coat rack with several hanging coats',
    'w892': 'a parent gently holding a newborn baby',
    'w893': 'an assortment of pastries on a tray',
    'w900': 'a simple prison cell with bars',
    'w906': 'a locked ornate treasure chest, representing a secret',
    'w931': 'a stack of dishes and plates',
    'w950': 'a wooden rack of spice jars',
    'w952': 'a bottle with a skull-and-crossbones poison symbol',
    'w965': 'a small stack of gold bars and coins',
    'w967': 'a patch of green grass',
    'w990': 'a bowl of browned cooked ground beef crumbles, clearly cooked food, in a kitchen bowl with a wooden spoon beside it',
    'w991': 'a harbor with boats docked',
    'w1002': 'a hammer',
    'w1007': 'a craftsman working with tools at a workbench',
    'w1016': 'a janitor holding a mop and a ring of keys',
    'w1017': 'a dog and a cat sitting together, representing pets',
    'w1023': 'a person looking wistfully at a photo of home',
    'w1044': 'a bright blue sky with a few fluffy clouds',
    'w1054': 'a cobblestone courtyard surrounded by buildings',
    'w1059': 'a stack of wooden logs',
    'w1060': 'a jar of honey with a honey dipper',
    'w1067': 'a hat',
    'w1091': 'an engineer in a hard hat looking at blueprints',
    'w1100': 'a collection of different musical instruments together',
    'w1124': 'a pair of blue jeans',
    'w1133': 'a journalist holding a microphone and notepad',
    'w1144': 'a ceramic teapot',
    'w1164': 'a blank car license plate shape, no visible text or numbers',
    'w1165': 'a single lit candle',
    'w1166': 'a gold necklace chain',
    'w1172': 'a soft pillow on a bed',
    'w1180': 'a dress on a hanger',
    'w1185': 'an air conditioning unit mounted on a wall',
    'w1191': 'a plate of dumplings',
    'w1194': 'a cozy pub interior with a bar',
    'w1195': 'a close-up of a bent knee',
    'w1196': 'a dog bone',
    'w1197': 'a clothing button',
    'w1198': 'a chef in a white hat and apron',
    'w1209': 'a grand consulate building exterior with a generic blank flag, no text anywhere',
    'w1221': 'a colorful costume with a cape and mask',
    'w1227': 'a male nurse in scrubs',
    'w1228': 'a nurse in scrubs with a stethoscope',
    'w1229': 'an ambulance vehicle',
    'w1230': 'a credit card',
    'w1232': 'a simple plus-shaped cross symbol',
    'w1247': 'an abstract painting on an easel with a paintbrush',
    'w1250': 'a winding curved road',
    'w1252': 'a red lipstick kiss mark',
    'w1255': 'a wedge of cheese with holes',
    'w1257': 'a king wearing a crown and royal robe',
    'w1273': 'a warehouse with shelves of boxes',
    'w1288': 'a loudspeaker',
    'w1292': 'a piece of brown leather material',
    'w1297': 'a young apprentice learning from a craftsman',
    'w1321': 'a glass of lemonade with a lemon slice',
    'w1324': 'a close-up of a person\'s lips',
    'w1325': 'a paper checklist with a few checkmarks, no visible text',
    'w1328': 'a round hole in the ground',
    'w1362': 'a jar of jam',
    'w1366': 'a stone wall',
    'w1370': 'a mechanic working underneath a car',
    'w1373': 'a bag of flour',
    'w1391': 'a shiny metal bar',
    'w1417': 'a full moon in a dark sky',
    'w1420': 'a motorcycle',
    'w1422': 'a museum building with tall columns, blank sign with no text',
    'w1432': 'an open storybook with a whimsical castle and dragon illustration',
    'w1440': 'a garbage truck collecting trash bins',
    'w1442': 'a trash bin',
    'w1450': 'a smartphone with a message notification bubble, no visible text',
    'w1454': 'a sewing needle with thread',
    'w1455': 'a hardware nail',
    'w1457': 'a close-up of a nose',
    'w1494': 'a hospital emergency room entrance',
    'w1495': 'an emergency exit door with a running-figure icon',
    'w1523': 'a smiling uncle figure',
    'w1526': 'an opera singer performing on stage',
    'w1532': 'an orchestra with musicians and instruments',
    'w1535': 'a ring binder folder',
    'w1542': 'a broken-down car on the roadside with hazard lights',
    'w1553': 'an airplane passenger sitting in a seat',
    'w1557': 'a patient sitting on a medical exam table',
    'w1558': 'a cracked mirror and a black cat, representing bad luck',
    'w1565': 'a pepper grinder',
    'w1568': 'a band-aid',
    'w1569': 'a plum',
    'w1576': 'a picnic blanket with a basket of food outdoors',
    'w1578': 'a mushroom',
    'w1582': 'a plastic bottle',
    'w1584': 'a politician giving a speech at a podium',
    'w1606': 'a professor lecturing in front of a class',
    'w1612': 'a crowd holding blank protest signs, no visible text',
    'w1620': 'a toy doll',
    'w1631': 'a paper receipt with printed-texture blocks, no readable text',
    'w1634': 'a cyclist riding a bicycle',
    'w1657': 'a bookshelf filled with books',
    'w1692': 'a judge with a gavel',
    'w1694': 'a signpost with arrows pointing in different directions, no text',
    'w1717': 'a burlap sack',
    'w1723': 'a tube of ointment cream',
    'w1727': 'a pile of sand',
    'w1738': "a person's shadow cast on the ground",
    'w1740': 'a shop window display',
    'w1741': 'an actor performing on stage',
    'w1743': 'two wedding rings separated apart',
    'w1761': 'a snake',
    'w1780': 'a breaded schnitzel cutlet',
    'w1782': 'a bar of chocolate',
    'w1785': 'a person with a shocked, startled expression',
    'w1794': 'a person looking guilty, covering their face',
    'w1795': 'a person wearing a shirt, gently touching their own shoulder with the other hand',
    'w1851': 'a pair of socks',
    'w1865': 'a person with a worried, furrowed brow',
    'w1867': 'a souvenir shop shelf with trinkets',
    'w1873': 'a bowl of sauce',
    'w1886': 'a wall mirror',
    'w1891': 'a pile of colorful toys',
    'w1901': 'a magnifying glass over a footprint, representing a clue',
    'w1909': 'a sports stadium full of spectators',
    'w1921': 'a long line of cars stuck in a traffic jam',
    'w1922': 'dust particles visible in a beam of light',
    'w1924': 'an electrical wall outlet',
    'w1926': 'an electrical plug',
    'w1933': 'a rubber ink stamp',
    'w1935': 'a single bright star shape',
    'w1951': 'a parking ticket tucked under a car windshield wiper, no visible text',
    'w1957': 'a single lit matchstick',
    'w1980': 'a supermarket storefront',
    'w1981': 'a bowl of soup',
    'w1995': 'a green valley between mountains',
    'w1998': 'a smiling aunt figure, a woman in a plain solid-color shirt with no text or writing on it',
    'w2004': 'a folded handkerchief',
    'w2006': 'a computer keyboard',
    'w2026': 'a tennis racket and ball',
    'w2027': 'a patterned area rug',
    'w2029': 'an outdoor terrace with chairs and potted plants',
    'w2054': 'a large iron gate',
    'w2060': 'a tourist with a camera and a map',
    'w2064': 'a sports coach with a whistle',
    'w2079': 'a few coins left on a restaurant table as a tip',
    'w2081': 'a single water droplet',
    'w2086': 'a tall tower',
    'w2095': 'a subway train',
    'w2100': 'a clipboard survey with checkboxes, no visible text',
    'w2103': 'a detour road sign with an arrow',
    'w2173': 'a busy street full of car traffic',
    'w2175': 'a generic road traffic sign shape, no text',
    'w2226': 'a passport open to a visa stamp page, no visible text',
    'w2227': 'a bottle of vitamin pills',
    'w2248': 'a suburban neighborhood with houses',
    'w2308': 'an auto repair workshop with tools',
    'w2309': 'a set of hand tools',
    'w2319': 'a green meadow with wildflowers',
    'w2343': 'a cozy living room interior',
    'w2350': 'a small bandaged wound on an arm',
    'w2361': 'a thick dictionary book',
    'w2368': 'a toothbrush with toothpaste on it',
    'w2377': 'a magazine with a colorful cover, no visible text',
    'w2399': 'a bowl of sugar cubes',
    'w2432': 'an onion',
    'w2665': 'an adventurer with a backpack and map exploring a jungle',
    'w2678': 'an architect with blueprints and a small building model',
    'w2680': 'a person breathing deeply, visible breath in cold air',
    'w2686': 'a cozy cocktail bar with stools',
    'w2687': 'a basketball',
    'w2689': 'a ballet dancer en pointe',
    'w2699': 'a microscope with a specimen slide',
    'w2706': 'a medieval stone castle',
    'w2713': 'a fancy dessert, a slice of cake with berries',
    'w2718': 'a stack of paper documents, no visible text',
    'w2722': 'a rolled diploma certificate with a ribbon, no visible text',
    'w2740': 'colorful carnival masks and confetti',
    'w2748': 'a scientist in a lab coat with test tubes',
    'w2750': 'a photographer taking a photo with a camera',
    'w2751': 'a white dove holding an olive branch, representing peace',
    'w2755': 'an art gallery with paintings on the wall',
    'w2757': 'a range of several mountain peaks',
    'w2761': 'a city sidewalk',
    'w2762': 'an ATM cash machine',
    'w2769': 'a golf club and ball',
    'w2773': 'a gymnast performing a balance pose',
    'w2775': 'a superhero in a cape striking a heroic pose',
    'w2782': 'a green rolling hill',
    'w2783': 'a small wooden cabin in the woods',
    'w2787': 'a small snack bar street stand',
    'w2791': 'a coiled electrical cable',
    'w2793': 'a mug of hot cocoa with whipped cream',
    'w2796': 'a carrot',
    'w2798': 'a cassette tape',
    'w2799': 'a wooden crate',
    'w2804': 'a business conference room with people around a table',
    'w2809': 'a power plant with cooling towers',
    'w2826': 'a butcher behind a meat counter',
    'w2834': 'a tutor helping a student one-on-one with homework',
    'w2835': 'a bowl of muesli cereal with fruit',
    'w2840': 'a fishing net',
    'w2854': 'a person presenting a chart on a screen to an audience',
    'w2858': 'a large red game-show buzzer button, completely blank with no text',
    'w2884': 'a secretary at a reception desk',
    'w2893': 'a flight attendant in uniform on an airplane',
    'w2911': 'a folded cloth scarf',
    'w2913': 'a river shore with smooth pebbles',
    'w2916': 'a uniform jacket on a hanger',
    'w2917': 'a university campus building',
    'w2921': 'a vase with flowers',
    'w2944': 'a stylized virus cell shape, modern icon style',
    'w2945': 'a blank business card, no visible text',
    'w2946': 'a volleyball',
    'w2959': 'a scientist with safety goggles holding a beaker',
    'w2963': 'a pair of pliers',
    # --- verbs ---
    'w202': 'a car turning at a road intersection',
    'w208': 'a person withdrawing cash from an ATM',
    'w214': 'a person stepping on a bathroom scale, smiling',
    'w220': 'a hand placing a ballot into a voting box',
    'w267': 'a hand plugging in an electrical cable',
    'w269': 'a person fastening a seatbelt in a car',
    'w299': "a person taking a deep breath, chest expanding",
    'w305': 'a person sitting dejected with hands raised in surrender',
    'w307': 'a person picking up a dropped item from the floor',
    'w311': 'a hand holding a microphone, recording audio',
    'w318': 'a hand plugging in an electrical cable',
    'w397': 'two people walking side by side, accompanying each other',
    'w418': 'a person looking through binoculars, observing',
    'w494': 'a flower blooming open',
    'w504': 'a wooden stick snapping in half, breaking',
    'w592': 'a hand turning a round dial or knob',
    'w650': 'a person taking a pill with a glass of water',
    'w662': 'a person walking through an open doorway, entering',
    'w686': 'a person opening a treasure chest, discovering it, excited',
    'w695': 'a person throwing trash into a bin',
    'w713': 'SKIP',
    'w729': 'a person checking off items on a to-do list',
    'w734': 'a person reaching up to grab something on a high shelf',
    'w743': 'a parent gently teaching a child',
    'w778': 'a person catching a ball',
    'w822': 'water flowing in a stream',
    'w830': 'a person following a trail of footprints',
    'w850': 'an animal eating from a bowl',
    'w874': 'SKIP',
    'w912': 'SKIP',
    'w951': 'a person watering a potted plant with a watering can',
    'w971': 'a hand reaching out and grabbing an object',
    'w1005': 'SKIP',
    'w1019': 'SKIP',
    'w1065': 'a car honking with sound waves shown near the horn',
    'w1179': 'a hand gluing paper with a glue stick',
    'w1187': 'a hand pressing a doorbell button',
    'w1190': 'a hand knocking on a door',
    'w1217': 'a photocopier machine copying a page',
    'w1263': 'a person handing in a resignation letter',
    'w1327': 'a person clapping and giving an enthusiastic thumbs up',
    'w1337': 'a person smiling warmly',
    'w1342': 'a hand pressing a trash/delete icon button',
    'w1361': 'a hand highlighting text with a highlighter, no visible text',
    'w1389': 'a person measuring an object with a tape measure',
    'w1507': 'a person sewing with a needle and thread',
    'w1528': 'a surgeon in an operating room with a patient',
    'w1643': 'SKIP',
    'w1671': 'SKIP',
    'w1679': 'a person running fast',
    'w1689': 'a lifeguard rescuing someone from water',
    'w1739': 'SKIP',
    'w1789': 'a person screaming with hands on cheeks',
    'w1806': 'a person sweating profusely while exercising',
    'w1807': 'a person shrugging thoughtfully, estimating',
    'w1842': 'a small boat sinking into the water',
    'w1904': 'SKIP',
    'w1917': 'SKIP',
    'w1925': 'a hand putting a key into a lock',
    'w1929': 'a person climbing a ladder',
    'w1942': 'a person holding their nose at a bad smell',
    'w1948': 'a large red stop hand gesture',
    'w1978': 'SKIP',
    'w1996': 'a person filling up a car with fuel at a gas station',
    'w2073': 'SKIP',
    'w2080': 'clothes hanging on a line to dry',
    'w2098': 'two people hugging warmly',
    'w2131': 'SKIP',
    'w2149': 'a bandage being wrapped around a wrist',
    'w2167': 'a magnifying glass making an object look larger',
    'w2178': 'a person walking away from a house with a suitcase',
    'w2185': 'a rubber band being stretched longer',
    'w2193': 'a person running after a departing bus, missing it',
    'w2198': "a magician's disappearing trick with a puff of smoke",
    'w2203': 'two people doing a pinky-promise',
    'w2221': 'two identical twins side by side, easy to mix up',
    'w2245': 'a parent reading a book aloud to a child',
    'w2263': 'a small seedling growing taller in stages',
    'w2306': 'a person throwing a ball',
    'w2318': 'a kitchen scale weighing food',
    'w2405': 'SKIP',
    'w2435': 'a person counting on their fingers',
    'w2451': 'a car overtaking another car on a road',
    'w2458': 'a person crossing a street at a crosswalk',
    'w2459': 'a person jumping out with a surprise party popper',
    'w2668': 'a hand crossing out a date on a calendar, no visible numbers',
    'w2682': 'a phone charging with a battery icon',
    'w2688': 'a child doing crafts with scissors and colorful paper',
    'w2693': 'a dog biting playfully on a chew toy',
    'w2710': 'a person decorating a Christmas tree',
    'w2753': 'a person feeding an animal from a bowl',
    'w2764': 'a hand stamping approval on a document',
    'w2774': 'hailstones falling from a stormy sky',
    'w2779': 'a cloud upload arrow icon above a device',
    'w2802': 'a person climbing a rock-climbing wall',
    'w2836': 'a person looking up a word in a dictionary',
    'w2849': 'a person planting a seedling in soil',
    'w2876': 'a person applying makeup in front of a mirror',
    'w2882': 'a hand shaking a snow globe',
    'w2894': 'a bee stinging, with a small stinger visible',
    'w2905': 'two people exchanging items with each other',
    'w2909': 'hands typing on a keyboard',
    'w2951': 'a person crossing their arms and shaking their head no, refusing',
    'w2957': 'SKIP',
    'w2973': 'a person nodding in agreement',
    # --- adjectives ---
    'w459': 'a person stumbling with a wobbly, dizzy expression',
    'w570': 'SKIP',
    'w587': 'two identical objects side by side, representing double',
    'w673': 'a person dressed in elegant formal evening wear',
    'w696': 'SKIP',
    'w732': 'a person with a serious, stern expression',
    'w780': 'SKIP',
    'w802': 'a damp, wet sponge',
    'w815': 'a flat pancake',
    'w819': 'a bent, flexible ruler curving',
    'w845': 'a child sticking their tongue out playfully, cheeky',
    'w880': 'a fully cooked steak on a plate',
    'w915': 'SKIP',
    'w923': 'a balanced justice scale',
    'w938': 'a curious child peeking eagerly around a corner',
    'w956': 'a wet, slippery floor with a caution sign',
    'w982': 'SKIP',
    'w1078': 'SKIP',
    'w1193': 'SKIP',
    'w1206': 'a tangled knot of string and wires, complicated',
    'w1266': 'a plastic artificial flower next to a real one',
    'w1329': 'a loose screw',
    'w1348': 'a lean cut of meat',
    'w1387': 'SKIP',
    'w1427': 'SKIP',
    'w1476': 'a curious child peeking around a corner',
    'w1562': 'a five-star rating shown with stars, representing perfection',
    'w1667': 'a ripe red tomato',
    'w1696': 'SKIP',
    'w1701': 'a raw piece of meat',
    'w1728': 'a person patting their full stomach, satisfied after eating',
    'w1752': 'a crooked, leaning picture frame on a wall',
    'w1770': 'SKIP',
    'w1831': 'a single vertical pole',
    'w1892': 'a sharpened pencil tip',
    'w1930': 'a steep staircase',
    'w1947': 'a person standing proud with chest out',
    'w2092': 'SKIP',
    'w2141': 'a plate of vegetables with a crossed-out meat icon',
    'w2261': 'a single horizontal line',
    'w2363': 'a person furious with steam coming from their ears',
    'w2439': 'SKIP',
    'w2473': 'a few crumbs left on an empty plate',
    'w2670': 'an empty chair at a table, representing absence',
    'w2683': 'a person leaning in closely, listening attentively',
    'w2700': 'a leaf symbol on organic food packaging',
    'w2702': 'a person with a white cane and dark glasses',
    'w2727': 'a person reaching thirstily for a glass of water',
    'w2728': 'an angular geometric cube shape',
    'w2815': 'a person savoring delicious food, eyes closed happily',
    'w2848': 'a person blushing red with embarrassment',
    'w2904': 'a person cupping a hand behind their ear, unable to hear',
    'w2910': 'a loyal dog sitting beside its owner',
    'w2934': 'SKIP',
    'w2954': 'SKIP',
    'w2958': 'a wild lion in a natural setting',
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
