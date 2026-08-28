# Racine

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

## Deux modes IA, même code métier

| Mode | Provider | Cas d'usage |
|---|---|---|
| Cloud | Gemini (`AI_PROVIDER=gemini` ou `auto`) | Démo rapide, petites structures |
| Auto-hébergé | Ollama + Gemma (`AI_PROVIDER=selfhosted`) | Banques refusant la sortie des données de réclamation |

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
