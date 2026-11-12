# Données du jeu (`assets/data.json`)

Source : `<installation Satisfactory>/CommunityResources/Docs/en-US.json` et `fr.json` (UTF-16), fournis par le jeu. Copie locale dans `game-docs/`, jamais versionnée.

## Format

| Clé | Contenu |
|---|---|
| `items` | classe → `{en, fr, fl (fluide), raw (ressource brute), ico (icône présente), sink (points), cat, st (taille de pile ; fluides en litres), ev (FICSMAS, optionnel)}` |
| `recipes` | classe → `{en, fr, alt, m (machine), t (s/cycle), mw (MW moyens à 100 %), i, o}` ; `i`/`o` = `[[objet, quantité par cycle]]`, fluides en m³ |
| `std` | objet → recette par défaut (absente pour les ressources brutes) |
| `opts` | objet → toutes les recettes qui le produisent, triées (standard d'abord) |
| `machines` | classe de machine → nom français officiel |
| `cats` | ordre des catégories du catalogue (se termine par « Autres », « FICSMAS (événement) ») |
| `extractors` | classe d'extracteur → `{fr, mw, rate (/min à 100 % sur gisement normal ; fluides en m³), pur (pureté applicable), res ("solid" ou [ressources]), press (pressuriseur : {fr, mw}, extracteur de puits seulement)}` |

## Règles de génération (`scripts/build_data.py`)

- Seules les recettes fabriquées dans une machine de production sont gardées (pas l'atelier, pas les bâtiments).
- **Alternative** : id contenant `_Alternate_`, ou recette débloquée uniquement par des schémas `EST_Alternate` (disques durs).
- **Recette par défaut** : classement (alternative +100, produit secondaire +50, « Unpackage » +40, convertisseur produisant une ressource brute +30, nom différent de l'objet +1). Exception codée : Lingot de ficsite → `Recipe_FicsiteIngot_AL_C` (les trois recettes sont standard en 1.2 ; l'aluminium demande le moins d'É.M.E. par lingot, 8 contre 12 au caterium et 16 au fer, et c'est le choix de satisfactory-calculator.com).
- **Puissance** des machines à puissance variable (accélérateur, convertisseur, encodeur) : `constante + facteur / 2` (moyenne).
- **Extracteurs** : foreuses Mk.1 à Mk.3, Puit de pétrole, Pompe à eau, Extracteur de puits de ressources (+ Pressuriseur). Débit = `mItemsPerCycle / mExtractCycleTime × 60` (÷ 1 000 pour les fluides) ; ressources = `mAllowedResources` (toutes les ressources solides pour les foreuses). L'extracteur de puits n'est gardé que pour ce qu'aucun autre extracteur ne donne (azote). La Pompe à eau n'a pas de pureté (posée sur l'eau, pas sur un gisement).
- Noms français : ceux du jeu (`fr.json`).
- Catégories : `scripts/categories.json`. Un nouvel objet absent du fichier tombe dans « Autres » (ou FICSMAS si son nom correspond à `Xmas|CandyCane|Fireworks|Gift|Snow`) et le script le signale.
- Les icônes ne sont pas extraites du jeu : elles viennent du projet [SatisfactoryTools](https://github.com/greeny/SatisfactoryTools). Un nouvel objet sans `assets/images/items/<Item>.png` est signalé.

## Régénérer après une mise à jour du jeu

```bash
cp "<Satisfactory>/CommunityResources/Docs/en-US.json" "<Satisfactory>/CommunityResources/Docs/fr.json" game-docs/
python3 scripts/build_data.py game-docs assets/data.json
```

Avec les fichiers 1.2, le script reproduit `assets/data.json` à l'identique (vérifié le 2026-11-09, même SHA-256).

## Valeurs absentes des fichiers Docs

| Valeur | Utilisée | Source |
|---|---|---|
| Wagon : 32 emplacements | Transport | wiki, non relue dans les fichiers du jeu |
| Wagon fluide : 1 600 m³ | Transport | wiki, non relue dans les fichiers du jeu |
| Drone : 9 piles par trajet | Transport | wiki, non relue dans les fichiers du jeu |
| Chargement / déchargement : 27 s chacun | Transport | fichiers du jeu, `mTimeToCompleteLoad/Unload` |
| Pureté des gisements : impur × 0,5, normal × 1, pur × 2 | Mon usine (extraction) | wiki ([Resource Well Pressurizer](https://satisfactory.wiki.gg/wiki/Resource_Well_Pressurizer) : 30 / 60 / 120 m³/min par extracteur de puits) |
| Nœuds satellites par puits : variable | Mon usine (azote) | wiki, même page : « chaque puits a un nombre différent de nœuds » ; d'où un seul pressuriseur compté |
