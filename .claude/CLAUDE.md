# CLAUDE.md

Projet : planificateur Satisfactory 1.2, page statique publiée sur GitHub Pages. Le README est une présentation courte pour les visiteurs ; la documentation technique est dans `.claude/docs/`. Lire le fichier concerné avant toute modification :

- `docs/jeu/donnees.md` : format de `data.json`, règles de génération, valeurs hors fichiers du jeu et leurs sources.
- `docs/jeu/calculs.md` : calculs de Mon usine et de Transport, limites connues.
- `docs/code/structure.md` : fichiers du dépôt, lancement local.
- `docs/code/interface.md` : conventions d'interface, clés `localStorage`, ancres.
- `docs/code/partage-url.md` : format public des liens de partage.
- `docs/projet/tests.md` : cas de test et valeurs vérifiées à la main.
- `docs/projet/publication.md` : GitHub Pages, organisation, dépôt.

Garder ces fichiers à jour avec le code ; ne pas remettre de détail technique dans le README.

## Règles de code

- Pas de framework, pas de bundler, pas de dépendance d'exécution. Polices Google Fonts seulement.
- Trois fichiers de code : `index.html` (structure, à la racine), `assets/style.css`, `assets/app.js` (une IIFE, script classique) ; données et images dans `assets/`. Pas de découpage supplémentaire (modules ES, plusieurs scripts) sans l'accord de l'utilisateur.
- Interface 100 % en français, noms officiels du jeu (`data.json` → `fr`). Nombres au format français (`fmt`, `fmtIn`, `parseNum`).
- Couleurs uniquement via les variables CSS de `:root` (thème sombre unique, `color-scheme: dark`). Pas de thème clair, pas de `prefers-color-scheme` ni de `data-theme`.
- Saisies numériques : réutiliser la logique existante (virgule, 2 décimales, `MAX_RATE`, valeur restaurée au blur). Ne jamais re-rendre un champ en cours de frappe (le curseur saute) : mettre à jour seulement la zone de résultats (`updateResults`, `updateTransport`).
- `localStorage` toujours via `store.get/set` (try/catch). Nouvelle clé : préfixe `sp-`, et l'ajouter à la liste de `docs/code/interface.md`.
- La fiche pièce ne montre que les recettes standard ; les choix de recettes vivent dans Mon usine (`choiceF`).
- Mise en page sans défilement horizontal à 390 px de large.

## Données

- Ne pas modifier `assets/data.json` à la main : passer par `scripts/build_data.py` (et `scripts/categories.json` pour les catégories).
- `game-docs/` (fichiers du jeu) n'est jamais commité.
- Une valeur de jeu absente des fichiers Docs (ex. capacités wagon/drone) se documente dans `docs/jeu/donnees.md` avec sa source.

## Vérification avant de terminer

1. `python3 -m http.server 8000` puis contrôle visuel avec Playwright (Chromium déjà installé si `npx playwright install chromium` a été fait), à 1 400 px et 390 px, navigateur en `colorScheme: 'light'` (le site doit rester sombre).
2. `npm test` doit passer ; ajouter un cas à `tests/smoke.js` pour tout nouveau calcul, avec une valeur vérifiée à la main (et le reporter dans `docs/projet/tests.md`).
3. Aucune erreur dans la console.

## Git

- Branche par fonctionnalité, commits en français, petits et ciblés. Pas de push sans demande : un push sur `main` publie le site.
