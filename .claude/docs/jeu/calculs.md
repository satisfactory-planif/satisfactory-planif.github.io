# Calculs

## Mon usine (`plan(targets)`)

- Point fixe itératif : la demande de chaque pièce génère des machines, dont les sorties secondaires sont déduites de la demande des autres (`supply`, `supplyBy`), jusqu'à stabilisation (`converged`). Si les recettes choisies forment une boucle qui ne converge pas, la page l'indique.
- Résultat : `demand`, `supply`, `mach`, `raw`, `recovered`, `surplus`, `nMach`, `mw`, `flows` (consommateur → quantité), `supplyBy`.
- Machines : « 1 machine à X % » ou « N machines, dont 1 à X % » (pas d'overclocking ni de Somersloop dans le calcul).
- Étapes : la ligne d'une pièce affiche ce qui est fabriqué (sans la part récupérée) et son surplus. Le détail d'une étape liste sa « Destination » (« 225/min pour Lingot d'aluminium » : quantité d'abord, puis la pièce qu'elle alimente), puis ses sous-produits répartis au prorata (`byprodOf`) en « Surplus réutilisé » (part de `recovered`, consommée ailleurs dans la chaîne, suivie de ses consommateurs : `usedFor`, au prorata de `flows`) et « Surplus à évacuer » (part de `surplus`).
- Arbres : nets des sous-produits (`netSplit`) : « dont X récupérés, sous-produit de … », le reste à fabriquer ou amener.

## Extraction des ressources brutes (`extractionOf`, `extractionTotals`)

- Chaque ressource brute de « Ressources à amener » reçoit un extracteur (`data.json` → `extractors`) : foreuses Mk.1 à Mk.3 pour les solides, Puit de pétrole, Pompe à eau, Extracteur de puits de ressources pour l'azote (seul extracteur possible).
- Débit d'un extracteur = débit à 100 % sur gisement normal × pureté (impur 0,5, normal 1, pur 2). La Pompe à eau n'a pas de pureté (120 m³/min).
- Extracteur par défaut : la plus petite foreuse qui couvre seule le besoin sur le gisement choisi (normal par défaut) ; au-delà, plusieurs Mk.3. Exemple : 90/min → 1 Mk.2, 262,5/min → 2 Mk.3. Un choix égal au défaut n'est pas gardé : le défaut suit le besoin.
- Nombre = besoin ÷ débit, arrondi au supérieur. MW = besoin ÷ débit × puissance (« à 100 % », comme les machines : une fraction d'extracteur compte pour sa fraction).
- Azote : extracteurs sans consommation, plus 1 Pressuriseur de puits de ressources (150 MW), compté pour un seul puits.
- Tuiles : « N machines au total, dont X extracteurs » (pressuriseur compris) et « MW à 100 %, dont Y MW d'extraction ».
- Choix par ressource (extracteur, pureté) : bouton sous la carte de la ressource, fenêtre `#xmenu`, clé `sp-extract`, partagé dans le lien.

## Fiche pièce (`rawLine`)

- « Ressources brutes au total » d'une recette : seule la machine de la carte utilise cette recette. Ses entrées sont planifiées avec les recettes standard (`plan(entrées, given)`), et ses autres sorties sont déduites de leurs besoins (`given`). La pièce elle-même, si la chaîne la consomme plus bas, vient donc de sa recette standard ou du gisement. Sans cette règle, une recette qui donne la pièce en sous-produit bouclait (eau des Rebuts d'aluminium : la solution d'alumine consomme plus d'eau que la recette n'en rend).
- Les recettes sont réparties en « Autres recettes » (la pièce est la sortie principale) et « Obtenu en sous-produit » (recettes d'autres pièces qui la donnent aussi). Les deux sections sont fermées par défaut (`othersOpen`) : une section dépliée le reste en passant par Mon usine ou Transport et au changement de mode de quantités, et se referme à l'ouverture d'une autre fiche ; l'étiquette Alt. est sur chaque recette alternative, pas sur le titre de section.

## Transport

- Wagon : 32 emplacements × taille de pile ; wagon fluide 1 600 m³ (sources : [donnees.md](donnees.md)).
- Aller-retour effectif = temps saisi + 54 s si « arrêts » est coché (27 s chargement + 27 s déchargement).
- Débit d'alimentation d'un quai = 2 × tapis choisi (fluides : 2 × 600 m³/min).
- Wagons = max(ceil(débit / débit par wagon), ceil(débit / alimentation des quais)).
- Au-delà de `maxW` wagons (8 par défaut) : plusieurs trains identiques partageant les gares, ou locomotives supplémentaires (1 par 8 wagons) selon l'option.
- Trains mixtes : une composition par train.
- Débit par quai = débit de la ressource ÷ ses quais (les trains identiques se partagent les mêmes quais) ; tapis par quai = ce débit ÷ un tapis du niveau choisi, arrondi au-dessus (2 au plus par construction).
- Drones : 9 piles par trajet, batteries/min = drones × batteries par aller-retour / durée ; fluides impossibles.
- Héliports : 1 par drone au départ + 1 d'arrivée par ressource.
- Affichage : « Comparaison » (une case par transport, détail du calcul en infobulle), puis « À construire » (un bloc par ressource ou par train mixte, avec la ligne de calcul visible pour le tactile), un total en cartes (trains, gares et quais, tapis, drones, MW) et des « Repères » numérotés, affichés seulement quand l'élément concerné est présent (train mixte, plusieurs trains ou locomotives, quais, héliports).
- Tapis : niveaux 60 / 120 / 270 / 480 / 780 / 1 200 ; tuyaux 300 / 600 m³/min.

## Limites connues

- Pas d'overclocking ni de Somersloop dans Mon usine.
- Extraction : une seule pureté par ressource ; pas de puits de ressources pour l'eau et le pétrole ; un seul puits (un pressuriseur) compté pour l'azote, le nombre de nœuds satellites variant d'un puits à l'autre.
- Puissance moyenne seulement pour les machines à puissance variable.
- Capacités wagon et drone reprises du wiki, non relues dans les fichiers du jeu.
- Pas de comparaison de coût de construction entre tapis, trains et drones.
