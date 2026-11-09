# CLAUDE.md

Projet : planificateur Satisfactory 1.2, page statique publiée sur GitHub Pages. Le README décrit les données, les calculs et les conventions : le lire avant toute modification.

## Règles de code

- Pas de framework, pas de bundler, pas de dépendance d'exécution. Polices Google Fonts seulement.
- Tout est dans `index.html` (CSS puis JS dans une IIFE). Ne pas découper en fichiers séparés sans l'accord de l'utilisateur.
- Interface 100 % en français, noms officiels du jeu (`data.json` → `fr`). Nombres au format français (`fmt`, `fmtIn`, `parseNum`).
- Couleurs uniquement via les variables CSS ; toute nouvelle variable doit exister en clair ET dans les deux blocs sombres (`prefers-color-scheme` et `[data-theme="dark"]`).
- Saisies numériques : réutiliser la logique existante (virgule, 2 décimales, `MAX_RATE`, valeur restaurée au blur). Ne jamais re-rendre un champ en cours de frappe (le curseur saute) : mettre à jour seulement la zone de résultats (`updateResults`, `updateTransport`).
- `localStorage` toujours via `store.get/set` (try/catch). Nouvelle clé : préfixe `sp-`, et l'ajouter à la liste du README.
- La fiche pièce ne montre que les recettes standard ; les choix de recettes vivent dans Mon usine (`choiceF`).
- Mise en page sans défilement horizontal à 390 px de large.

## Données

- Ne pas modifier `data.json` à la main : passer par `scripts/build_data.py` (et `scripts/categories.json` pour les catégories).
- `game-docs/` (fichiers du jeu) n'est jamais commité.
- Une valeur de jeu absente des fichiers Docs (ex. capacités wagon/drone) se documente dans le README avec sa source.

## Vérification avant de terminer

1. `python3 -m http.server 8000` puis contrôle visuel avec Playwright (Chromium déjà installé si `npx playwright install chromium` a été fait), en clair et en sombre, à 1 400 px et 390 px.
2. `npm test` doit passer ; ajouter un cas à `tests/smoke.js` pour tout nouveau calcul, avec une valeur vérifiée à la main.
3. Aucune erreur dans la console.

## Git

- Branche par fonctionnalité, commits en français, petits et ciblés. Pas de push sans demande.
