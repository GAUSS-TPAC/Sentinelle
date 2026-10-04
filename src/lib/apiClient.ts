import { supabaseBrowser } from './supabaseBrowser';

/**
 * Appel à l'API Sentinelle avec le jeton de la session en cours. Le serveur s'en sert pour
 * ouvrir un client Supabase sous RLS : sans ce jeton, il ne renvoie rien dès que
 * l'authentification est configurée. `getSession()` rafraîchit le jeton au besoin, donc on
 * le relit à chaque appel plutôt que de le mémoriser.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let token: string | undefined;
  if (supabaseBrowser) {
    const { data } = await supabaseBrowser.auth.getSession();
    token = data.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, { ...init, headers });
  if (res.status !== 401 || !supabaseBrowser || !token) return res;

  // Le serveur refuse un jeton que le navigateur croyait valide (session révoquée, horloge
  // décalée). On tente un rafraîchissement ; s'il échoue, on ferme la session locale pour
  // renvoyer vers l'écran de connexion plutôt que de laisser tout échouer en silence.
  const { data: refreshed } = await supabaseBrowser.auth.refreshSession();
  const renewed = refreshed.session?.access_token;
  if (!renewed) {
    await supabaseBrowser.auth.signOut({ scope: 'local' });
    return res;
  }
  headers.set('Authorization', `Bearer ${renewed}`);
  return fetch(path, { ...init, headers });
}
