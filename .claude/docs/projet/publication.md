# Publication (GitHub Pages)

- Site : https://faimer-org.github.io/satisfactory-planif/
- Dépôt : `faimer-org/satisfactory-planif`, dans l'organisation GitHub `faimer-org`. C'est un site de projet : publié sous le chemin `/<dépôt>/` du domaine de l'organisation. Chaque dépôt de l'organisation peut avoir le sien ; seul un dépôt nommé `faimer-org.github.io` serait publié à la racine (aucun pour l'instant).
- Le code n'utilise que des chemins relatifs (`assets/…`) et le lien de partage reprend `location.href` : il fonctionne sous un sous-chemin sans réglage.
- Réglage : Settings → Pages → *Deploy from a branch* → `main` / `(root)`.
- `.nojekyll` (vide, à la racine) : sans lui, Pages passe le dépôt dans le générateur Jekyll, qui exclut les fichiers et dossiers commençant par `_` ou `.` et transforme les `.md` en pages HTML. Avec lui, les fichiers sont servis tels quels et la construction est plus rapide. Conséquence : `.claude/` et `README.md` sont aussi servis bruts par le site (sans gravité, le dépôt est public).
- **Chaque push sur `main` met le site en ligne** (construction d'environ 20 s). Vérifier l'état avec `gh api repos/faimer-org/satisfactory-planif/pages/builds/latest`.
- Origine partagée : tous les sites de projet de l'organisation sont servis depuis `faimer-org.github.io` et partagent le même `localStorage`. Chaque projet utilise son propre préfixe de clé (ici `sp-`) et rien de sensible n'y est stocké.
- Renommer l'organisation ou le dépôt change l'adresse (GitHub ne redirige pas les URL Pages) et casse les liens de partage déjà diffusés ; les données `localStorage` restent attachées à l'ancienne origine. Historique : publié à `https://satisfactory-planif.github.io/` jusqu'au passage à `faimer-org` (novembre 2026), sans redirection.
- Limites : gratuit pour un dépôt public ; site ≤ 1 Go ; limite indicative de 100 Go de bande passante par mois ; usage non commercial.
- Le dépôt est public : tout ce qui est commité (y compris `.claude/`) est visible, et servi par le site. Ne rien y mettre de privé.
