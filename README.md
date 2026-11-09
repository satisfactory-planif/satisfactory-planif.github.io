# Planificateur Satisfactory

Outil web statique (une page, sans build ni backend) pour Satisfactory 1.2, en français :

- **Fiche pièce** : machine, ingrédients (par pièce ou par machine/min), ressources brutes totales, recettes alternatives comparées, onglets « Utilisé dans » et « Sans cette pièce ». Recettes standard uniquement, aucune donnée d'usine.
- **Mon usine** : plusieurs objectifs (pièce + débit), recettes alternatives par usine, sous-produits déduits, étapes avec nombre de machines, arbres de production, ressources brutes à amener.
- **Transport** : tapis, trains (mono ou mixtes, découpage en plusieurs trains), drones (batteries), en saisie libre ou à partir des ressources de Mon usine.

## Lancer en local

`fetch("data.json")` ne fonctionne pas en `file://`, il faut un serveur HTTP :

```bash
python3 -m http.server 8000
# puis http://localhost:8000/
```

## Structure

```
index.html            toute l'application (HTML + CSS + JS dans un seul fichier)
data.json             données du jeu, générées par scripts/build_data.py
icons/<Item>.png      168 icônes d'objets (64 px), nom = classe de l'objet (Desc_IronPlate_C.png)
machines/<Build>.png  11 icônes de machines (Build_ConstructorMk1_C.png…)
scripts/build_data.py régénère data.json depuis les fichiers du jeu
scripts/categories.json  catégorie de chaque objet + ordre des catégories du catalogue
tests/smoke.js        test Playwright (valeurs connues)
game-docs/            fichiers du jeu en-US.json / fr.json (NON versionnés, voir .gitignore)
```

## Données (`data.json`)

Source : `<installation Satisfactory>/CommunityResources/Docs/en-US.json` et `fr.json` (UTF-16), fournis par le jeu.

