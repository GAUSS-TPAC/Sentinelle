import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { authConfigured, supabaseBrowser } from '@/lib/supabaseBrowser';

export type MembreRole = 'proprietaire' | 'administrateur' | 'membre';

export type Organisation = {
  id: string;
  nom: string;
  pays: string | null;
  role: MembreRole;
};

export type PendingInvitation = {
  id: string;
  organisation_id: string;
  organisation_nom: string;
  role: Exclude<MembreRole, 'proprietaire'>;
};

export type AuthState = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  email: string | null;
  organisation: Organisation | null;
  invitations: PendingInvitation[];
  error: string | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithOAuth: (provider: 'google' | 'azure') => Promise<void>;
  signOut: () => Promise<void>;
  createOrganisation: (nom: string, pays: string) => Promise<void>;
  acceptInvitation: (invitation: PendingInvitation) => Promise<void>;
  refreshOrganisation: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

/** Traduit les messages d'erreur Supabase les plus fréquents, qui sont en anglais. */
function frenchify(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'Adresse e-mail ou mot de passe incorrect.',
    'Email not confirmed': "Adresse e-mail non confirmée — ouvre le lien reçu par e-mail.",
    'User already registered': 'Un compte existe déjà avec cette adresse. Connecte-toi.',
    'Password should be at least 6 characters':
      'Le mot de passe doit faire au moins 6 caractères.',
    'Unable to validate email address: invalid format': "Format d'adresse e-mail invalide.",
    'Could not find the function public.creer_organisation(p_nom, p_pays) in the schema cache':
      'Schéma incomplet : exécute supabase/003_creation_organisation.sql dans Supabase.',
  };
  return map[message] ?? message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(authConfigured);
  const [error, setError] = useState<string | null>(null);

  const email = session?.user.email ?? null;

  // Session : état initial + abonnement aux changements (connexion, déconnexion, retour
  // OAuth, rafraîchissement du jeton).
  useEffect(() => {
    if (!supabaseBrowser) return;
    let active = true;

    void supabaseBrowser.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        setOrganisation(null);
        setInvitations([]);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /** Résout l'organisation du compte, ou à défaut les invitations qui l'attendent. */
  const refreshOrganisation = useCallback(async () => {
    if (!supabaseBrowser || !session) return;

    const { data: membre, error: membreError } = await supabaseBrowser
      .from('membres')
      .select('role, organisations ( id, nom, pays )')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membreError) {
      setError(frenchify(membreError.message));
      return;
    }

    if (membre?.organisations) {
      const org = membre.organisations as unknown as { id: string; nom: string; pays: string | null };
      setOrganisation({ ...org, role: membre.role as MembreRole });
      setInvitations([]);
      return;
    }

    setOrganisation(null);

    // Sans organisation, on regarde si quelqu'un a déjà invité cette adresse.
    const { data: invits } = await supabaseBrowser
      .from('invitations')
      .select('id, organisation_id, role, organisations ( nom )')
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString());

    setInvitations(
      (invits ?? []).map((i) => {
        const org = i.organisations as unknown as { nom?: string } | null;
        return {
          id: i.id as string,
          organisation_id: i.organisation_id as string,
          organisation_nom: org?.nom ?? 'Organisation',
          role: i.role as Exclude<MembreRole, 'proprietaire'>,
        };
      }),
    );
  }, [session]);

  useEffect(() => {
    if (session) void refreshOrganisation();
  }, [session, refreshOrganisation]);

  const signInWithPassword = useCallback(async (mail: string, password: string) => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.signInWithPassword({ email: mail, password });
    if (err) throw new Error(frenchify(err.message));
  }, []);

  const signUpWithPassword = useCallback(async (mail: string, password: string) => {
    if (!supabaseBrowser) return { needsConfirmation: false };
    setError(null);
    const { data, error: err } = await supabaseBrowser.auth.signUp({ email: mail, password });
    if (err) throw new Error(frenchify(err.message));
    // Session absente = Supabase attend la confirmation de l'adresse par e-mail.
    return { needsConfirmation: data.session === null };
  }, []);

  const signInWithOAuth = useCallback(async (provider: 'google' | 'azure') => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (err) throw new Error(frenchify(err.message));
  }, []);

  const signOut = useCallback(async () => {
    if (!supabaseBrowser) return;
    await supabaseBrowser.auth.signOut();
  }, []);

  const createOrganisation = useCallback(async (nom: string, pays: string) => {
    if (!supabaseBrowser || !session) return;
    setError(null);

    // Passe par la fonction SQL plutôt que par deux insertions : créer l'organisation puis
    // s'y rattacher côté client échouait, la lecture de la ligne créée exigeant une
    // adhésion qui n'existait pas encore (voir supabase/003_creation_organisation.sql).
    const { data, error: rpcError } = await supabaseBrowser
      .rpc('creer_organisation', { p_nom: nom, p_pays: pays || null })
      .single();
    if (rpcError) throw new Error(frenchify(rpcError.message));

    const org = data as { id: string; nom: string; pays: string | null };
    setOrganisation({ ...org, role: 'proprietaire' });
    setInvitations([]);
  }, [session]);

  const acceptInvitation = useCallback(async (invitation: PendingInvitation) => {
    if (!supabaseBrowser || !session) return;
    setError(null);

    const { error: membreError } = await supabaseBrowser
      .from('membres')
      .insert({
        organisation_id: invitation.organisation_id,
        user_id: session.user.id,
        role: invitation.role,
      });
    if (membreError) throw new Error(frenchify(membreError.message));

    await supabaseBrowser
      .from('invitations')
      .update({ accepted_at: new Date().toISOString(), accepted_by: session.user.id })
      .eq('id', invitation.id);

    await refreshOrganisation();
  }, [session, refreshOrganisation]);

  const value = useMemo<AuthState>(
    () => ({
      configured: authConfigured,
      loading,
      session,
      email,
      organisation,
      invitations,
      error,
      signInWithPassword,
      signUpWithPassword,
      signInWithOAuth,
      signOut,
      createOrganisation,
      acceptInvitation,
      refreshOrganisation,
      clearError: () => setError(null),
    }),
    [
      loading, session, email, organisation, invitations, error, signInWithPassword,
      signUpWithPassword, signInWithOAuth, signOut, createOrganisation, acceptInvitation,
      refreshOrganisation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
