# Comptes, organisations et connexion

Racine passe d'une démo sans compte à une application multi-établissements : chaque compte
appartient à une **organisation** (une banque), et les réclamations, patterns et rapports
appartiennent à l'organisation — pas à l'individu. Deux employés de la même banque partagent
le même portefeuille ; une autre banque ne voit rien.

Le cloisonnement n'est pas seulement applicatif : il est appliqué par PostgreSQL via la
**RLS** (Row Level Security). Même avec la clé anonyme, qui est publique, une requête sans
session valide ne renvoie aucune ligne.

Référence du projet Supabase : `swvyifqsiuknvrwfkotd`
URL de rappel OAuth (identique pour tous les fournisseurs) :

```
https://swvyifqsiuknvrwfkotd.supabase.co/auth/v1/callback
```

---

## 1. Exécuter la migration

Supabase → **SQL Editor** → **New query** → colle le contenu de
[`supabase/002_organisations.sql`](supabase/002_organisations.sql) → **Run**.

Elle crée `organisations`, `membres`, `invitations`, rattache `tickets` et
`patterns_detectes` à une organisation, et installe les politiques RLS.

⚠️ **Cette migration supprime les lignes sans organisation** de `tickets` et
`patterns_detectes` — c'est-à-dire les données de test antérieures aux comptes. Elles sont
regénérées au prochain classement. Si tu tiens à les garder, crée d'abord ton organisation,
puis affecte son `id` aux lignes existantes avant de lancer la migration.

Elle change aussi la clé primaire de `patterns_detectes` en `(organisation_id, id)` :
l'identifiant de pattern est déterministe (`pattern-cobac-delai`), donc identique d'une
banque à l'autre. Sans cette clé composite, deux banques écraseraient mutuellement leurs
patterns.

## 2. Récupérer la clé anonyme

Supabase → **Settings** → **API** → section *Project API keys* → copie la clé **`anon`
`public`** (pas la `service_role`).

Dans `.env` :

```bash
SUPABASE_ANON_KEY=eyJ...   # ou sb_publishable_... selon l'âge du projet
```

C'est la présence de cette clé qui **active les comptes**. Laissée vide, l'application
tourne exactement comme avant : plan de travail direct, sans écran de connexion. Utile pour
démontrer le produit hors ligne.

La clé anonyme est publique par conception : elle part dans le bundle du navigateur, comme
dans toute application Supabase. Ce qui protège les données, c'est la RLS de l'étape 1 — pas
le secret de cette clé. La `service_role`, elle, ne quitte jamais le serveur.

## 3. Autoriser les URL de retour

Supabase → **Authentication** → **URL Configuration** :

| Champ | Valeur |
|---|---|
| **Site URL** | `http://localhost:5173` en développement, l'URL Railway en production |
| **Redirect URLs** | ajoute les deux : `http://localhost:5173/**` et `https://<ton-app>.up.railway.app/**` |

Sans cette étape, la connexion OAuth aboutit puis renvoie vers une page d'erreur.

## 4. Google OAuth

Côté **Google Cloud** (console.cloud.google.com) — tu peux réutiliser le projet
`364060769926` déjà créé pour la clé Gemini :

1. **APIs & Services** → **OAuth consent screen**. Type *External*. Renseigne le nom de
   l'application, l'e-mail d'assistance, l'e-mail du développeur. Publie-le (*Publish app*),
   sinon seuls les comptes de test peuvent se connecter.
2. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID** →
   type **Web application**.
3. Dans **Authorized redirect URIs**, colle exactement :
   `https://swvyifqsiuknvrwfkotd.supabase.co/auth/v1/callback`
4. Valide : Google affiche un **Client ID** et un **Client Secret**.

Côté **Supabase** → **Authentication** → **Providers** → **Google** : active le fournisseur,
colle le Client ID et le Client Secret, **Save**.

## 5. Microsoft (Azure) OAuth

Côté **Azure** (portal.azure.com) :

1. **Microsoft Entra ID** → **App registrations** → **New registration**.
2. *Supported account types* : **Accounts in any organizational directory and personal
   Microsoft accounts** (sauf si tu veux restreindre à un seul locataire).
3. *Redirect URI* : plateforme **Web**, valeur
   `https://swvyifqsiuknvrwfkotd.supabase.co/auth/v1/callback`
4. Une fois créée, note l'**Application (client) ID**.
5. **Certificates & secrets** → **New client secret** → copie la **Value** (pas le Secret ID),
   elle ne s'affiche qu'une fois.

Côté **Supabase** → **Authentication** → **Providers** → **Azure** : active, colle le client
ID et le secret. Laisse *Azure Tenant URL* vide pour accepter tous les locataires, ou mets
`https://login.microsoftonline.com/<tenant-id>` pour restreindre à une entreprise.

## 6. Confirmation d'e-mail

Par défaut Supabase envoie un lien de confirmation à chaque inscription par mot de passe, et
la session n'est ouverte qu'après clic. L'écran d'inscription l'annonce explicitement.

Pour tester plus vite en local : **Authentication** → **Providers** → **Email** → décoche
*Confirm email*. **À réactiver avant toute mise en production** : sans confirmation,
n'importe qui peut créer un compte avec l'adresse d'un tiers, ce qui suffirait à récupérer
une invitation qui ne lui était pas destinée — les invitations sont nominatives, adossées à
l'adresse e-mail.

## Parcours d'entrée

1. **Connexion / inscription** — e-mail + mot de passe, Google, ou Microsoft.
2. **Onboarding** — le compte n'appartient à aucune organisation :
   - une invitation l'attend (son adresse a été invitée) → bouton *Rejoindre* ;
   - sinon il crée son organisation et en devient **propriétaire**.
3. **Plan de travail** — le menu en haut à droite affiche l'organisation, le rôle, et permet
   d'**inviter un collègue** (propriétaires et administrateurs uniquement).

## Rôles

| Rôle | Peut |
|---|---|
| `proprietaire` | tout, y compris inviter et modifier l'organisation |
| `administrateur` | inviter des membres, modifier l'organisation |
| `membre` | lire et écrire les réclamations, patterns et rapports |

## Ce que fait le serveur

`server/index.ts` n'utilise plus la `service_role` pour les données métier dès que
l'authentification est active. Chaque requête API porte le jeton de la session
(`Authorization: Bearer …`), et le serveur ouvre un client Supabase **avec ce jeton** : la
RLS s'applique donc côté serveur aussi. Autrement dit, l'API ne peut rien lire ni écrire que
l'utilisateur connecté ne pourrait faire lui-même. Une requête sans jeton reçoit `401` dès
que `SUPABASE_ANON_KEY` est renseignée.
