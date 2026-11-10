# Calculs

## Mon usine (`plan(targets)`)

- Point fixe itératif : la demande de chaque pièce génère des machines, dont les sorties secondaires sont déduites de la demande des autres (`supply`, `supplyBy`), jusqu'à stabilisation (`converged`). Si les recettes choisies forment une boucle qui ne converge pas, la page l'indique.
- Résultat : `demand`, `supply`, `mach`, `raw`, `recovered`, `surplus`, `nMach`, `mw`, `flows` (consommateur → quantité), `supplyBy`.
- Machines : « 1 machine à X % » ou « N machines, dont 1 à X % » (pas d'overclocking ni de Somersloop dans le calcul).
- Étapes : la ligne d'une pièce affiche ce qui est fabriqué (sans la part récupérée) et son surplus. Le détail d'une étape liste sa « Destination » (« 225/min pour Lingot d'aluminium » : quantité d'abord, puis la pièce qu'elle alimente), puis ses sous-produits répartis au prorata (`byprodOf`) en « Surplus réutilisé » (part de `recovered`, consommée ailleurs dans la chaîne, suivie de ses consommateurs : `usedFor`, au prorata de `flows`) et « Surplus à évacuer » (part de `surplus`).
- Arbres : nets des sous-produits (`netSplit`) : « dont X récupérés, sous-produit de … », le reste à fabriquer ou amener.

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

- Pas d'overclocking, de Somersloop ni de calcul de foreuses/extracteurs dans Mon usine.
- Puissance moyenne seulement pour les machines à puissance variable.
- Capacités wagon et drone reprises du wiki, non relues dans les fichiers du jeu.
- Pas de comparaison de coût de construction entre tapis, trains et drones.
