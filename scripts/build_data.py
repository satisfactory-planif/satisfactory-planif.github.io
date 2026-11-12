"""Build assets/data.json from the game's own data files (CommunityResources/Docs).

Usage (from the repository root):
    python3 scripts/build_data.py game-docs assets/data.json

<game-docs> must contain en-US.json and fr.json, copied from
<Satisfactory install>/CommunityResources/Docs/ (UTF-16 files).

What it does:
- recipes made in production machines (en + fr names, duration, power, inputs, outputs; fluids in m³)
- alternate flag: recipe unlocked only by hard-drive schematics (EST_Alternate) or named Recipe_Alternate_*
- default ("std") recipe per item and the list of every recipe producing it ("opts")
- items: en/fr names, fluid, raw resource, stack size, sink points, category, FICSMAS flag
- categories come from scripts/categories.json; unknown new items go to "Autres" (edit the file to place them)
- icons are NOT extracted from the game: the script only flags whether assets/images/items/<Item>.png exists
"""
import json, os, re, sys
from collections import defaultdict

docs, out = sys.argv[1], sys.argv[2]
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load(lang):
    d = json.load(open(os.path.join(docs, lang + '.json'), encoding='utf-16'))
    return {g['NativeClass'].split('.')[-1].rstrip("'"): g['Classes'] for g in d}

EN, FR = load('en-US'), load('fr')
fr_name = {c['ClassName']: c.get('mDisplayName', '') for g in FR.values() for c in g}
PAIR = re.compile(r"""ItemClass="[^"]*?\.(\w+?_C)'?",Amount=(\d+)""")

machines = {}
for g in ('FGBuildableManufacturer', 'FGBuildableManufacturerVariablePower'):
    for c in EN[g]:
        machines[c['ClassName']] = dict(en=c['mDisplayName'], fr=fr_name.get(c['ClassName']) or c['mDisplayName'],
                                       mw=float(c.get('mPowerConsumption', 0)), var=g.endswith('VariablePower'))

items_raw, raw = {}, set()
for g, classes in EN.items():
    for c in classes:
        if 'mForm' in c and 'mDisplayName' in c:
            items_raw[c['ClassName']] = c
            if g == 'FGResourceDescriptor':
                raw.add(c['ClassName'])
fluid = lambda cls: items_raw.get(cls, {}).get('mForm') in ('RF_LIQUID', 'RF_GAS')

unlock = defaultdict(set)
for s in EN['FGSchematic']:
    for r in re.findall(r'\.(Recipe_\w+?_C)', json.dumps(s.get('mUnlocks', ''))):
        unlock[r].add(s['mType'])

recipes = {}
for c in EN['FGRecipe']:
    prod_in = re.findall(r'\.(Build_\w+?_C)', c.get('mProducedIn', ''))
    m = next((p for p in prod_in if p in machines), None)
    if not m:
        continue
    t = float(c['mManufactoringDuration'])
    conv = lambda s: [[k, int(a) / 1000 if fluid(k) else int(a)] for k, a in PAIR.findall(s)]
    ins, outs = conv(c['mIngredients']), conv(c['mProduct'])
    if not outs:
        continue
    mw = (float(c['mVariablePowerConsumptionConstant']) + float(c['mVariablePowerConsumptionFactor']) / 2) if machines[m]['var'] else machines[m]['mw']
    rid, types = c['ClassName'], unlock.get(c['ClassName'], set())
    recipes[rid] = dict(en=c['mDisplayName'], fr=fr_name.get(rid) or c['mDisplayName'],
                        alt=('_Alternate_' in rid) or (bool(types) and types <= {'EST_Alternate'}),
                        m=m, t=t, mw=round(mw, 2), i=ins, o=outs)

used = set()
for r in recipes.values():
    used |= {x[0] for x in r['i']} | {x[0] for x in r['o']}

def rank(rid, item):
    r, s = recipes[rid], 0
    if r['alt']: s += 100
    if r['o'][0][0] != item: s += 50
    if 'Unpackage' in rid: s += 40
    if r['m'] == 'Build_Converter_C' and item in raw: s += 30
    if r['en'] != items_raw[item]['mDisplayName']: s += 1
    return s

# Defaults the ranking cannot settle: the three Ficsite Ingot recipes are all standard in the game.
# Aluminium needs the least S.A.M. per ingot (8 ore vs 12 caterium, 16 iron) and is what
# satisfactory-calculator.com picks, so plans match theirs.
STD_PICK = {'Desc_FicsiteIngot_C': 'Recipe_FicsiteIngot_AL_C'}

std, opts = {}, {}
for item in sorted(used):
    cands = sorted((rid for rid, r in recipes.items() if any(o[0] == item for o in r['o'])),
                   key=lambda rid: (rank(rid, item), recipes[rid]['en']))
    opts[item] = cands
    if item in raw:
        continue
    if item in STD_PICK:
        std[item] = STD_PICK[item]
        continue
    ok = [rid for rid in cands if not recipes[rid]['alt'] and 'Unpackage' not in rid]
    if ok:
        std[item] = ok[0]

catf = json.load(open(os.path.join(root, 'scripts', 'categories.json'), encoding='utf-8'))
EVENT = re.compile(r'Xmas|CandyCane|Fireworks|Gift|Snow')
items, new_items = {}, []
for c in sorted(used):
    it = items_raw[c]
    cat = catf['items'].get(c)
    if cat is None:
        cat = 'FICSMAS (événement)' if EVENT.search(c) else 'Autres'
        new_items.append(c)
    rec = dict(en=it['mDisplayName'], fr=fr_name.get(c) or it['mDisplayName'], fl=fluid(c), raw=c in raw,
               ico=os.path.exists(os.path.join(root, 'assets', 'images', 'items', c + '.png')),
               sink=int(it.get('mResourceSinkPoints', '0') or 0), cat=cat, st=int(it.get('mCachedStackSize', '0') or 0))
    if cat.startswith('FICSMAS'):
        rec['ev'] = True
    items[c] = rec

data = dict(
    meta=dict(title='Satisfactory – données de production',
              source='Fichiers du jeu CommunityResources/Docs (en-US.json, fr.json)',
              icons='Icônes 64 px issues du projet SatisfactoryTools (ressources du jeu, © Coffee Stain Studios)',
              format={'items': 'classe -> {en, fr, fl (fluide), raw (ressource brute), ico, sink, cat, st (taille de pile ; fluides en litres), ev (FICSMAS)}',
                      'recipes': 'classe -> {en, fr, alt, m (machine), t (s par cycle), mw (MW moyens à 100 %), i/o: [[objet, quantité par cycle]] ; fluides en m³}',
                      'std': 'objet -> recette par défaut', 'opts': 'objet -> toutes les recettes qui le produisent',
                      'machines': 'classe -> nom français', 'cats': 'ordre des catégories du catalogue'}),
    version='1.2 – fichiers du jeu (CommunityResources/Docs)',
    items=items, recipes=recipes, std=std, opts=opts,
    machines={k: v['fr'] for k, v in machines.items()}, cats=catf['order'])
json.dump(data, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f"items {len(items)} · recipes {len(recipes)} (alt {sum(r['alt'] for r in recipes.values())}) · default recipes {len(std)}")
if new_items:
    print('New items placed by default, add them to scripts/categories.json:', ', '.join(new_items))
missing = [c for c, i in items.items() if not i['ico']]
if missing:
    print('Items without icon (assets/images/items/<Item>.png missing):', ', '.join(missing))
