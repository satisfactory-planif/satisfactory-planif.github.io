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
| Idem avec tapis Mk.3 vers les quais | 2 × 270 = 540/min par quai → 3 quais ; 1 400 ÷ 3 = 466,67/min par quai → 2 tapis Mk.3 ; seul le repère « conteneur industriel » s'affiche |
| Lien `#usine:ModularFrameHeavy*2;IronIngot=Alternate_PureIronIngot` | 341,54 minerai ; « Partager » redonne le même lien ; une usine existante n'est remplacée qu'après confirmation |
| Arbres de Cadre modulaire lourd 2/min (onglet Arbres et détail d'une étape) | seul le premier niveau est déplié ; un clic ne change que le nœud cliqué, y compris après le dépliage d'une autre étape (re-rendu des résultats) |
| Lingot d'aluminium 150/min, détail de l'étape Solution d'alumine | 225 rebuts → 150 solution d'alumine → 150 × 50/120 = 62,5 silice réutilisée : « Destination : 150 m³/min pour Rebuts d'aluminium » et « Surplus réutilisé : Silice +62,5/min pour Lingot d'aluminium » ; la ligne Silice affiche 125/min (187,5 − 62,5), sans « récupérés » |
| Arbre de Lingot d'aluminium 150/min à 390 px, Rebuts d'aluminium déplié | aucune ligne longue ne laisse le triangle seul sur sa ligne ; l'icône de machine reste sur la ligne de son nombre ; les entrées des Rebuts (Solution d'alumine, dépliable, et Charbon, brut) ont leurs icônes alignées |
| Fiche Eau, pour 1 m³ | groupes « Autres recettes · 1 » et « Obtenu en sous-produit · 7 », fermés, sans Alt. dans leur titre ; Alt. sur les 4 recettes alternatives ; une section dépliée reste ouverte après un passage par Mon usine, se referme après la fiche Rebuts d'aluminium ; Rebuts d'aluminium (240 solution + 120 charbon → 360 rebuts + 120 eau) : 2 solution d'alumine + 1 charbon par m³, soit 2 bauxite + 3 m³ d'eau + 1 charbon (plus de valeurs qui explosent) |
| Les trois vues à 390 px | aucun défilement horizontal |
| Toutes les pages testées | aucune ressource en erreur HTTP (404…) ni échec réseau |
| Icônes référencées par `data.json` (`ico`) et `machines` | fichier présent dans `assets/images/` |

Tout nouveau calcul ajoute un cas ici et dans `tests/smoke.js`, avec le détail du calcul à la main.
