# Structure du dépôt

```
index.html               structure de la page (en-tête, catalogue, zone principale)
style.css                tous les styles, variables de thème comprises
app.js                   toute la logique (IIFE, script classique, sans module)
data.json                données du jeu, générées par scripts/build_data.py
icons/<Item>.png         168 icônes d'objets (64 px), nom = classe de l'objet (Desc_IronPlate_C.png)
machines/<Build>.png     11 icônes de machines (Build_ConstructorMk1_C.png…)
scripts/build_data.py    régénère data.json depuis les fichiers du jeu
scripts/categories.json  catégorie de chaque objet + ordre des catégories du catalogue
tests/smoke.js           test Playwright (valeurs connues)
game-docs/               fichiers du jeu en-US.json / fr.json (NON versionnés, voir .gitignore)
.claude/                 CLAUDE.md et cette documentation technique
```

## Lancer en local

`fetch("data.json")` ne fonctionne pas en `file://`, il faut un serveur HTTP :

```bash
python3 -m http.server 8000
```

puis http://localhost:8000/.
