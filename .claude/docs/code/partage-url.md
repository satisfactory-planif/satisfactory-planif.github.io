# Lien de partage d'une usine

`#usine:ModularFrameHeavy*2,AluminumIngot*60;IronIngot=Alternate_PureIronIngot,Water=`

- Avant `;` : les objectifs `pièce*débit` (débit en notation décimale à point, 2 décimales). Après : les recettes choisies `pièce=recette`, une recette vide signifiant « fourni de l'extérieur » (ou « ressource brute » pour une ressource). Seuls les choix qui diffèrent de la recette par défaut sont écrits.
- Les classes du jeu perdent leur préfixe `Desc_` / `Recipe_` et leur suffixe `_C` quand elles les ont ; sinon la classe complète est écrite.
- À l'ouverture, les pièces et recettes inconnues sont ignorées ; si l'usine locale n'est pas vide et diffère, une confirmation est demandée avant de la remplacer. L'adresse redevient ensuite `#usine`. Les réglages de Transport ne sont pas partagés.
- Bouton « Importer » de Mon usine (et « Importer une usine » quand elle est vide) : une modale où coller le lien, avec un bouton « Coller » si le presse-papiers est lisible (contexte sécurisé). Le lien est contrôlé à la saisie et de nouveau sur « Importer » (`shareFromText`) : il doit contenir `#usine:` (ou commencer par `usine:`) et au moins une pièce reconnue ; l'adresse du site n'est pas vérifiée. Ensuite, mêmes contrôles qu'un lien ouvert dans la barre d'adresse (`applyShared`) : confirmation si l'usine locale n'est pas vide et diffère, message si elle est identique.
- Code : `shareCode`, `parseShare`, `shareFactory`, `openShared`, `applyShared`, `importFactory` dans `app.js`.
- **Format public** : le modifier casse les liens déjà diffusés. Pour le faire évoluer, garder la lecture de l'ancien format.
