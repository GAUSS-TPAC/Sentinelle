# Déploiement — mode Cloud (démo publique)

Un seul service : Express sert l'API **et** le build Vite (`dist/`) sur le même port
([`server/index.ts`](server/index.ts) — bloc `DIST_DIR`). Le port fourni par l'hébergeur est
déjà respecté via `process.env.PORT`.

Le mode auto-hébergé (Ollama) n'est **pas** déployé : il reste une démo locale. C'est
l'argument de souveraineté — le client final héberge Ollama chez lui, pas sur Railway.

> ⚠️ Aucune clé réelle dans ce fichier : il est versionné. Les secrets vivent dans `.env`
> en local (ignoré par git) et dans les variables d'environnement de l'hébergeur.

---

## Phase A — Préparer le dépôt

### A1. Committer et pousser

Railway ne déploie que ce qui est sur GitHub.

```bash
git status          # vérifier qu'aucun .env / .env.bak n'apparaît
git add -A
git commit -m "feat: auth Supabase, organisations et onboarding"
git push origin master
```

`.gitignore` couvre `.env` et `.env.*` (avec une exception pour `.env.example`). Si tu ajoutes
un fichier de secrets sous un autre nom, ajoute-le avant de faire `git add -A`.

### A2. `tsx` au démarrage — piège classique

`npm start` lance `tsx server/index.ts`, or `tsx` et `typescript` sont dans
`devDependencies`. Si l'hébergeur élague les devDependencies après le build (fréquent quand
`NODE_ENV=production` est posé à l'installation), le service démarre sur `tsx: not found`.

Deux parades :

- poser `NPM_CONFIG_PRODUCTION=false` dans les variables de l'hébergeur, ou
- déplacer la dépendance : `npm i tsx --save-prod` (plus robuste, recommandé).

### A3. Vérifier le build localement

```bash
npm run build
```

C'est exactement la commande que lancera l'hébergeur (`tsc --noEmit` puis `vite build`).
Un échec ici est un échec de déploiement garanti.

---

## Phase B — Supabase

### B1. Exécuter les migrations, dans l'ordre

Supabase → **SQL Editor** → **New query** → coller → **Run**, une par une :

1. `supabase/schema.sql`
2. `supabase/002_organisations.sql`
3. `supabase/003_creation_organisation.sql`

