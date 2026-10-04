import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/**
 * Client navigateur, avec la clé *anonyme* — publique par conception. Ce qui protège les
 * données n'est pas le secret de cette clé mais la RLS PostgreSQL (voir
 * supabase/002_organisations.sql) : sans session valide, aucune ligne n'est lisible.
 *
 * Reste `null` tant que SUPABASE_URL / SUPABASE_ANON_KEY ne sont pas renseignées — l'appli
 * bascule alors en mode démo sans comptes, plutôt que d'afficher un écran de connexion mort.
 */
export const supabaseBrowser: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Indispensable pour OAuth : le jeton revient dans le fragment de l'URL de retour.
          detectSessionInUrl: true,
        },
      })
    : null;

export const authConfigured = supabaseBrowser !== null;

export type OAuthProvider = 'google' | 'azure';

/**
 * Fournisseurs OAuth réellement activés sur le projet Supabase (réglages publics de l'API
 * d'authentification). Proposer un fournisseur inactif envoie l'utilisateur sur une page
 * d'erreur JSON de supabase.co, sans retour possible vers l'application — on ne montre donc
 * que ceux qui répondront. En cas d'échec de lecture, aucun n'est proposé : si l'API
 * d'authentification est injoignable, OAuth ne fonctionnerait pas davantage.
 */
export async function fetchEnabledOAuthProviders(): Promise<OAuthProvider[]> {
  if (!url || !anonKey) return [];
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!res.ok) return [];
    const { external } = (await res.json()) as { external?: Record<string, boolean> };
    return (['google', 'azure'] as const).filter((p) => external?.[p] === true);
  } catch {
    return [];
  }
}
