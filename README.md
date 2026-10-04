# Sentinelle

Moteur de triage causal de réclamations bancaires pour la zone CEMAC. Un ticket de
réclamation (texte libre, français informel, mobile money) entre dans le système, une IA
le classe selon une taxonomie causale, détecte les patterns d'incidents émergents, et
génère un rapport de conformité aligné sur le règlement **COBAC R-2020/06** (traitement
des réclamations des consommateurs de produits et services bancaires et financiers).

Base technique : fork de [`Banking---DataPipe-ETL`](https://github.com/GAUSS-TPAC/Banking---DataPipe-ETL)
(React 19 + TS + Vite + Tailwind, Express) — module de routage IA multi-provider conservé
et étendu, éditeur de nœuds / wizard / exécution Python retirés.

## Statut

Fonctionnel de bout en bout : import de fichiers, classification IA, détection de patterns,
rapport de conformité, persistance Supabase et comptes multi-établissements.

| Brique | État |
|---|---|
| Import CSV / Excel (.xlsx) / JSON avec correspondance de colonnes | fait |
| Classification causale par IA (Gemini, ou Ollama auto-hébergé) | fait |
| Regroupement par catégorie en onglets | fait |
| Détection de patterns + rapport COBAC R-2020/06 | fait |
| Persistance Supabase (`tickets`, `patterns_detectes`) | fait |
| Comptes, OAuth, organisations, invitations | code fait — [configuration à faire](AUTH.md) |
| Déploiement public | [étapes dans DEPLOY.md](DEPLOY.md) |

L'application démarre en **mode démo sans comptes** tant que `SUPABASE_ANON_KEY` n'est pas
renseignée : plan de travail direct, données en mémoire. Renseigner cette clé active l'écran
de connexion et le cloisonnement par organisation — voir [AUTH.md](AUTH.md).

## Import de réclamations

Le bouton « Importer un fichier » accepte le CSV (séparateur détecté automatiquement, donc
les exports Excel francophones en point-virgule passent), le `.xlsx` (multi-feuilles) et le
JSON. Comme aucun export de banque ne nomme ses colonnes `texte_brut`, une étape de
correspondance montre les colonnes détectées, devine l'association à partir des en-têtes
(français, anglais, jargon bancaire) et laisse corriger avant import. Le fichier est lu dans
le navigateur : il n'est jamais téléversé.

Le `.xls` d'Excel 97-2003 n'est pas pris en charge — le message d'erreur invite à
réenregistrer en `.xlsx`.

## Identité visuelle

Marque : double S anguleux incliné à 30°, rendu par `src/components/SentinelleLogo.tsx`.
Le composant trace en `currentColor`, donc il prend la couleur du texte parent et suit
n'importe quel thème sans variante de fichier. Le favicon (`public/favicon.svg`) reprend la
même géométrie et bascule de teinte selon `prefers-color-scheme`, pour rester lisible sur un
onglet clair comme sombre.

Palette « Institutional Slate », variante claire : fond papier, cartes blanches, encre
ardoise. Les valeurs ne sont pas choisies à l'œil — chaque paire texte/fond a été vérifiée au
ratio de contraste WCAG, plancher à 5,08 (les en-têtes de table, en 11 px, sont le cas le
plus serré). Les dix teintes de tags causals sont à 7,53 minimum. Tout est piloté par les
tokens de `src/index.css` : changer de thème, c'est réécrire ces valeurs, pas les composants.

## Deux modes IA, même code métier

| Mode | Provider | Cas d'usage |
|---|---|---|
| Cloud | Gemini (`AI_PROVIDER=gemini` ou `auto`) | Démo rapide, petites structures |
| Auto-hébergé | Ollama + Gemma (`AI_PROVIDER=selfhosted`) | Banques refusant la sortie des données de réclamation |

## Choix du modèle et comparaison

L'en-tête expose un sélecteur de modèle à l'intérieur du mode retenu. La liste n'est pas
codée en dur : `GET /api/models` interroge Ollama à chaud, donc installer un modèle avec
`ollama pull` le fait apparaître sans redémarrer Sentinelle. Chaque entrée indique où les
données circulent (`cloud` / `local`), la taille du modèle, et un avertissement quand celui-ci
est plus gros que la mémoire disponible — auquel cas le noyau tue Ollama en cours de lot et
tout le portefeuille retombe sur le classement par mots-clés.

Côté Gemini, seules les familles `flash` et `flash-lite` sont acceptées, et tout modèle `pro`
est refusé côté serveur : le quota gratuit d'un `pro` est nul et son usage exige un compte de
facturation. Le garde-fou est dans le serveur, pas dans l'interface, pour qu'un appel forgé ne
puisse pas le contourner.

Le bouton « Comparer les modèles » mesure plusieurs modèles sur **le même échantillon** de
réclamations déjà étiquetées (colonne « Catégorie déjà connue » de l'import, sans laquelle il
n'y a pas d'exactitude à mesurer). Le banc ne persiste rien et ne touche pas au portefeuille
affiché : c'est une mesure, pas un classement de production.

Deux colonnes du tableau méritent une lecture attentive :

- **Exactitude** — un repli heuristique compte comme une erreur. Le modèle n'a pas répondu ;
  le créditer d'une bonne réponse trouvée par mots-clés reviendrait à récompenser une panne.
- **Écart de calibration** — confiance auto-déclarée moins exactitude observée. Positif, le
  modèle se surestime, et sa confiance ne peut alors pas servir à décider quels dossiers faire
  relire par un humain.

### Mesures sur un i7-4600U sans GPU, 4 Go de RAM libre

Sur `data/reclamations-2026.csv`, échantillon de 10 réclamations étalé sur tout le fichier :

| Modèle | Exactitude | Replis | Latence méd. | 600 réclamations | Confiance | Écart calib. |
|---|---|---|---|---|---|---|
| `gemini-3.5-flash-lite` | 6/10 = 60 % | 0 | 1,6 s | ~60 min (quota) | 0,96 | **+36 pts** |
| `gemma3:1b` | 2/10 = 20 % | 2 | 36 s | ~6 h | 0,89 | **+64 pts** |
| `llama3:latest` (8 B) | non mesurable | — | — | — | — | — |

Quatre lectures, qui comptent plus que les chiffres eux-mêmes.

**`llama3:latest` ne tourne pas sur cette machine.** 4,7 Go de poids pour 4,1 Go de RAM
disponible : après 205 s, le noyau a tué le serveur Ollama, et tous les appels suivants ont été
refusés. D'où l'avertissement de taille dans `GET /api/models` — un modèle trop gros ne ralentit
pas le lot, il l'interrompt, et tout le portefeuille retombe sur les mots-clés.

**L'échantillonnage décide du résultat.** Sur les dix premières lignes du fichier, triées par
date, `gemini-3.5-flash-lite` obtient 100 % et `gemma3:1b` 75 %. Sur un échantillon étalé, ils
tombent à 60 % et 20 %. L'explication est dans les données : les premières lignes sont des
dépassements de délai dont le texte dit lui-même « 45 jours » ou « aucune réponse » — les cas
évidents. Le banc tire pour cette raison des indices régulièrement espacés, jamais les n
premières lignes.

**Les deux modèles se surestiment largement.** C'est le résultat le plus utile du banc :
`gemini-3.5-flash-lite` se déclare sûr à 96 % en se trompant quatre fois sur dix, soit 36 points
d'écart ; `gemma3:1b` atteint 64 points. Conséquence directe : **la confiance renvoyée par le
modèle ne peut pas servir à décider quels dossiers faire relire par un humain.** Trier par
confiance croissante ne ferait pas remonter les erreurs. Un tri utile doit s'appuyer sur autre
chose — l'enjeu réglementaire du dossier, son ancienneté, ou un désaccord entre deux modèles.

**La durée d'un lot Gemini vient du quota, pas de la vitesse.** À 1,6 s par appel, 600
réclamations prendraient 16 minutes ; le limiteur du serveur (`GEMINI_RPM`, défaut 10) impose
une heure. Le tableau marque ces estimations « quota » pour qu'on ne cherche pas à les améliorer
en changeant de modèle.

Une réserve sur la référence : elle vient du générateur du jeu de test, et certaines catégories
se chevauchent réellement (un retrait refusé par un agent peut relever de « Litige agent » comme
de « Transaction échouée »). Une partie des écarts comptés comme erreurs est donc discutable.
L'exactitude mesurée est un plancher, pas un verdict — et c'est une raison de plus pour que le
banc affiche le détail plutôt qu'une note globale.

## Quick start

```bash
npm install
cp .env.example .env   # renseigner au moins une clé, ou AI_PROVIDER=selfhosted + ollama serve
npm run dev
```

| Service | URL |
|---|---|
| App (Vite) | http://localhost:5173 |
| API (Express) | http://localhost:3001 |

```bash
curl http://localhost:3001/api/health
```
