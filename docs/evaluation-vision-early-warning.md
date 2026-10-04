# Évaluation — vision « détection précoce » de Sentinelle

**Date :** 2026-10-02 · **Révision évaluée :** `d4e1de9` (identique à `origin/master` = `d4e1de98`)
**Nature du document :** évaluation sur lecture du code. Aucun fichier de l'application n'a été modifié.

---

## 0. Trois constats qui changent l'ordre des priorités

Avant le détail, trois choses que la lecture du code impose de dire d'emblée.

**1. L'application n'est plus déployée du tout.** Le diagnostic demandé au chantier 1 (« le déclencheur Railway ne répond plus ») ne correspond plus à l'état réel. Ce n'est pas un problème de webhook : il n'y a plus d'application à cette adresse. Détail en [§3.1](#31-chantier-1--déploiement).

**2. L'horloge de risque n'est pas calculable de façon fiable sur le schéma actuel.** Il manque la date de clôture et la date de réponse finale, et `delai_reponse_jours` porte **deux sémantiques différentes selon le statut**, tout en étant figé à la date de génération du jeu de test. Détail en [§2](#2-modèle-de-données).

**3. Il n'existe aucune couche de visualisation.** Aucune bibliothèque de graphiques dans `package.json`, aucun composant de graphique dans `src/`. Les chantiers 3, 4 et 5 produisent tous des séries temporelles et des intervalles — c'est-à-dire des objets qui n'ont, aujourd'hui, **nulle part où s'afficher**. C'est une dépendance absente du plan, et elle conditionne la valeur démontrable des trois chantiers statistiques. Détail en [§3.6](#36-la-dépendance-absente-du-plan--la-couche-de-visualisation).

S'y ajoute un point de méthode : **le dépôt ne contient aucun test** (aucun `*.test.*`, `*.spec.*`, ni `vitest.config`/`jest.config`). Les chantiers 2, 3 et 5 sont des chantiers de calcul, où une erreur ne se voit pas à l'écran — elle produit un nombre plausible et faux. C'est le profil de risque exact que des tests unitaires couvrent, et le profil exact où leur absence coûte cher.

---

## 1. État des lieux

### 1.1 Import

Trois formats, lus **dans le navigateur** — le fichier n'est jamais téléversé.

| Format | Fonction | Fichier |
|---|---|---|
| CSV / TXT / TSV | `readCsv` | `src/lib/spreadsheet.ts:29` |
| XLSX multi-feuilles | `readXlsx` | `src/lib/spreadsheet.ts:50` |
| JSON | `loadJSON` | `src/lib/dataLoader.ts:59` |

Le séparateur CSV est détecté par Papa Parse (`delimiter: ''`, `spreadsheet.ts:37`) — les exports Excel francophones en point-virgule passent donc sans réglage. Les cellules Excel typées sont normalisées en chaînes par `cellToString` (`spreadsheet.ts:23`), les `Date` en ISO court, pour que la correspondance de colonnes et l'IA travaillent sur la même matière qu'un CSV.

`inferSchema` (`dataLoader.ts:17`) type les colonnes par vote majoritaire sur les 100 premières lignes. Ce typage sert l'affichage de l'aperçu ; il n'est pas utilisé par la construction des tickets.

### 1.2 Correspondance de colonnes

`guessMapping` (`src/lib/columnMapping.ts:115`) apparie les en-têtes du fichier aux cinq champs cibles de `MAPPING_TARGETS` (`columnMapping.ts:25`) : `texte_brut` (seul obligatoire), `date_creation`, `statut`, `delai_reponse_jours`, `categorie_attendue`.

Deux passes, exacte puis approximative, avec un jeu de synonymes français / anglais / jargon bancaire (`ALIASES`, `columnMapping.ts:69`). Une colonne déjà attribuée n'est pas réutilisée (`taken`, `columnMapping.ts:121`). La correspondance approximative se fait **par mots entiers** via `matchesLoosely` (`columnMapping.ts:100`), la sous-chaîne n'étant tolérée qu'au-delà de 5 caractères — garde-fou introduit parce que l'alias `age` (ancienneté) capturait la colonne `Agence`, présente dans presque tous les exports bancaires, et faisait disparaître le délai COBAC en silence.

`buildTicketsFromRows` (`columnMapping.ts:196`) produit les tickets. Points qui comptent pour la suite :

- `parseDate` (`columnMapping.ts:163`) interprète **jour/mois/année** — `03/07/2026` est le 3 juillet. Correct pour la zone CEMAC.
- `parseDays` (`columnMapping.ts:181`) renvoie `null` et non `0` sur cellule vide (`Number('')` vaut 0, ce qui aurait rendu conforme une réclamation de délai inconnu).
- À défaut de date, **la date du jour est substituée** (`columnMapping.ts:197`, `221`). Conséquence pour le chantier 2 : un fichier sans colonne de date produit un portefeuille entièrement « reçu aujourd'hui », donc une horloge de risque entièrement verte et entièrement fausse.
- `categorie_causale` est initialisé à chaîne vide (`columnMapping.ts:219`) : un ticket importé n'est pas classé.

### 1.3 Classification

Chaîne : `classifyAll` (`src/hooks/useTicketWorkspace.ts:138`) → `POST /api/classify-ticket` (`server/index.ts:433`) → `generateAIText` → `parseClassification` (`src/lib/ticketClassifier.ts:41`).

Le prompt système (`ticketClassifier.ts:14`) impose une sortie JSON et **la copie exacte** d'une des dix catégories de `CAUSAL_TAXONOMY` (`src/lib/taxonomy.ts:9`) ; `parseClassification` rejette toute catégorie hors liste (`ticketClassifier.ts:45`). La confiance est bornée à [0,1] (`ticketClassifier.ts:52`).

Routage multi-provider dans `generateAIText` : Gemini (échelle `flash`/`flash-lite` uniquement, `server/index.ts:32` — les modèles `pro` sont volontairement absents, quota gratuit nul), OpenAI, Anthropic, Ollama auto-hébergé.

Côté fiabilité Gemini, l'état est bon et récent :
- `aiErrorKind` (`server/index.ts:~78`) distingue un modèle *saturé* (attendre) d'un modèle *disparu* (passer au suivant) ;
- `retryAfterMs` (`server/index.ts:95`) respecte le `Retry-After` et le `retryDelay` du corps d'erreur ;
- `acquireGeminiSlot` (`server/index.ts:128`) est un limiteur à fenêtre glissante **global au processus** (`GEMINI_RPM`, défaut 10), sérialisé par chaîne de promesses pour que deux appels concurrents ne lisent pas la même fenêtre ;
- budgets de temps séparés par tentative et globaux.

Le repli heuristique par mots-clés (`heuristicClassify`, `ticketClassifier.ts:58`) renvoie **HTTP 200** avec une catégorie plausible (`server/index.ts:457`), marqué `source: 'fallback'`. Le comptage côté client (`classifyStats`, `useTicketWorkspace.ts:175`) et le bandeau rouge (`src/App.tsx:280`) existent précisément pour que ce repli ne passe plus inaperçu.

**Deux limites à retenir pour les chantiers 4 et 5 :**

1. `classifyAll` **reclasse tout le portefeuille** à chaque appel — aucun filtre sur les tickets déjà classés (`useTicketWorkspace.ts:148`, itération sur `tickets` entier). Ajouter 10 réclamations à un portefeuille de 600 coûte 600 appels, soit une heure sous `GEMINI_RPM=10`.
2. La concurrence client est fixée à 2 (`useTicketWorkspace.ts:154`), le débit réel étant imposé par le limiteur serveur.

### 1.4 Détection de patterns

`detectPatterns` (`src/lib/patternDetection.ts:28`) — purement déterministe, aucun appel IA. Deux règles :

**Pic de volume** (`patternDetection.ts:33-50`) : au moins `VOLUME_THRESHOLD = 4` réclamations d'une même catégorie sur `VOLUME_WINDOW_DAYS = 14` (`patternDetection.ts:5-6`). Sévérité par `severityFromCount` (`patternDetection.ts:13`) : ratio ≥ 2,5 critique, ≥ 1,75 élevée, ≥ 1 moyenne.

**Non-conformité COBAC** (`patternDetection.ts:53-66`) : tout ticket `statut === 'en_retard'` **ou** `delai_reponse_jours > 45` (`COBAC_DEADLINE_DAYS`, `taxonomy.ts:57`) agrégé en un pattern unique.

Deux observations déterminantes pour le chantier 4 :

- **La signature accepte déjà une horloge injectée** : `detectPatterns(tickets, now = new Date())` (`patternDetection.ts:28`). Le Replay n'a donc pas à réécrire la détection — il la rappelle avec un `now` qui avance. C'est le principal cadeau de l'existant.
- **Mais la fenêtre est calculée en valeur absolue** : `daysBetween` renvoie `Math.abs(...)` (`patternDetection.ts:9`), et le filtre est `daysBetween(date_creation, now) <= 14` (`patternDetection.ts:36`). À `now = T`, un ticket créé en `T + 10` est donc compté. Sans conséquence aujourd'hui (pas de tickets futurs), **mais le Replay fuirait l'avenir** : rejoué au 15 juin, il verrait les réclamations du 20 juin et « détecterait » des alertes impossibles. C'est un défaut à corriger avant toute ligne de Replay, et c'est un correctif d'une ligne.

### 1.5 Rapport

`buildComplianceReport` (`src/lib/complianceReport.ts:25`) agrège : répartition par catégorie, `ticketsEnRetard` (même critère que ci-dessus), `tauxConformiteDelai = 1 - enRetard/total`, patterns, et un `avertissement` qui renvoie la validation des citations d'articles à un juriste (`complianceReport.ts:50`). `complianceReportToMarkdown` (`complianceReport.ts:57`) rend le Markdown, servi par `POST /api/generate-report` (`server/index.ts:665`) — route **sans Supabase ni RLS** : elle calcule sur le corps de la requête.

### 1.6 Persistance et cloisonnement

`resolveWorkspace` (`server/index.ts:480`) est le point de passage obligé : jeton porteur → client Supabase sous RLS ; authentification configurée sans jeton → 401 ; pas d'authentification → `service_role` sans organisation (mode démo) ; pas de Supabase → 501 et l'application continue en mémoire.

Deux détails à connaître avant d'ajouter des requêtes :

- L'organisation retenue est **la première** du compte (`.order('created_at').limit(1)`, `server/index.ts:502-507`) : un compte membre de deux banques voit toujours la plus ancienne. Pas de sélecteur d'organisation.
- `POST /api/patterns` (`server/index.ts:600`) **fusionne le lot reçu avec tout l'historique de l'organisation** (`server/index.ts:616-622`) avant de détecter, puis persiste en `upsert` sur `(organisation_id, id)` (`server/index.ts:640`).

---

## 2. Modèle de données

### 2.1 Ce que contient le schéma

`Ticket` (`src/lib/types.ts:7`) et la table `tickets` (`supabase/schema.sql:5`) exposent : `id`, `texte_brut`, `categorie_causale`, `sous_categorie`, `date_creation`, `statut`, `provider_utilise`, `delai_reponse_jours`, `confiance`, `justification`, `created_at`, plus `organisation_id` depuis la migration 002 (`supabase/002_organisations.sql:51`).

Confrontation avec ce qu'exige une horloge de risque des 45 jours :

| Besoin | Présent ? | Constat |
|---|---|---|
| Date de réception | **oui** | `date_creation`, indexée (`schema.sql:21`). Mais substituée par la date du jour si absente du fichier (`columnMapping.ts:221`). |
| Dossier ouvert / clôturé | **indirect** | Déduit de `statut` ∈ `nouveau`/`en_cours`/`resolu`/`en_retard` (`taxonomy.ts:52`). `resolu` est le seul état terminal ; `en_retard` est **à la fois** un état d'avancement et un verdict de conformité, ce qui est une confusion de nature. |
| Date de clôture | **absent** | Aucune colonne. |
| Date de réponse finale | **absent** | Aucune colonne. C'est l'événement que le règlement datent, et il n'est nulle part. |
| Accusé de réception | **absent** | Mentionné dans l'avertissement du rapport (`complianceReport.ts:50`) comme obligation non couverte. |

### 2.2 Le vrai problème : `delai_reponse_jours` n'a pas une sémantique, mais deux

Vérifié sur `data/reclamations-2026.csv` (600 lignes) en comparant l'écart entre `aujourd'hui − date_creation` et la valeur stockée :

| Statut | n | `delai` vide | Écart (jours écoulés réels − `delai` stocké) |
|---|---|---|---|
| `nouveau` | 178 | **178** | — (aucune valeur) |
| `en_cours` | 146 | 0 | **exactement 32**, min = max = 32 |
| `en_retard` | 95 | 0 | **exactement 32**, min = max = 32 |
| `resolu` | 181 | 0 | variable : médiane 51, de 32 à 169 |

Lecture :

1. Pour un dossier **ouvert** (`en_cours`, `en_retard`), `delai_reponse_jours` = jours écoulés **à la date de génération du jeu (2026-08-31)**. L'écart constant de 32 jours est exactement `2026-10-02 − 2026-08-31`. La valeur est donc **figée et déjà fausse de 32 jours**, et le restera en vieillissant.
2. Pour un dossier **clos** (`resolu`), l'écart varie : la valeur est le **temps de réponse effectif**, une grandeur de nature différente, qui ne doit surtout pas vieillir.
3. Pour un dossier **`nouveau`**, la colonne est **systématiquement vide** (178/178). Or ce sont précisément les dossiers que l'horloge de risque doit surveiller.

Une seule colonne porte donc « ancienneté à une date de référence implicite » et « durée de traitement », avec un trou sur le tiers du portefeuille. **`delai_reponse_jours` ne peut pas servir de base à l'horloge de risque.** Et il ne faut pas non plus le recalculer en `aujourd'hui − date_creation` sans distinguer le statut, car cela détruirait l'information de temps de réponse des dossiers clos.

Second effet, à vérifier avant toute démonstration : au 2026-10-02, les 146 dossiers `en_cours` ont entre 43 et 166 jours d'ancienneté réelle, et **135 d'entre eux dépassent déjà 45 jours** — contre 3 selon la colonne stockée. Les 178 `nouveau` ont 32 à 42 jours : aucun au-delà du seuil, mais **tous à moins de 13 jours de le franchir**. Une horloge de risque honnête afficherait donc, sur ce jeu, un portefeuille en quasi-faillite réglementaire. Ce n'est pas un défaut de l'horloge : c'est le jeu de test qui a vieilli.

Troisième incohérence, entre les deux jeux de données : le générateur versionné `scripts/generate-synthetic-tickets.mjs:144` tire `delai_reponse_jours` **au hasard, sans aucun lien avec `date_creation`** (`randInt(1,44)` si `resolu`, `randInt(46,95)` si `en_retard`, `null` sinon). `public/sample-tickets.csv` (150 lignes, chargé par le bouton « Charger l'échantillon », `useTicketWorkspace.ts:57`) a donc un délai **décorrélé de la date**, là où `data/reclamations-2026.csv` l'a dérivé de la date. Deux jeux, deux conventions incompatibles. Tout contrôle de cohérence date/délai passera sur l'un et échouera sur l'autre.

À noter aussi : `data/reclamations-2026.csv` possède 9 colonnes (`canal_reception`, `agence`, `reference_dossier` en plus) que le générateur versionné ne produit pas — il n'en émet que 6 (`generate-synthetic-tickets.mjs:164`) et cible 150 lignes (`:134`). **Le jeu de 600 lignes n'est donc pas reproductible depuis le dépôt.** Le script qui l'a produit n'est pas versionné.

### 2.3 Migration proposée (non appliquée)

```sql
-- supabase/004_horloge_risque.sql — PROPOSITION, non exécutée.

-- 1. Les deux dates que le règlement datent réellement.
alter table tickets add column if not exists date_accuse_reception date;
alter table tickets add column if not exists date_reponse_finale  date;

-- 2. Clôture explicite, au lieu de la déduire du statut.
alter table tickets add column if not exists date_cloture date;

-- 3. Lever l'ambiguïté : une colonne par grandeur, chacune générée,
--    donc impossible à désynchroniser.
--    - delai_traitement_jours : temps de réponse effectif (dossiers clos) ;
--    - jours_ecoules          : ancienneté vivante (dossiers ouverts), recalculée à la lecture.
alter table tickets
  add column if not exists delai_traitement_jours integer
  generated always as (
    case when date_reponse_finale is not null
         then (date_reponse_finale - date_creation::date)
    end
  ) stored;

-- `jours_ecoules` ne peut pas être une colonne générée : elle dépend de now(),
-- qui n'est pas immutable. À exposer en vue.
create or replace view tickets_horloge as
select
  t.*,
  case when t.date_reponse_finale is null
       then (current_date - t.date_creation::date)
  end                                               as jours_ecoules,
  case when t.date_reponse_finale is null
       then 45 - (current_date - t.date_creation::date)
  end                                               as jours_restants,
  (t.date_reponse_finale is null)                   as est_ouvert
from tickets t;

-- 4. Conserver l'ancienne colonne en lecture seule le temps de la bascule,
--    plutôt que de la supprimer : les portefeuilles déjà importés n'ont
--    aucune des nouvelles dates et seraient réputés ouverts depuis leur
--    date de création, donc massivement non conformes à tort.
comment on column tickets.delai_reponse_jours is
  'DÉPRÉCIÉ — sémantique ambiguë (ancienneté figée pour les dossiers ouverts,
   temps de réponse pour les clos). Lu en repli uniquement. Voir
   delai_traitement_jours et la vue tickets_horloge.';
```

**Sur la vue et la RLS** — point à ne pas rater : une vue créée ainsi s'exécute avec les droits de son propriétaire. En PostgreSQL 15+, il faut `with (security_invoker = true)` pour que la RLS de `tickets` s'applique à l'appelant. Sans cela, **`tickets_horloge` exposerait les réclamations de toutes les organisations**. Version non vérifiée sur le projet Supabase ; à confirmer avant d'écrire la migration.

Côté TypeScript, `Ticket` (`types.ts:7`) doit recevoir les mêmes champs, et `TICKET_COLUMNS` (`server/index.ts:531`) doit les lister — PostgREST rejette tout objet contenant un champ hors schéma, et c'est ce tableau qui filtre. Oublier cette liste est la panne la plus probable de la migration.

Il faut enfin décider si l'import doit proposer ces nouvelles dates : cela signifie trois entrées supplémentaires dans `MAPPING_TARGETS` (`columnMapping.ts:25`) et des alias correspondants. Sans cela, les nouvelles colonnes resteront vides sur tout fichier importé, et l'horloge n'aura rien de plus qu'aujourd'hui.

---

## 3. Évaluation des cinq chantiers

Barème d'effort : **S** ≈ une demi-journée à une journée · **M** ≈ deux à quatre jours · **L** ≈ une semaine ou plus. Estimations pour un développeur connaissant ce dépôt, tests non compris sauf mention.

### 3.1 Chantier 1 — Déploiement

**Le diagnostic demandé ne s'applique plus.** Relevé au 2026-10-02 21:08:36 GMT :

```
GET https://sentinelle-production-6f65.up.railway.app/api/health
HTTP/2 404
server: railway-hikari
x-railway-fallback: true
{"status":"error","code":404,"message":"Application not found"}
```

`x-railway-fallback: true` et `Application not found` sont la réponse du **routeur de périphérie de Railway**, pas celle de l'application. Railway déclare qu'**aucun déploiement actif n'est rattaché à ce domaine**. Les deux chemins (`/` et `/api/health`) répondent identiquement.

C'est un changement d'état survenu pendant la session : plus tôt dans la journée, la même adresse servait encore l'ancien bundle `/assets/index-CfWMrd3C.js` et un `/api/health` complet. Il ne s'agit donc pas d'un déclencheur de build muet, mais d'une **disparition du service**. Causes possibles, par ordre de vraisemblance, **non vérifiées** faute d'accès :

1. crédits ou période d'essai épuisés — Railway suspend le service et détache le domaine ;
2. service supprimé ou projet désaffecté ;
3. domaine public retiré de la configuration du service.

Ce qui est en revanche vérifié côté dépôt :

| Vérification | Résultat |
|---|---|
| `origin/master` | `d4e1de98` — identique au local `d4e1de9` |
| Le correctif Gemini est-il poussé ? | **oui**, commits `f376610` et `d4e1de9` |
| `railway.json` / `railway.toml` | **absents** |
| `Dockerfile` / `Procfile` / `nixpacks.toml` | **absents** |
| `package.json` → `engines` | **absent** |
| `.nvmrc` | **absent** |
| Scripts de build/start | `build` et `start` présents (`package.json`) — suffisants pour l'auto-détection Nixpacks |
| Branche amont suivie par `master` | **aucune** (`fatal: aucune branche amont configurée`) |

L'absence de branche amont locale n'empêche pas Railway de déployer (c'est Railway qui observe GitHub), mais elle explique qu'aucun outil local ne signale un écart entre local et distant.

**Faisabilité :** le code est prêt ; le blocage est un accès au compte Railway. **Je ne peux pas le lever** — aucune CLI Railway installée, aucun jeton dans l'environnement ni dans `.env`, aucune configuration dans `~/.config/railway`.

**Effort : S côté dépôt, inconnu côté compte.** Ce qui relève du dépôt se résume à trois ajouts défensifs qui coûtent quelques minutes et suppriment des causes de panne au redéploiement :

```jsonc
// package.json
"engines": { "node": ">=22" }   // supprime l'avertissement de dépréciation
                               // de @supabase/supabase-js et fixe le runtime
```

```toml
# railway.toml — rend le build explicite au lieu de dépendre de l'auto-détection
[build]
builder = "NIXPACKS"
[deploy]
startCommand = "npm run start"
healthcheckPath = "/api/health"
restartPolicyType = "ON_FAILURE"
```

Le `healthcheckPath` a une vraie valeur ici : il fait échouer bruyamment un déploiement qui démarre sans répondre, au lieu de le laisser passer pour sain.

**Risque :** `npm run start` lance `tsx server/index.ts`, donc **TypeScript est transpilé à l'exécution en production**, et `tsx` est une dépendance de production (`package.json`). Cela fonctionne, mais fait porter au serveur un coût de démarrage et une dépendance de développement inutiles. Hors périmètre de cette évaluation ; à noter comme dette.

**Ordre de priorité : inchangé, premier.** Sans environnement déployé, les chantiers 2 à 5 ne sont démontrables que sur un poste local — ce qui suffit pour construire, mais pas pour une démonstration à une banque.

### 3.2 Chantier 2 — Horloge de risque des 45 jours

**Faisabilité : élevée sur le calcul, conditionnée sur les données.** L'arithmétique est triviale et déterministe. Le problème n'est pas là : il est que **le schéma ne permet pas de savoir si un dossier est encore ouvert** autrement qu'en interprétant `statut`, et que la grandeur « jours écoulés » n'existe pas de façon fiable ([§2.2](#22-le-vrai-problème--delai_reponse_jours-na-pas-une-sémantique-mais-deux)).

Deux voies :

- **Voie courte, sans migration.** On considère ouvert tout ticket dont le statut n'est pas `resolu`, et on calcule l'ancienneté en `aujourd'hui − date_creation`, en ignorant `delai_reponse_jours`. Fonctionne immédiatement, y compris sur les 178 `nouveau` sans délai. Mais le chiffre affiché **contredira** la colonne stockée (32 jours d'écart sur le jeu de test) et le rapport de conformité existant, qui continue de lire `delai_reponse_jours` (`complianceReport.ts:31`). Deux nombres contradictoires sur le même écran est exactement ce que le principe directeur interdit.
- **Voie propre, avec la migration de [§2.3](#23-migration-proposée-non-appliquée).** `date_reponse_finale` renseignée ⇒ dossier clos ; sinon ouvert, ancienneté vivante. Une seule source de vérité, et le rapport peut basculer sur la même.

Je recommande la voie propre, mais en gardant la lecture de `delai_reponse_jours` **en repli explicite** pour les portefeuilles déjà importés, qui n'auront aucune des nouvelles dates.

**Fichiers touchés**

| Fichier | Nature |
|---|---|
| `supabase/004_horloge_risque.sql` | nouveau — migration |
| `src/lib/types.ts:7` | nouveaux champs sur `Ticket` |
| `server/index.ts:531` | `TICKET_COLUMNS` — sinon PostgREST rejette l'insertion |
| `src/lib/riskClock.ts` | nouveau — calcul pur, testable sans IA ni base |
| `src/lib/complianceReport.ts:31` | aligner le critère de dépassement |
| `src/lib/patternDetection.ts:54` | idem, règle COBAC |
| `src/App.tsx` | colonnes « Jours écoulés » / « Jours restants », tri, projection |
| `src/lib/columnMapping.ts:25` | optionnel — exposer les nouvelles dates à l'import |

**Dépendances :** la migration. Rien d'autre. Aucun appel IA, aucun quota.

**Effort : M.** Le calcul est S ; ce qui fait basculer en M est la migration, l'alignement des **trois** endroits qui jugent aujourd'hui du dépassement (rapport, patterns, et désormais l'horloge) et la gestion du repli pour les données existantes. Un seul oubli produit deux taux de conformité différents dans la même application.

**Réutilise l'existant :** `COBAC_DEADLINE_DAYS` (`taxonomy.ts:57`) est déjà la constante unique ; `daysBetween` (`patternDetection.ts:8`) est réutilisable **une fois dé-absolutisé** ; `SEVERITY_COLOR` et `PatternBanner` (`App.tsx:27`, `:34`) donnent le gabarit visuel de la projection.

**Risques**

1. **La projection ne peut pas être une promesse.** « N dossiers franchissent le seuil dans les 7 prochains jours » est exact comme arithmétique sur les dates, mais faux comme prédiction : rien n'empêche qu'une réponse soit envoyée demain. Le libellé doit dire *« si aucune réponse n'est apportée d'ici là »*. Sans cette clause, c'est précisément la promesse que le code ne tient pas.
2. **Le jeu de test a vieilli** et donnera une image catastrophique (135 des 146 `en_cours` déjà hors délai). Soit on réancre le jeu, soit on l'explique en démonstration. Ne pas découvrir ça devant une banque.
3. Les dossiers importés sans colonne de date reçoivent la date du jour (`columnMapping.ts:221`) : horloge toute verte et fausse. L'écran doit indiquer quand la date a été substituée — information aujourd'hui perdue à l'import, donc à conserver.

### 3.3 Chantier 3 — Détection relative à une baseline

**Faisabilité : moyenne, et le volume est le vrai sujet.** Mesuré sur `data/reclamations-2026.csv` : 600 réclamations sur 137 jours, soit **4,4/jour toutes catégories**, médiane 2/jour, et **réparties sur 10 catégories**. Pour une catégorie moyenne, cela fait **0,44 réclamation/jour**.

À ce niveau, une carte de contrôle de Poisson en granularité **journalière** est ingouvernable : avec λ ≈ 0,44, la limite supérieure à 3σ tombe vers 2 ou 3 événements, qu'un simple hasard franchit régulièrement. On produirait des fausses alertes en continu — l'inverse du but.

En granularité **hebdomadaire**, λ ≈ 3/semaine/catégorie : exploitable, bornes plus stables, et cela correspond au rythme réel d'un service conformité. **Je recommande donc de trancher pour la semaine**, et de ne pas rendre la granularité configurable dans un premier temps : deux granularités, c'est deux jeux de seuils à valider.

Sur la méthode, parmi les trois évoquées : le **lissage exponentiel (EWMA) sur comptes hebdomadaires**, avec bornes de Poisson autour de la moyenne lissée, est le meilleur rapport valeur/explicabilité. Il s'explique en une phrase à un auditeur (« on compare la semaine à la moyenne des semaines précédentes, en pondérant les récentes »), il s'adapte à une dérive lente du volume, et il ne demande aucune dépendance.

**Problème de validation, et il est sérieux.** Le jeu de test ne permet pas de valider ce détecteur. Volume mensuel mesuré :

| Mois 2026 | 03 | 04 | 05 | 06 | 07 | 08 |
|---|---|---|---|---|---|---|
| Réclamations | 6 | 40 | 55 | 43 | **128** | **328** |

Et par semaine ISO, de S10 à S36 : `1, 2, 2, 1, 6, 13, 7, 12, 8, 16, 15, 9, 9, 13, 10, 10, 8, 7, 10, 23, 54, 50, 58, 56, 73, 110, 17`.

Ce n'est pas une baseline avec des pics : c'est une **rampe globale croissante d'un facteur ~50**, présente dans **les dix catégories simultanément** (chacune monte de mars à août). Un détecteur relatif à la baseline signalerait donc *toutes* les catégories sur *toutes* les dernières semaines, et paraîtrait remarquablement efficace — pour une raison qui n'a rien à voir avec un incident. C'est un artefact du générateur, pas un phénomène.

À l'inverse, **les pics ne semblent pas avoir été placés à la main** : le maximum par catégorie et par jour est de 5, contre une médiane de 0 à 1. Il n'y a pas de cluster injecté identifiable. La circularité redoutée n'est donc pas là où elle était attendue — elle est dans la tendance globale, pas dans des pics scénarisés.

**Conclusion sur ce chantier : il lui manque son jeu de validation.** Construire le détecteur sans données portant une baseline plate et quelques pics localisés revient à écrire du code qu'on ne peut ni éprouver ni démontrer honnêtement. **C'est un prérequis, pas un détail**, et il doit figurer dans le plan comme une étape à part.

**Fichiers touchés :** `src/lib/baseline.ts` (nouveau, calcul pur), `src/lib/patternDetection.ts` (nouveau type de pattern), `supabase/schema.sql` → contrainte `check (type in ('volume','conformite_cobac'))` (`schema.sql:34-35`) **à étendre, sinon toute insertion d'un pattern d'un nouveau type est rejetée par PostgreSQL**, `src/App.tsx` (affichage), et le script de génération de données.

**Effort : M**, plus **S à M** pour le jeu de validation. Le calcul EWMA est court ; ce qui coûte, c'est le choix des seuils, leur justification, et des données qui permettent de les régler.

**Risque de fond :** remplacer un seuil fixe compréhensible (« 4 en 14 jours ») par un seuil statistique rend l'alerte **plus juste mais moins explicable**. Devant un auditeur COBAC, « 7 cette semaine contre 2,8 attendues, soit au-delà de la limite haute de contrôle » exige d'expliquer la limite. Je recommande de **conserver les deux** et d'afficher la règle fixe comme repère, plutôt que de la supprimer.

### 3.4 Chantier 4 — Mode Replay

**Faisabilité : la meilleure des cinq, et de loin.** `detectPatterns(tickets, now)` accepte déjà l'horloge en paramètre (`patternDetection.ts:28`) et la fonction est **pure** : aucune entrée/sortie, aucun appel IA. Rejouer six mois consiste à boucler sur les dates et à rappeler la fonction. Sur 600 tickets et 137 jours, c'est quelques dizaines de millisecondes dans le navigateur.

**Deux corrections obligatoires avant de commencer.**

1. **La fuite du futur.** `daysBetween` renvoie une valeur absolue (`patternDetection.ts:9`) : à `now = T`, un ticket de `T + 10` entre dans la fenêtre. Un Replay construit sur l'état actuel afficherait des alertes fondées sur des réclamations pas encore reçues — le défaut le plus embarrassant possible pour une démonstration de détection précoce. Correctif : filtrer sur un écart **signé** dans `[0, 14]`. Une ligne, mais elle doit être écrite d'abord, et c'est le seul endroit du code où un test unitaire est non négociable.
2. **La règle COBAC ignore l'horloge.** `detectPatterns` filtre les retards sur `statut === 'en_retard' || delai_reponse_jours > 45` (`patternDetection.ts:54-56`), deux grandeurs qui ne dépendent pas de `now`. Rejoué au 15 avril, le Replay annoncerait donc déjà les 95 dossiers en retard d'août. Il faut que le retard se calcule par rapport à `now` — ce qui est exactement ce que produit le chantier 2. **Le Replay dépend donc du chantier 2**, et non l'inverse.

**Sur la pré-classification : oui, et elle est déjà acquise.** Le Replay ne doit appeler Gemini **à aucun moment** — 600 appels à 10/minute font une heure, et un Replay doit se rejouer en quelques secondes. Mais la question est en réalité déjà résolue : `classifyAll` persiste le lot classé via `POST /api/tickets` (`useTicketWorkspace.ts:186`) avant de détecter les patterns, et `GET /api/tickets` le relit au chargement (`useTicketWorkspace.ts:123`). Le Replay travaille donc sur `tickets` déjà en mémoire, **sans aucune requête**. Un Replay sur un portefeuille non classé doit simplement être refusé, avec un message clair.

**Ce qu'il ne faut pas faire : persister la chronologie d'alertes.** `patterns_detectes` a pour clé `(organisation_id, id)` (`002_organisations.sql:73`) avec des identifiants **déterministes** — `pattern-volume-<catégorie>` (`patternDetection.ts:42`). Une seule ligne par catégorie peut donc exister : rejouer 137 jours écraserait 137 fois la même ligne. Le Replay doit rester **un calcul d'affichage, non persisté**. C'est d'ailleurs la bonne conception : il est entièrement dérivable des tickets.

**Fichiers touchés :** `src/lib/patternDetection.ts` (les deux correctifs), `src/lib/replay.ts` (nouveau — itération sur les dates, première date de lever de chaque alerte), `src/App.tsx` (curseur chronologique, frise des alertes).

**Effort : M.** Le moteur est S — presque tout existe. Ce qui coûte est l'interface : un curseur temporel, une frise lisible, et la comparaison explicite au reporting mensuel qui constitue tout l'argument. Et cette interface a besoin d'une couche de visualisation qui n'existe pas ([§3.6](#36-la-dépendance-absente-du-plan--la-couche-de-visualisation)).

**C'est le chantier au meilleur rapport valeur/effort de la liste** : c'est lui qui démontre la thèse (« voici le jour où nous aurions alerté, voici le jour où le reporting mensuel l'a vu »), et il repose presque entièrement sur du code déjà écrit.

### 3.5 Chantier 5 — Prévision simple et explicable

**Faisabilité : haute techniquement, valeur douteuse à ce stade.** Un intervalle de Poisson sur la moyenne lissée du chantier 3 est une dizaine de lignes et se calcule à partir des mêmes agrégats.

Mais à λ ≈ 3/semaine/catégorie, l'intervalle à 95 % est d'environ **0 à 7**. Annoncer « entre 0 et 7 réclamations de fraude la semaine prochaine » est honnête, explicable — et **inactionnable**. Sur le total toutes catégories (λ ≈ 31/semaine), l'intervalle est d'environ 20 à 42 : utilisable, mais un agrégat toutes catégories confondues n'oriente aucune décision.

C'est une conséquence de la taille du portefeuille, pas de la méthode. Aucune technique ne produira un intervalle serré sur 3 événements par semaine ; prétendre le contraire serait exactement la promesse que le principe directeur interdit.

**Effort : S** si le chantier 3 est fait (mêmes agrégats, mêmes séries). **M** sinon.

**Mon avis, franchement : ce chantier est mal placé en cinquième position parce qu'il ne devrait pas être dans cette liste pour l'instant.** Il ajoute de la surface d'interface et une notion statistique supplémentaire à expliquer, pour une information que l'horloge de risque (chantier 2) donne déjà sous une forme **plus forte et déterministe** : « 23 dossiers franchissent le seuil dans les 7 jours si rien n'est fait » est un nombre exact, actionnable, et sans intervalle de confiance à défendre. Je le reporterais après une première validation client, ou le réduirais à un intervalle sur le **total**, présenté comme une aide au dimensionnement de charge — pas comme une prévision de risque.

### 3.6 La dépendance absente du plan : la couche de visualisation

Vérifié : **aucune bibliothèque de graphiques** dans `package.json` (ni Recharts, ni D3, ni Chart.js, ni Plotly), et **aucun composant de graphique** dans `src/`. L'interface se compose d'un en-tête, d'une barre d'outils, de bandeaux, d'onglets, d'un tableau à 5 colonnes (`App.tsx:343-347`) et d'un bloc Markdown.

Or les trois chantiers statistiques produisent tous des objets temporels :

| Chantier | Produit | Support d'affichage aujourd'hui |
|---|---|---|
| 2 — horloge | distribution d'échéances, projection à 7 jours | aucun |
| 3 — baseline | série hebdomadaire + bornes de contrôle | aucun |
| 4 — Replay | frise d'alertes dans le temps | aucun |
| 5 — prévision | intervalle sur une série | aucun |

Le chantier 2 peut s'en passer : deux colonnes de plus dans le tableau et un bandeau suffisent, et c'est une raison supplémentaire de le faire en premier. **Les chantiers 3, 4 et 5, non.** Une carte de contrôle sans graphique, c'est un tableau de nombres que personne ne lira ; un Replay sans frise, c'est un compteur qui s'incrémente.

Il faut donc **insérer une étape de visualisation dans le plan**, entre le chantier 2 et le chantier 3. Trois conséquences :

1. **Choix d'une bibliothèque.** Recharts s'intègre naturellement à React 19 et couvre série temporelle, bandes de contrôle et frise. À arbitrer avec le poids du bundle.
2. **Palette à valider.** `categoryTagStyle` (`src/lib/categoryColor.ts:13`) fournit 10 teintes à contraste vérifié ≥ 7,53 — mais pour **du texte sur fond clair**, pas pour des aplats ou des traits adjacents dans un graphique. Les couleurs de séries exigent leur propre validation : contraste contre `--color-surface`, et distinguabilité en cas de déficience de vision des couleurs. Ce n'est pas un portage de la palette existante.
3. **Jamais la couleur seule.** `SEVERITY_COLOR` (`App.tsx:27`) est déjà accompagné de `SEVERITY_LABEL` (`App.tsx:20`) dans `PatternBanner` — bonne pratique déjà en place, à maintenir dans les graphiques (forme, libellé direct ou motif en plus de la teinte).

**Effort : M**, et c'est un investissement qui sert les trois chantiers suivants.

---

## 4. Pièges

### 4.1 Quota Gemini et Replay

Le plafond effectif est `GEMINI_RPM = 10` (`server/index.ts:117`), volontairement sous les ~15/min du palier gratuit. Classer 600 réclamations ≈ **60 minutes**.

- **Le Replay ne doit jamais classifier.** Il travaille sur des tickets déjà classés, en mémoire, sans aucun appel. Déjà acquis par la persistance ([§3.4](#34-chantier-4--mode-replay)).
- **Mais `classifyAll` reclasse tout** (`useTicketWorkspace.ts:148`), sans sauter les tickets déjà porteurs d'une `categorie_causale`. Ajouter 10 réclamations à 600 coûte une heure. **Un filtre d'une ligne** (`tickets.filter(t => !t.categorie_causale)`, avec un bouton explicite « tout reclasser ») transforme l'ergonomie de tout travail itératif sur un portefeuille. À faire avant le Replay, pas après.
- Le limiteur est **global au processus** (`server/index.ts:114-116`) : il tient face à plusieurs onglets ou utilisateurs, mais **pas face à plusieurs instances** Railway. Une montée en charge horizontale multiplierait le débit réel par le nombre d'instances et ramènerait les 429. Non vérifié : le nombre de répliques configuré.

### 4.2 RLS dans les nouvelles requêtes

Toute nouvelle route doit passer par `resolveWorkspace` (`server/index.ts:480`) et utiliser `ws.db`, jamais le client `service_role` de `server/db.ts:21` — celui-ci contourne la RLS par conception.

Trois pièges spécifiques à ces chantiers :

1. **Les agrégats.** Une baseline par catégorie et par semaine se calcule naturellement en SQL. Si c'est fait via une fonction `SECURITY DEFINER` — le motif déjà employé pour `est_membre` (`002_organisations.sql:80`) — elle **contournerait la RLS** et mélangerait les organisations. Pour les agrégats, il faut l'inverse : `SECURITY INVOKER`. Le plus sûr à court terme est **d'agréger côté client** sur les tickets déjà filtrés par la RLS : le volume (quelques milliers de lignes) le permet sans difficulté.
2. **Les vues.** Même point pour `tickets_horloge` ([§2.3](#23-migration-proposée-non-appliquée)) : sans `security_invoker = true`, elle expose tout.
3. **`POST /api/generate-report`** (`server/index.ts:665`) ne consulte **ni Supabase ni la RLS** : elle calcule sur le corps de la requête. C'est sain aujourd'hui, mais si le rapport doit un jour intégrer une baseline lue en base, cette route devra être rattachée à `resolveWorkspace`. Ne pas le faire par inadvertance.

### 4.3 Repli heuristique

`heuristicClassify` (`ticketClassifier.ts:58`) renvoie une catégorie plausible avec une confiance de 0,3, ou `Autre / non catégorisé` à 0,2 en dernier recours (`ticketClassifier.ts:83-88`), sous un **HTTP 200**.

Pour un système de détection précoce, c'est le piège central : **un repli massif déplace les volumes entre catégories**, et la baseline comme le détecteur d'anomalie travaillent sur ces volumes. Un incident Gemini d'une heure produirait un effondrement de certaines catégories et un gonflement de `Autre`, que le détecteur interpréterait comme un phénomène métier. Il signalerait une anomalie réelle — mais de la mesure, pas du portefeuille.

Trois exigences qui en découlent :

1. `provider_utilise` est persisté (`server/index.ts:538`). **La baseline doit pouvoir exclure les tickets `heuristic`**, ou au minimum signaler leur proportion dans la fenêtre analysée.
2. Le bandeau rouge (`App.tsx:280`) ne vit que dans l'état de session : après rechargement, `classifyStats` est nul et un portefeuille à moitié heuristique paraît sain. Un indicateur **dérivé des tickets eux-mêmes** (comptage de `provider_utilise === 'heuristic'`) serait durable, et ne coûte qu'un `useMemo`.
3. Aucune alerte de baseline ne devrait être levée sur une fenêtre dont une part significative est heuristique. Seuil à fixer — c'est une question ouverte ([§6](#6-questions-ouvertes)).

### 4.4 Accessibilité

Le plancher actuel est documenté dans `src/index.css:11-15` et tient à des paires précises ; les tags causals sont à 7,53 minimum (`categoryColor.ts:17`). Les tokens de sévérité existent déjà (`--color-warning`, `--color-danger-high`, `--color-danger-critical`, `index.css:33-35`).

Points de vigilance pour les nouveaux écrans :

- Les **couleurs de séries de graphiques** ne sont pas couvertes par les vérifications existantes ([§3.6](#36-la-dépendance-absente-du-plan--la-couche-de-visualisation)).
- Le tableau utilise du 11 px en en-tête (`App.tsx:343`), déjà le cas le plus serré du thème. **Ne pas introduire de taille plus petite** pour faire tenir les nouvelles colonnes d'horloge : réduire le nombre de colonnes visibles plutôt que la taille du texte.
- Un curseur temporel de Replay doit être **utilisable au clavier** et annoncer la date courante à un lecteur d'écran. Un `input[type=range]` nommé le fait nativement ; un curseur personnalisé en `div` ne le fait pas.
- Le code actuel associe systématiquement une forme et un libellé à la couleur (`App.tsx:20`, `:27`, icônes `AlertTriangle`/`CheckCircle2`). Maintenir cette discipline.

### 4.5 Risque de démonstration circulaire

Trois mesures sur `data/reclamations-2026.csv`, dont les conclusions divergent de l'hypothèse de départ :

| Vérification | Résultat | Verdict |
|---|---|---|
| Pics de catégorie placés à la main ? | max 5/jour/catégorie contre une médiane de 0–1 ; aucun cluster injecté identifiable | **Non** — la crainte initiale n'est pas confirmée |
| Le texte contient-il sa propre étiquette ? | 34/600 citent un nombre de jours ; 7/600 citent « 45 jours » | **Marginal** — 6 % des verbatims, sans effet notable sur la mesure de précision |
| Tendance globale du volume | 6 → 40 → 55 → 43 → 128 → 328 par mois, **dans les dix catégories** | **Oui, et c'est le vrai problème** |

La circularité est donc ailleurs qu'attendu : ce n'est pas la classification qui est truquée, c'est la **série temporelle**. Une rampe d'un facteur 50 présente partout rend tout détecteur de tendance brillant et toute validation sans valeur.

**Conséquence pratique :** `data/reclamations-2026.csv` reste bon pour éprouver l'import, la correspondance de colonnes, la classification et le quota. Il est **inutilisable pour valider ou démontrer les chantiers 3 et 5**. Il faut un second jeu, construit explicitement : baseline plate par catégorie, un ou deux pics localisés et documentés, et des dates ancrées par rapport à la date d'exécution plutôt qu'en dur — faute de quoi il périmera comme le premier (32 jours de décalage en un mois).

À corriger aussi : le générateur versionné (`scripts/generate-synthetic-tickets.mjs`) ne produit **ni les 9 colonnes ni les 600 lignes** du jeu actuel (150 lignes, 6 colonnes, `:134` et `:164`), et tire le délai indépendamment de la date (`:144`). **Le jeu de 600 lignes n'est pas reproductible depuis le dépôt.** Versionner le script qui l'a produit est un prérequis de toute validation statistique sérieuse.

---

## 5. Plan proposé

Neuf étapes, chacune livrable et vérifiable seule. L'ordre diffère de la liste initiale sur trois points, justifiés ci-dessous.

### Étape 0 — Rétablir le déploiement · effort S (hors accès compte)

Déterminer pourquoi Railway ne rattache plus de déploiement au domaine, rétablir le service, puis ajouter `railway.toml` avec `healthcheckPath = "/api/health"` et `engines.node` dans `package.json`.

**Terminé quand :** `GET /api/health` renvoie `200` avec `geminiRpm: 10`, le bundle servi diffère de `index-CfWMrd3C.js`, et un commit poussé sur `master` déclenche un build visible dans l'historique Railway.

> Nécessite un accès au compte Railway, que je n'ai pas. Seul blocage non technique du plan.

### Étape 1 — Corriger les deux défauts de `detectPatterns` · effort S

Fenêtre signée `[0, 14]` au lieu de la valeur absolue (`patternDetection.ts:9`, `:36`), et premier test unitaire du dépôt : un ticket postérieur à `now` ne doit jamais être compté.

**Terminé quand :** un test échoue sur l'ancien comportement et passe sur le nouveau ; les patterns détectés sur le jeu de 600 lignes à `now = aujourd'hui` sont inchangés (non-régression).

> Placé avant tout le reste parce que c'est le prérequis silencieux du Replay, que c'est une ligne, et que c'est l'occasion d'installer le harnais de test dont les étapes 3 à 7 dépendent.

### Étape 2 — Ne reclasser que ce qui n'est pas classé · effort S

Filtrer dans `classifyAll` (`useTicketWorkspace.ts:148`), avec un bouton distinct pour forcer une reclassification complète. Afficher un indicateur durable de la part de tickets `heuristic`, dérivé des tickets et non de l'état de session.

**Terminé quand :** reclasser un portefeuille de 600 tickets déjà classés ne déclenche aucun appel IA, et l'ajout de 10 réclamations coûte 10 appels. La part heuristique reste visible après rechargement.

> Non demandé, placé tôt délibérément : sans cela, chaque itération des étapes suivantes sur le jeu de test coûte une heure d'attente. C'est l'étape qui rend les autres travaillables.

### Étape 3 — Migration du modèle de données · effort M

`supabase/004_horloge_risque.sql` selon [§2.3](#23-migration-proposée-non-appliquée) : `date_accuse_reception`, `date_reponse_finale`, `date_cloture`, `delai_traitement_jours` générée, vue `tickets_horloge` en `security_invoker`. Mise à jour de `types.ts:7` et de `TICKET_COLUMNS` (`server/index.ts:531`). `delai_reponse_jours` conservée, dépréciée, lue en repli.

**Terminé quand :** un ticket importé puis classé se persiste sans erreur PostgREST ; deux comptes de deux organisations lisant `tickets_horloge` ne voient que leurs lignes ; les portefeuilles existants restent lisibles via le repli.

### Étape 4 — Horloge de risque · effort M

`src/lib/riskClock.ts` (calcul pur, testé), colonnes « Jours écoulés » et « Jours restants » dans le tableau, bandeau de projection à 7 jours formulé sous condition explicite (« si aucune réponse n'est apportée »). Alignement des **trois** juges du dépassement : horloge, `complianceReport.ts:31`, `patternDetection.ts:54`.

**Terminé quand :** le taux de conformité du rapport et celui de l'horloge donnent le même nombre sur le même portefeuille ; un portefeuille sans date de réception est signalé comme tel au lieu d'afficher une horloge verte.

### Étape 5 — Jeu de données de validation · effort S à M

Script versionné, 9 colonnes, dates **relatives à la date d'exécution**, baseline plate par catégorie, un ou deux pics localisés et documentés dans un fichier d'attendus. Les deux jeux coexistent : l'actuel pour l'import et le quota, le nouveau pour la statistique.

**Terminé quand :** le script régénère les deux jeux de façon déterministe (graine fixe) ; le fichier d'attendus énonce les pics que l'étape 7 doit retrouver, et aucun autre.

> Placé avant le détecteur, et non après : c'est la seule façon de savoir si le détecteur fonctionne.

### Étape 6 — Couche de visualisation · effort M

Choix de la bibliothèque, un composant de série temporelle réutilisable, palette de séries validée au contraste et en vision déficiente des couleurs, discipline forme + libellé maintenue.

**Terminé quand :** un graphique de volume hebdomadaire par catégorie s'affiche, lisible au clavier et sans dépendre de la seule couleur ; la palette de séries est documentée comme l'est `categoryColor.ts:17`.

> Étape absente de la liste initiale. Sans elle, les étapes 7 et 8 ne sont pas démontrables.

### Étape 7 — Détection relative à la baseline · effort M

EWMA sur comptes **hebdomadaires** par catégorie, bornes de Poisson, nouveau type de pattern — **avec extension de la contrainte `check` de `schema.sql:34-35`**. La règle fixe « 4 en 14 jours » est conservée et affichée comme repère. Exclusion ou signalement des tickets `heuristic` dans la fenêtre.

**Terminé quand :** le détecteur retrouve exactement les pics du fichier d'attendus de l'étape 5, et n'en signale aucun autre ; l'insertion du nouveau type de pattern en base réussit ; aucune alerte n'est levée sur une fenêtre majoritairement heuristique.

### Étape 8 — Mode Replay · effort M

`src/lib/replay.ts` : itération sur les dates, date de premier lever de chaque alerte, aucun appel réseau. Curseur temporel accessible au clavier, frise des alertes, comparaison explicite à une détection mensuelle.

**Terminé quand :** rejouer 137 jours sur 600 tickets prend moins d'une seconde et n'émet aucune requête ; aucune alerte ne s'appuie sur un ticket postérieur à la date rejouée ; l'écart en jours avec un reporting mensuel est affiché pour chaque alerte.

### Hors plan pour l'instant — chantier 5, prévision

À reconsidérer après l'étape 8, et seulement si une banque le demande. Argumentaire en [§3.5](#35-chantier-5--prévision-simple-et-explicable) : l'horloge de risque délivre déjà une information plus forte, exacte et déterministe, là où un intervalle de 0 à 7 sur une catégorie n'oriente aucune décision.

### Récapitulatif

| # | Étape | Effort | Dépend de |
|---|---|---|---|
| 0 | Rétablir le déploiement | S + accès | — |
| 1 | Corriger `detectPatterns` + harnais de test | S | — |
| 2 | Classification incrémentale | S | — |
| 3 | Migration du modèle | M | — |
| 4 | Horloge de risque | M | 3 |
| 5 | Jeu de validation | S–M | — |
| 6 | Couche de visualisation | M | — |
| 7 | Détection baseline | M | 1, 5, 6 |
| 8 | Mode Replay | M | 1, 4, 6 |

Les étapes 0, 1, 2, 3, 5 et 6 sont mutuellement indépendantes et parallélisables. Le chemin critique est **3 → 4 → 8**.

---

## 6. Questions ouvertes

Ce que je ne peux pas trancher sans toi.

1. **Accès Railway.** Que montre le tableau de bord : service suspendu faute de crédits, service supprimé, ou domaine détaché ? La réponse décide entre « réactiver » et « recréer ». C'est le seul blocage strictement non technique.

2. **Qu'est-ce qui clôt un dossier, dans le vocabulaire de la banque ?** Le règlement date la *réponse finale*. Est-ce la même chose que la clôture du dossier dans le CRM, ou deux événements distincts ? La migration de [§2.3](#23-migration-proposée-non-appliquée) suppose qu'ils sont distincts. Si une banque n'en consigne qu'un, la moitié des colonnes proposées restera vide.

3. **Que faire des portefeuilles déjà importés ?** Ils n'ont aucune des nouvelles dates. Trois options : les laisser sur le repli `delai_reponse_jours` (deux régimes de calcul coexistent), demander une réimportation, ou dériver `date_reponse_finale = date_creation + delai_reponse_jours` pour les `resolu` (plausible mais inventé — je ne le ferais pas sans ton accord explicite).

4. **Granularité de la baseline : je recommande la semaine.** Avec 0,44 réclamation/jour/catégorie, le quotidien produit des fausses alertes en continu ([§3.3](#33-chantier-3--détection-relative-à-une-baseline)). Confirmes-tu, ou la restitution hebdomadaire est-elle trop lente pour l'usage visé ?

5. **Seuil de repli heuristique toléré.** Au-delà de quelle proportion de tickets `heuristic` dans une fenêtre une alerte de baseline devient-elle non fiable ? Je proposerais 10 %, mais c'est un choix métier, pas technique.

6. **Faut-il réancrer le jeu de 600 lignes ?** Au 2026-10-02, 135 des 146 dossiers `en_cours` dépassent déjà 45 jours en ancienneté réelle. L'horloge affichera un portefeuille sinistré. Soit on régénère avec des dates relatives, soit on l'assume et on l'explique. À décider **avant** la prochaine démonstration, pas pendant.

7. **Le volume de 3 à 4 réclamations/jour est-il réaliste ?** Toutes les conclusions statistiques de [§3.3](#33-chantier-3--détection-relative-à-une-baseline) et [§3.5](#35-chantier-5--prévision-simple-et-explicable) en découlent. Pour une banque de détail de la zone, le chiffre réel est peut-être dix fois supérieur — et alors la granularité journalière redevient défendable, et la prévision reprend du sens. Si tu as un ordre de grandeur réel, il change les recommandations 4 et 5.

8. **« Sévérité » par l'IA.** La vision confie à l'IA « catégorie, sous-catégorie, **sévérité** ». Le prompt actuel ne produit pas de sévérité (`ticketClassifier.ts:20-27`) ; `severite` n'existe aujourd'hui que sur les patterns, dérivée du volume (`patternDetection.ts:13`). Faut-il ajouter une sévérité **par réclamation** ? C'est un ajout au schéma, au prompt et à l'interface, et je le signale parce qu'il figure dans la vision sans apparaître dans les cinq chantiers.

9. **Chantier 5 : es-tu d'accord pour le reporter ?** Mon argument est en [§3.5](#35-chantier-5--prévision-simple-et-explicable). Si la prévision a une valeur commerciale précise que je ne vois pas — convaincre un comité, par exemple — dis-le : la décision change.

---

## Annexe — Vérifications effectuées

| Vérification | Méthode | Résultat |
|---|---|---|
| Production | `curl` sur `/` et `/api/health` | `404`, `x-railway-fallback: true`, `Application not found`, 2026-10-02 21:08:36 GMT |
| Dépôt vs GitHub | `git ls-remote` | `origin/master` = `d4e1de98` = local |
| Config de déploiement | `ls` racine | aucun `railway.*`, `Dockerfile`, `Procfile`, `nixpacks.toml`, `engines`, `.nvmrc` |
| Bibliothèque de graphiques | `grep` dans `package.json` et `src/` | aucune |
| Tests | `find` sur `*.test.*`, `*.spec.*`, configs | aucun |
| Sémantique du délai | croisement statut × (aujourd'hui − date) − délai, 600 lignes | écart constant de 32 j pour les dossiers ouverts ; variable pour les clos ; vide pour les 178 `nouveau` |
| Âge réel des dossiers ouverts | calcul au 2026-10-02 | `nouveau` 32–42 j (0/178 > 45) ; `en_cours` 43–166 j (135/146 > 45) |
| Tendance du volume | comptage mensuel et hebdomadaire par catégorie | rampe ×50 de mars à août, présente dans les 10 catégories |
| Pics placés à la main | max par catégorie et par jour | max 5 contre médiane 0–1 — aucun cluster injecté |
| Auto-étiquetage des textes | expression régulière sur 600 verbatims | 34 citent un nombre de jours, 7 citent « 45 jours » |
| Reproductibilité du jeu | lecture de `scripts/generate-synthetic-tickets.mjs` | 150 lignes, 6 colonnes, délai décorrélé de la date — ne produit pas le jeu de 600 |

**Non vérifié**, faute d'accès : l'état du compte et du service Railway, le nombre de répliques configuré, la version PostgreSQL du projet Supabase (nécessaire pour `security_invoker`), et les quotas Gemini réellement consommés sur le compte.
