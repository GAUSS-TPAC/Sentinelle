import { supabaseBrowser } from './supabaseBrowser';

/**
 * Appel à l'API Racine avec le jeton de la session en cours. Le serveur s'en sert pour
 * ouvrir un client Supabase sous RLS : sans ce jeton, il ne renvoie rien dès que
 * l'authentification est configurée. `getSession()` rafraîchit le jeton au besoin, donc on
 * le relit à chaque appel plutôt que de le mémoriser.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  if (supabaseBrowser) {
    const { data } = await supabaseBrowser.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(path, { ...init, headers });
}
