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

Base mécanique en place (étape 2.1/2.2 du plan) : structure du projet, dépendances
allégées, moteur de routage IA (`server/index.ts`) étendu avec un provider `selfhosted`
(Ollama, API compatible OpenAI). L'interface (liste de tickets, bandeau de patterns,
génération de rapport) et les routes `/api/classify-ticket`, `/api/patterns`,
`/api/generate-report` restent à construire une fois le schéma Supabase exécuté.

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
