# Déploiement — mode Cloud (démo publique)

Un seul service (Express sert l'API + le build Vite). Le mode auto-hébergé
(Ollama) reste local, pas déployé publiquement — voir README.

## Railway (recommandé)

1. **Créer un compte** sur [railway.app](https://railway.app) (via GitHub — manuel, je ne peux pas le faire à ta place).
2. **New Project → Deploy from GitHub repo** → sélectionner `GAUSS-TPAC/Sentinelle`.
3. Railway détecte Node automatiquement. Vérifier/forcer dans **Settings** :
   - **Build command** : `npm run build`
   - **Start command** : `npm run start`
4. **Variables d'environnement** (Settings → Variables) :
   | Variable | Valeur |
   |---|---|
   | `GEMINI_API_KEY` | ta clé Gemini réelle |
   | `AI_PROVIDER` | `gemini` (ou `auto` si tu ajoutes d'autres clés) |
   | `PORT` | laisser vide — Railway l'injecte automatiquement, `API_PORT` dans le code le respecte déjà via `process.env.PORT` en repli |
5. **Deploy**. Railway donne une URL publique `https://<projet>.up.railway.app`.
6. Vérifier : `curl https://<ton-url>/api/health` doit répondre `{"ok":true,...}`.

## Alternative : Render

Mêmes étapes, presque identiques :
1. Compte sur [render.com](https://render.com) (GitHub).
2. **New → Web Service** → repo `GAUSS-TPAC/Sentinelle`.
3. **Build command** : `npm run build` · **Start command** : `npm run start`.
4. Mêmes variables d'environnement que ci-dessus, dans l'onglet **Environment**.
5. Render assigne `PORT` automatiquement aussi — même compatibilité.

## Ce que je ne peux pas faire à ta place

- Créer le compte Railway/Render (authentification tierce).
- Fournir la vraie clé Gemini (secret).
- Relier un domaine personnalisé si tu en veux un (étape optionnelle côté DNS).

## Après déploiement

- Le mode `selfhosted` (Ollama) ne sera **pas** accessible depuis ce déploiement cloud — c'est voulu, il reste une démo locale sur ta machine (argument "souveraineté des données" : le client final héberge Ollama chez lui, pas sur Railway).
- Le sélecteur de provider dans l'UI déployée devrait donc rester sur "Cloud (Gemini)" en démo publique ; montrer "Auto-hébergé" en local, sur ta machine, avec Ollama qui tourne.