| Clé | Contenu |
|---|---|
| `items` | classe → `{en, fr, fl (fluide), raw (ressource brute), ico (icône présente), sink (points), cat, st (taille de pile ; fluides en litres), ev (FICSMAS, optionnel)}` |
| `recipes` | classe → `{en, fr, alt, m (machine), t (s/cycle), mw (MW moyens à 100 %), i, o}` ; `i`/`o` = `[[objet, quantité par cycle]]`, fluides en m³ |
| `std` | objet → recette par défaut (absente pour les ressources brutes) |
| `opts` | objet → toutes les recettes qui le produisent, triées (standard d'abord) |
| `machines` | classe de machine → nom français officiel |
| `cats` | ordre des catégories du catalogue (se termine par « Autres », « FICSMAS (événement) ») |

Règles de génération (scripts/build_data.py) :

- Seules les recettes fabriquées dans une machine de production sont gardées (pas l'atelier, pas les bâtiments).
- **Alternative** : id contenant `_Alternate_`, ou recette débloquée uniquement par des schémas `EST_Alternate` (disques durs).
- **Recette par défaut** : classement (alternative +100, produit secondaire +50, « Unpackage » +40, convertisseur produisant une ressource brute +30, nom différent de l'objet +1). Exception codée : Lingot de ficsite → `Recipe_FicsiteIngot_Iron_C` (les trois recettes sont standard en 1.2).
- **Puissance** des machines à puissance variable (accélérateur, convertisseur, encodeur) : `constante + facteur / 2` (moyenne).
- Noms français : ceux du jeu (`fr.json`).
- Catégories : `scripts/categories.json`. Un nouvel objet absent du fichier tombe dans « Autres » (ou FICSMAS si son nom correspond à `Xmas|CandyCane|Fireworks|Gift|Snow`) et le script le signale.
- Les icônes ne sont pas extraites du jeu : elles viennent du projet SatisfactoryTools. Un nouvel objet sans `icons/<Item>.png` est signalé.

Régénérer après une mise à jour du jeu :

```bash
cp "<Satisfactory>/CommunityResources/Docs/en-US.json" "<Satisfactory>/CommunityResources/Docs/fr.json" game-docs/
python3 scripts/build_data.py game-docs data.json
```

Le script reproduit à l'identique le `data.json` actuel avec les fichiers 1.2 (vérifié).

## Calculs

### Mon usine (`plan(targets)`)

- Point fixe itératif : la demande de chaque pièce génère des machines, dont les sorties secondaires sont déduites de la demande des autres (`supply`, `supplyBy`), jusqu'à stabilisation (`converged`). Si les recettes choisies forment une boucle qui ne converge pas, la page l'indique.
- Résultat : `demand`, `supply`, `mach`, `raw`, `recovered`, `surplus`, `nMach`, `mw`, `flows` (consommateur → quantité), `supplyBy`.
- Machines : « 1 machine à X % » ou « N machines, dont 1 à X % » (pas d'overclocking ni de Somersloop dans le calcul).
- Arbres : nets des sous-produits (`netSplit`) : « dont X récupérés, sous-produit de … », le reste à fabriquer ou amener.

### Transport

- Wagon : 32 emplacements × taille de pile ; wagon fluide 1 600 m³.
- Aller-retour effectif = temps saisi + 54 s si « arrêts » est coché (27 s chargement + 27 s déchargement, valeurs `mTimeToCompleteLoad/Unload` des fichiers du jeu).
- Débit d'alimentation d'un quai = 2 × tapis choisi (fluides : 2 × 600 m³/min).
- Wagons = max(ceil(débit / débit par wagon), ceil(débit / alimentation des quais)).
- Au-delà de `maxW` wagons (8 par défaut) : plusieurs trains identiques partageant les gares, ou locomotives supplémentaires (1 par 8 wagons) selon l'option.
- Trains mixtes : une composition par train.
- Drones : 9 piles par trajet, batteries/min = drones × batteries par aller-retour / durée ; fluides impossibles.
- Tapis : niveaux 60 / 120 / 270 / 480 / 780 / 1 200 ; tuyaux 600 m³/min.

## Conventions d'interface

- Interface entièrement en français, nombres au format français (virgule décimale).
- Thèmes clair/sombre via variables CSS (`:root`, `prefers-color-scheme`, `data-theme`). Accent rouille (survol, sélection) ; jaune `--star` pour les recettes alternatives.
- Ombres de profondeur `--sh-1`, `--sh-2`, `--sh-btn`, `--sh-in`.
- Saisie des débits : virgule (le point est converti), une seule virgule, 2 décimales max, 100 000 max ; un champ vidé reprend une valeur au blur. Temps : minutes + secondes entières, 2 h max.
- Composants maison : infobulles interactives (`#tip`), menu de recettes (`#rmenu`), sélecteur de pièce (`#ipick`), toast, modale (`#modal`).
- État local (`localStorage`) : `sp-choice-f`, `sp-factory`, `sp-sel`, `sp-view`, `sp-tab-i`, `sp-tab-f`, `sp-qmode`, `sp-transport` (+ ancien `sp-choice`, lu en repli). Ancres : `#usine`, `#transport`, `#desc-ironplate-c` (fiche).

## Tests

```bash
npm install
npx playwright install chromium
npm test
```

`tests/smoke.js` lance un serveur local, charge Mon usine avec des objectifs connus et vérifie les ressources à amener (cadre modulaire lourd 2/min → 480 minerai de fer/min ; lingot d'aluminium 60/min → 60 m³ d'eau nette). Valeurs déjà vérifiées à la main : variante lingot de fer pur → 341,5 minerai + 92 m³ d'eau ; 1 400 minerai/min, aller-retour 4 min avec arrêts → 3 wagons.

## Limites connues

- Pas d'overclocking, de Somersloop ni de calcul de foreuses/extracteurs dans Mon usine.
- Puissance moyenne seulement pour les machines à puissance variable.
- Capacités wagon (32) et drone (9 piles) reprises du wiki, non relues dans les fichiers du jeu.
- Pas de comparaison de coût de construction entre tapis, trains et drones.

## Publication (GitHub Pages)

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. Le fichier `.nojekyll` évite le passage par Jekyll. Gratuit pour un dépôt public ; site ≤ 1 Go ; limite indicative de 100 Go de bande passante par mois ; usage non commercial.

## Droits

Les noms, données et icônes du jeu appartiennent à Coffee Stain Studios. Les icônes proviennent du projet [SatisfactoryTools](https://github.com/greeny/SatisfactoryTools). Les fichiers bruts du jeu (`game-docs/`) ne sont pas versionnés.
