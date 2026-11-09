# Structure du dépôt

```
index.html                         structure de la page (en-tête, catalogue, zone principale)
assets/                            tout ce que la page charge
  app.js                           toute la logique (IIFE, script classique, sans module)
  style.css                        tous les styles, variables de thème comprises
  data.json                        données du jeu, générées par scripts/build_data.py
  images/items/<Item>.png          168 icônes d'objets (64 px), nom = classe de l'objet (Desc_IronPlate_C.png)
  images/machines/<Build>.png      11 icônes de machines (Build_ConstructorMk1_C.png…)
scripts/build_data.py              régénère assets/data.json depuis les fichiers du jeu
scripts/categories.json            catégorie de chaque objet + ordre des catégories du catalogue
tests/smoke.js                     test Playwright (valeurs connues, ressources en 404, mise en page)
game-docs/                         fichiers du jeu en-US.json / fr.json (NON versionnés, voir .gitignore)
.claude/                           CLAUDE.md et cette documentation technique
.nojekyll                          désactive Jekyll sur GitHub Pages (voir docs/projet/publication.md)
```

`index.html` et `.nojekyll` restent à la racine : GitHub Pages publie la racine de `main`. Les chemins de `app.js` (`assets/images/…`, `assets/data.json`) sont relatifs à `index.html`, pas au script.

## Lancer en local

`fetch("assets/data.json")` ne fonctionne pas en `file://`, il faut un serveur HTTP :

```bash
python3 -m http.server 8000
```

puis http://localhost:8000/.
