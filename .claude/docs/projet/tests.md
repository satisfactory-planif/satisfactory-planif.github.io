# Tests

```bash
npm install
npx playwright install chromium
npm test
```

`tests/smoke.js` lance un serveur local et vérifie, sans erreur dans la console, des valeurs calculées à la main depuis `assets/data.json` :

| Cas | Attendu |
|---|---|
| Cadre modulaire lourd 2/min, recettes standard | 480 minerai de fer, 180 charbon, 180 calcaire /min |
| Idem avec Lingot de fer pur (7 minerai + 4 eau → 13 lingots) | 300 lingots → 161,54 + 180 (acier) = 341,54 minerai, 92,31 m³ d'eau |
| Lingot d'aluminium 60/min | 60 m³ d'eau nette (après recyclage) |
| Train, 1 400 minerai/min, aller-retour 4 min + arrêts | wagon 3 200 ÷ 4,9 min = 653,06/min → 3 wagons |
| Lien `#usine:ModularFrameHeavy*2;IronIngot=Alternate_PureIronIngot` | 341,54 minerai ; « Partager » redonne le même lien ; une usine existante n'est remplacée qu'après confirmation |
| Les trois vues à 390 px | aucun défilement horizontal |
| Toutes les pages testées | aucune ressource en erreur HTTP (404…) ni échec réseau |
| Icônes référencées par `data.json` (`ico`) et `machines` | fichier présent dans `assets/images/` |

Tout nouveau calcul ajoute un cas ici et dans `tests/smoke.js`, avec le détail du calcul à la main.
