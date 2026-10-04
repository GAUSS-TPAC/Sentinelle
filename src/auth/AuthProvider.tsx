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
  /** Vrai après un clic sur le lien « mot de passe oublié » : il reste à en choisir un nouveau. */
  passwordRecovery: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithOAuth: (provider: 'google' | 'azure') => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
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
    'New password should be different from the old password.':
      "Le nouveau mot de passe doit être différent de l'ancien.",
    'Email link is invalid or has expired': 'Lien invalide ou expiré — redemande-en un.',
    'Could not find the function public.creer_organisation(p_nom, p_pays) in the schema cache':
      'Schéma incomplet : exécute supabase/003_creation_organisation.sql dans Supabase.',
  };
  return map[message] ?? message;
}

/**
 * Lit ce que Supabase a laissé dans l'URL de retour, avant que le client ne la nettoie :
 * un échec OAuth ou un lien expiré revient en `error_description`, un lien de
 * réinitialisation en `type=recovery`. Sans cette lecture, un retour en erreur réaffiche
 * l'écran de connexion sans un mot.
 */
function readAuthReturn(): { error: string | null; recovery: boolean } {
  if (typeof window === 'undefined') return { error: null, recovery: false };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(window.location.search);
  const description = hash.get('error_description') ?? query.get('error_description');
  return {
    error: description ? frenchify(description) : null,
    recovery: hash.get('type') === 'recovery',
  };
}

const authReturn = readAuthReturn();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [sessionLoading, setSessionLoading] = useState(authConfigured);
  // Compte pour lequel l'organisation a déjà été résolue. Tant qu'il diffère du compte
  // connecté, on ne sait pas encore s'il faut l'onboarding : l'afficher trop tôt montrerait
  // « Crée ton organisation » à un membre existant, qui pourrait en créer une seconde.
  const [resolvedFor, setResolvedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(authReturn.error);
  const [passwordRecovery, setPasswordRecovery] = useState(authReturn.recovery);

  const email = session?.user.email ?? null;
  const userId = session?.user.id ?? null;
  const loading = sessionLoading || (userId !== null && resolvedFor !== userId);

  // Session : état initial + abonnement aux changements (connexion, déconnexion, retour
  // OAuth, rafraîchissement du jeton).
  useEffect(() => {
    if (!supabaseBrowser) return;
    let active = true;

    void supabaseBrowser.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionLoading(false);
    });

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (!next) {
        setOrganisation(null);
        setInvitations([]);
        setResolvedFor(null);
        setPasswordRecovery(false);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /** Résout l'organisation du compte, ou à défaut les invitations qui l'attendent. */
  const refreshOrganisation = useCallback(async () => {
    if (!supabaseBrowser || !userId) return;

    const { data: membre, error: membreError } = await supabaseBrowser
      .from('membres')
      .select('role, organisations ( id, nom, pays )')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (membreError) {
      setError(frenchify(membreError.message));
      setResolvedFor(userId);
      return;
    }

    if (membre?.organisations) {
      const org = membre.organisations as unknown as { id: string; nom: string; pays: string | null };
      setOrganisation({ ...org, role: membre.role as MembreRole });
      setInvitations([]);
      setResolvedFor(userId);
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
    setResolvedFor(userId);
  }, [userId]);

  // Indexé sur le compte, pas sur l'objet session : celui-ci change à chaque
  // rafraîchissement de jeton, ce qui relancerait la résolution pour rien.
  useEffect(() => {
    if (userId) void refreshOrganisation();
  }, [userId, refreshOrganisation]);

  const signInWithPassword = useCallback(async (mail: string, password: string) => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.signInWithPassword({ email: mail, password });
    if (err) throw new Error(frenchify(err.message));
  }, []);

  const signUpWithPassword = useCallback(async (mail: string, password: string) => {
    if (!supabaseBrowser) return { needsConfirmation: false };
    setError(null);
    // Sans `emailRedirectTo`, le lien de confirmation pointe sur la « Site URL » du projet
    // Supabase — donc sur localhost si elle n'a pas été mise à jour après le déploiement.
    const { data, error: err } = await supabaseBrowser.auth.signUp({
      email: mail,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
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

  const requestPasswordReset = useCallback(async (mail: string) => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.resetPasswordForEmail(mail, {
      redirectTo: window.location.origin,
    });
    if (err) throw new Error(frenchify(err.message));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.updateUser({ password });
    if (err) throw new Error(frenchify(err.message));
    setPasswordRecovery(false);
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
      passwordRecovery,
      signInWithPassword,
      signUpWithPassword,
      signInWithOAuth,
      requestPasswordReset,
      updatePassword,
      signOut,
      createOrganisation,
      acceptInvitation,
      refreshOrganisation,
      clearError: () => setError(null),
    }),
    [
      loading, session, email, organisation, invitations, error, passwordRecovery,
      signInWithPassword, signUpWithPassword, signInWithOAuth, requestPasswordReset,
      updatePassword, signOut, createOrganisation, acceptInvitation, refreshOrganisation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
