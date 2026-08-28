import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Voir la note plus bas sur le polyfill WebSocket.
const realtime = { transport: WebSocket as unknown as typeof globalThis.WebSocket };

// Client serveur uniquement — utilise la service_role key (bypass RLS), jamais exposée
// au navigateur. Reste `null` tant que Supabase n'est pas configuré : les routes API
// retombent alors sur le comportement 100% en mémoire (aucune régression si l'utilisateur
// n'a pas encore de projet Supabase).
//
// On ne se sert jamais du canal realtime (juste des requêtes REST via .from()), mais
// supabase-js initialise quand même son client realtime à la construction, qui exige un
// WebSocket global — absent par défaut avant Node 22. On fournit `ws` en polyfill pour
// rester compatible avec Node 20 (et tout hébergeur qui ne garantit pas Node 22+).
export const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime,
      })
    : null;

export const hasSupabase = Boolean(supabase);

/**
 * Client portant le jeton d'un utilisateur connecté : la RLS s'applique, donc le serveur ne
 * peut rien faire que l'utilisateur ne pourrait faire lui-même. C'est volontaire — la
 * service_role reste réservée aux cas où aucun compte n'existe (mode démo local).
 */
export function clientForAccessToken(accessToken: string): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    realtime,
  });
}

/** L'authentification n'est active que si la clé anonyme est fournie au serveur. */
export const hasSupabaseAuth = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
