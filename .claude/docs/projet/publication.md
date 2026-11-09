# Publication (GitHub Pages)

- Site : https://satisfactory-planif.github.io/
- Dépôt : `satisfactory-planif/satisfactory-planif.github.io`, dans l'organisation GitHub `satisfactory-planif`. Un dépôt nommé `<org>.github.io` est publié à la racine du domaine, sans chemin.
- Réglage : Settings → Pages → *Deploy from a branch* → `main` / `(root)`, activé automatiquement pour ce dépôt. Le fichier `.nojekyll` évite le passage par Jekyll.
- **Chaque push sur `main` met le site en ligne** (construction d'environ 20 s). Vérifier l'état avec `gh api repos/satisfactory-planif/satisfactory-planif.github.io/pages/builds/latest`.
- Renommer l'organisation ou le dépôt change l'adresse et casse les liens de partage déjà diffusés.
- Limites : gratuit pour un dépôt public ; site ≤ 1 Go ; limite indicative de 100 Go de bande passante par mois ; usage non commercial.
- Le dépôt est public : tout ce qui est commité (y compris `.claude/`) est visible, et servi par le site. Ne rien y mettre de privé.
