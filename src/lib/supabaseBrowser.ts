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
