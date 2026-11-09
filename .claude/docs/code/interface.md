# Conventions d'interface

- Interface entièrement en français, nombres au format français (virgule décimale).
- Thème sombre unique via les variables CSS de `:root` (`color-scheme: dark`), indépendant de la préférence du système. Accent rouille (survol, sélection) ; jaune `--star` pour les recettes alternatives.
- Ombres de profondeur `--sh-1`, `--sh-2`, `--sh-btn`, `--sh-in`.
- Saisie des débits : virgule (le point est converti), une seule virgule, 2 décimales max, 100 000 max ; un champ vidé reprend une valeur au blur. Temps : minutes + secondes entières, 2 h max.
- Arbres de fabrication (onglet Arbres, détail d'une étape) : seul le premier niveau sous la pièce est déplié, la suite se charge au dépliage. L'état ouvert ou fermé de chaque nœud est gardé en mémoire (`treeOpen`, clé « portée|chemin » : `data-s` + `data-p`), pas dans `localStorage`, pour survivre aux re-rendus de `updateResults` ; il est perdu au rechargement. Mise en page d'un nœud : le triangle est un `::before` du `summary` (flex), jamais seul sur sa ligne ; les groupes `.nh` (icône, quantité, nom) et `.mk` (icône et nombre de machines) ne se coupent pas entre icône et texte.
- Composants maison : infobulles interactives (`#tip`), menu de recettes (`#rmenu`), sélecteur de pièce (`#ipick`), toast, modale (`#modal`).

## État local (`localStorage`)

`sp-choice-f`, `sp-factory`, `sp-sel`, `sp-view`, `sp-tab-i`, `sp-tab-f`, `sp-qmode`, `sp-transport` (+ ancien `sp-choice`, lu en repli). Toute nouvelle clé s'ajoute ici.

## Ancres

`#usine`, `#transport`, `#desc-ironplate-c` (fiche), `#usine:…` (usine partagée, voir [partage-url.md](partage-url.md)).