⚠️ `002_organisations.sql` **supprime les lignes sans organisation** de `tickets` et
`patterns_detectes` — voir [AUTH.md](AUTH.md#1-exécuter-la-migration). Sans conséquence sur
une base vide ; sinon, crée d'abord ton organisation et affecte son `id` aux lignes
existantes.

### B2. Récupérer les clés

Supabase → **Settings** → **API** :

| Clé | Destination |
|---|---|
| `service_role` | serveur uniquement, ne quitte jamais l'hébergeur |
| `anon` / `publishable` | serveur **et** navigateur (publique par conception) |

La clé anon est publique : ce sont les politiques RLS de l'étape B1 qui protègent les
données, pas le secret de cette clé.

### B3. OAuth Google

Procédure détaillée dans [AUTH.md](AUTH.md#4-google-oauth). Les deux points qui bloquent le
plus souvent :

- l'écran de consentement doit être **publié** (*Publish app*), sinon seuls les comptes de
  test peuvent se connecter ;
- l'URI de redirection autorisée doit être exactement celle du projet Supabase :
  `https://<ref-projet>.supabase.co/auth/v1/callback`.

Microsoft / Azure est optionnel — [AUTH.md](AUTH.md#5-microsoft-azure-oauth).

### B4. Confirmation d'e-mail

Authentication → Providers → Email → **cocher** *Confirm email* avant toute mise en
production. Sans elle, n'importe qui peut créer un compte avec l'adresse d'un tiers et
capter une invitation nominative ([AUTH.md](AUTH.md#6-confirmation-de-mail)).

---

## Phase C — Railway

### C1. Créer le service

1. [railway.app](https://railway.app), connexion via GitHub.
2. **New Project → Deploy from GitHub repo** → `GAUSS-TPAC/Sentinelle`.
3. Rien à configurer : Railway détecte Node et utilise les scripts de `package.json` —
   `npm run build` parce qu'un script `build` existe, puis `npm start`. Les noms tombent
   juste, il n'y a pas de commande à saisir à la main.

⚠️ Ce premier déploiement **réussira** et le service passera à *Online*, même sans aucune
variable : le build n'en a besoin d'aucune, et le serveur démarre avec `supabase` à `null`.
« Online » ne signifie donc pas « configuré » — c'est exactement le mode de panne silencieux
décrit en C2. Le seul verdict fiable est `/api/health` (phase D).

### C2. Variables d'environnement — **avant le build qui compte**

| Variable | Valeur |
|---|---|
| `GEMINI_API_KEY` | clé Gemini réelle |
| `AI_PROVIDER` | `gemini` |
| `SUPABASE_URL` | `https://<ref-projet>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | clé `service_role` |
| `SUPABASE_ANON_KEY` | clé `anon` |
| `VITE_SUPABASE_URL` | identique à `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | identique à `SUPABASE_ANON_KEY` |
| `GEMINI_RPM` | `10` — facultatif, voir ci-dessous |
| `NPM_CONFIG_PRODUCTION` | `false` — sauf si `tsx` a été déplacé en dépendance de production (A2) |

⚠️ **Ne jamais poser `API_PORT` ni `PORT`.** Railway injecte `PORT` lui-même, et le serveur
le lit déjà en repli. Le piège vient de la ligne de résolution :

```js
const PORT = Number(process.env.API_PORT ?? process.env.PORT) || 3001;
```

`API_PORT` est **prioritaire**. Copier son `.env` local en bloc dans le Raw Editor y importe
`API_PORT=3001` : le serveur écoute alors sur 3001 pendant que Railway route vers 8080, et
tout répond `502 Application failed to respond`. Symptôme trompeur — le service passe
*Online*, les logs de démarrage sont normaux, seul le port de la ligne
`Sentinelle API server on http://localhost:XXXX` trahit le problème. Ne copier que les sept
variables du tableau ci-dessus.

Inutile également de poser `SELF_HOSTED_BASE_URL` / `SELF_HOSTED_MODEL` : elles ont des
valeurs par défaut dans le code et ne désignent rien d'exploitable en cloud.

**Les deux variables `VITE_` ne sont pas optionnelles.** Vite les fige dans le bundle au
moment du `npm run build` : les ajouter après coup ne change rien tant qu'un nouveau
déploiement n'est pas déclenché.

**Le mode de panne à connaître.** Définir `SUPABASE_ANON_KEY` (serveur) **sans**
`VITE_SUPABASE_ANON_KEY` (navigateur) donne le pire des deux mondes : le serveur exige un
jeton et répond `401` sur toutes les routes de données, pendant que le navigateur, faute de
client Supabase, n'affiche aucun écran de connexion et n'envoie donc jamais de jeton.
L'application se charge et tout échoue, sans message explicite.

**Tenir le palier gratuit de Gemini.** Le plafond est d'environ 15 requêtes/minute sur les
modèles `flash-lite`. Le serveur applique son propre limiteur, global au processus
(`GEMINI_RPM`, défaut `10`), et absorbe les 429 restants en attendant le délai que Google
réclame dans `retryDelay` — mesuré à 57–59 s. Laisser la valeur par défaut convient ; la
baisser à `5` si des 429 persistent. L'augmenter n'accélère rien : le quota est côté Google.

Pourquoi `AI_PROVIDER=gemini` plutôt que `auto` : en `auto`, l'ordre d'essai est
`openai → gemini → anthropic`, et une clé présente mais invalide consomme quand même son
tour (~15 s par ticket) avant de basculer.

### C3. Déployer

Railway produit une URL `https://<projet>.up.railway.app`.

### C4. Autoriser l'URL de retour côté Supabase

Authentication → **URL Configuration** :

| Champ | Valeur |
|---|---|
| **Site URL** | `https://<projet>.up.railway.app` |
| **Redirect URLs** | `https://<projet>.up.railway.app/**` **et** `http://localhost:5173/**` |

Sans cette étape, la connexion Google aboutit puis renvoie vers `localhost`.

---

## Phase D — Vérifier

```bash
curl https://<projet>.up.railway.app/api/health
```

Attendu : `"hasGeminiKey": true`, `"hasSupabase": true`, `"provider": "gemini"`.

```bash
curl -i https://<projet>.up.railway.app/api/tickets
```

Attendu : **`401`**. Un `200` signifierait que `SUPABASE_ANON_KEY` manque côté serveur — les
données seraient lisibles sans compte.

Puis dans le navigateur : écran de connexion → Google → onboarding (créer l'organisation) →
import CSV → classification.

**Contrôler que l'IA répond vraiment.** Dans la réponse de `/api/classify-ticket`, le champ
`source` doit valoir `ai`. S'il vaut `fallback`, aucun modèle n'a répondu et le classement
s'est fait par mots-clés : le résultat s'affiche quand même — HTTP 200, catégorie plausible —
il est simplement mauvais. Le champ `error` de la même réponse donne la cause.

L'interface affiche désormais ce décompte en fin de lot (« N réclamations sur M n'ont pas été
classées par l'IA »). Un rapport COBAC bâti sur du repli heuristique est le vrai risque ici :
ne pas générer le rapport tant que ce bandeau est rouge.

---

## Alternative : Render

Identique dans les grandes lignes :

1. Compte sur [render.com](https://render.com) via GitHub.
2. **New → Web Service** → repo `GAUSS-TPAC/Sentinelle`.
3. Build command `npm run build` · Start command `npm run start`.
4. Mêmes variables qu'en C2, onglet **Environment**.
5. `PORT` est assigné automatiquement, même compatibilité.

---

## Limites connues du déploiement cloud

**Le sélecteur « Auto-hébergé · Ollama »** reste visible dans l'interface déployée mais est
inopérant : côté serveur, `SELF_HOSTED_BASE_URL` pointe sur `localhost:11434`, où il n'y a
rien. Chaque clic coûte 90 s d'attente (le délai d'expiration selfhosted) avant de retomber
sur le classement heuristique. À masquer quand `AI_PROVIDER !== 'selfhosted'`, ou à ne pas
toucher pendant les démos publiques.

**Les identifiants de modèles Gemini** sont épinglés en dur dans `server/index.ts`
(`GEMINI_MODELS`). Si l'un d'eux n'existe plus, l'API renvoie `404`, que le code traite comme
réessayable : la chaîne s'épuise et l'application retombe silencieusement sur l'heuristique.
Le contrôle de la phase D (`"provider": "gemini"`) est le moyen de le détecter. La variable
`GEMINI_MODEL` permet de forcer un modèle unique sans toucher au code.

---

## Ce qui ne peut pas être automatisé

- Créer les comptes Railway/Render et Google Cloud (authentification tierce).
- Fournir les clés réelles.
- Relier un domaine personnalisé (étape DNS, optionnelle).
