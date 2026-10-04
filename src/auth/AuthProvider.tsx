import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  authConfigured, fetchEnabledOAuthProviders, supabaseBrowser, type OAuthProvider,
} from '@/lib/supabaseBrowser';

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
  /**
   * L'organisation du compte n'a pas pu être lue (réseau, schéma). Distinct de « aucune
   * organisation » : dans ce cas on ne sait pas, et proposer d'en créer une ferait ouvrir une
   * seconde organisation à un membre existant.
   */
  organisationError: string | null;
  invitations: PendingInvitation[];
  /** Fournisseurs OAuth activés côté Supabase — seuls ceux-là ont un bouton. */
  oauthProviders: OAuthProvider[];
  error: string | null;
  /** Vrai après un clic sur le lien « mot de passe oublié » : il reste à en choisir un nouveau. */
  passwordRecovery: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  createOrganisation: (nom: string, pays: string) => Promise<void>;
  acceptInvitation: (invitation: PendingInvitation) => Promise<void>;
  refreshOrganisation: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

type ErrorLike = { message?: string; code?: string; name?: string };

/**
 * Messages par code d'erreur Supabase. Le code est stable ; le texte anglais, lui, change
 * d'une version à l'autre (ponctuation, longueur minimale du mot de passe…), et une
 * correspondance sur le texte laissait alors passer le message en anglais.
 */
const MESSAGES_PAR_CODE: Record<string, string> = {
  invalid_credentials: 'Adresse e-mail ou mot de passe incorrect.',
  email_not_confirmed: "Adresse e-mail non confirmée — ouvre le lien reçu par e-mail.",
  user_already_exists: 'Un compte existe déjà avec cette adresse. Connecte-toi.',
  email_exists: 'Un compte existe déjà avec cette adresse. Connecte-toi.',
  weak_password: 'Mot de passe trop faible — choisis-en un plus long.',
  same_password: "Le nouveau mot de passe doit être différent de l'ancien.",
  otp_expired: 'Lien invalide ou expiré — redemande-en un.',
  email_address_invalid: "Format d'adresse e-mail invalide.",
  email_address_not_authorized:
    "L'envoi d'e-mails vers cette adresse n'est pas autorisé par la configuration du projet (SMTP Supabase par défaut).",
  over_email_send_rate_limit: "Trop d'e-mails envoyés — réessaie dans quelques minutes.",
  over_request_rate_limit: 'Trop de tentatives — réessaie dans quelques minutes.',
  signup_disabled: 'Les inscriptions sont fermées sur ce projet.',
  provider_disabled: "Ce mode de connexion n'est pas activé.",
  user_banned: 'Ce compte est suspendu.',
  session_expired: 'Session expirée — reconnecte-toi.',
};

/** Repli sur le texte, pour les erreurs qui n'ont pas de code (retours d'URL anciens, PostgREST). */
const MESSAGES_PAR_TEXTE: Record<string, string> = {
  'Invalid login credentials': MESSAGES_PAR_CODE.invalid_credentials,
  'Email not confirmed': MESSAGES_PAR_CODE.email_not_confirmed,
  'User already registered': MESSAGES_PAR_CODE.user_already_exists,
  'Email link is invalid or has expired': MESSAGES_PAR_CODE.otp_expired,
};

const RESEAU = 'Connexion au service impossible — vérifie ton réseau, puis réessaie.';

/** Traduit une erreur Supabase (authentification ou base) en message lisible. */
function frenchify(error: ErrorLike | string, code?: string | null): string {
  const err: ErrorLike = typeof error === 'string' ? { message: error } : error;
  const message = err.message ?? '';
  const known = MESSAGES_PAR_CODE[code ?? err.code ?? ''];
  if (known) return known;

  // PGRST202 = fonction absente du cache de schéma : une migration n'a pas été exécutée.
  if (err.code === 'PGRST202' || message.includes('in the schema cache')) {
    if (message.includes('accepter_invitation')) {
      return 'Schéma incomplet : exécute supabase/004_acceptation_invitation.sql dans Supabase.';
    }
    if (message.includes('creer_organisation')) {
      return 'Schéma incomplet : exécute supabase/003_creation_organisation.sql dans Supabase.';
    }
  }
  if (err.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|load failed/i.test(message)) {
    return RESEAU;
  }
  return MESSAGES_PAR_TEXTE[message] ?? (message || 'Erreur inattendue.');
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
  const code = hash.get('error_code') ?? query.get('error_code');

  // L'erreur est lue une fois : on la retire de l'URL, sinon chaque rechargement de la page
  // la réafficherait alors que l'utilisateur est passé à autre chose.
  if (description) window.history.replaceState(null, '', window.location.pathname);

  return {
    error: description ? frenchify(description, code) : null,
    recovery: hash.get('type') === 'recovery',
  };
}

const authReturn = readAuthReturn();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [organisationError, setOrganisationError] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
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
        setOrganisationError(null);
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

  useEffect(() => {
    let active = true;
    void fetchEnabledOAuthProviders().then((providers) => {
      if (active) setOauthProviders(providers);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Résout l'organisation du compte, ou à défaut les invitations qui l'attendent. */
  const refreshOrganisation = useCallback(async () => {
    if (!supabaseBrowser || !userId) return;

    // Un échec de lecture n'est pas une absence d'organisation. On le garde à part, et dans
    // tous les cas `resolvedFor` est posé : sans cela l'écran resterait sur le chargement.
    const echec = (err: ErrorLike) => {
      setOrganisationError(frenchify(err));
      setResolvedFor(userId);
    };

    let membre: { role: unknown; organisations: unknown } | null;
    try {
      const { data, error: membreError } = await supabaseBrowser
        .from('membres')
        .select('role, organisations ( id, nom, pays )')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (membreError) return echec(membreError);
      membre = data;
    } catch (err) {
      return echec(err as ErrorLike);
    }

    if (membre?.organisations) {
      const org = membre.organisations as unknown as { id: string; nom: string; pays: string | null };
      setOrganisation({ ...org, role: membre.role as MembreRole });
      setOrganisationError(null);
      setInvitations([]);
      setResolvedFor(userId);
      return;
    }

    // Sans organisation, on regarde si quelqu'un a déjà invité cette adresse. Un échec ici
    // compte aussi : sans la liste, un invité se verrait proposer de créer sa propre
    // organisation au lieu de rejoindre celle qui l'attend.
    let invits: Array<{ id: unknown; organisation_id: unknown; role: unknown; organisations: unknown }>;
    try {
      const { data, error: invitError } = await supabaseBrowser
        .from('invitations')
        .select('id, organisation_id, role, organisations ( nom )')
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString());
      if (invitError) return echec(invitError);
      invits = data ?? [];
    } catch (err) {
      return echec(err as ErrorLike);
    }

    setOrganisation(null);
    setOrganisationError(null);
    setInvitations(
      invits.map((i) => {
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
    if (err) throw new Error(frenchify(err));
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
    if (err) throw new Error(frenchify(err));
    // Session absente = Supabase attend la confirmation de l'adresse par e-mail.
    return { needsConfirmation: data.session === null };
  }, []);

  const signInWithOAuth = useCallback(async (provider: OAuthProvider) => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (err) throw new Error(frenchify(err));
  }, []);

  const requestPasswordReset = useCallback(async (mail: string) => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.resetPasswordForEmail(mail, {
      redirectTo: window.location.origin,
    });
    if (err) throw new Error(frenchify(err));
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    if (!supabaseBrowser) return;
    setError(null);
    const { error: err } = await supabaseBrowser.auth.updateUser({ password });
    if (err) throw new Error(frenchify(err));
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
    if (rpcError) throw new Error(frenchify(rpcError));

    const org = data as { id: string; nom: string; pays: string | null };
    setOrganisation({ ...org, role: 'proprietaire' });
    setOrganisationError(null);
    setInvitations([]);
  }, [session]);

  const acceptInvitation = useCallback(async (invitation: PendingInvitation) => {
    if (!supabaseBrowser || !session) return;
    setError(null);

    // Le rôle est lu dans l'invitation par la fonction SQL, jamais envoyé par le navigateur :
    // l'insertion directe dans `membres` laissait l'invité choisir son propre rôle
    // (voir supabase/004_acceptation_invitation.sql).
    const { error: rpcError } = await supabaseBrowser.rpc('accepter_invitation', {
      p_invitation: invitation.id,
    });
    if (rpcError) throw new Error(frenchify(rpcError));

    await refreshOrganisation();
  }, [session, refreshOrganisation]);

  const value = useMemo<AuthState>(
    () => ({
      configured: authConfigured,
      loading,
      session,
      email,
      organisation,
      organisationError,
      invitations,
      oauthProviders,
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
      loading, session, email, organisation, organisationError, invitations, oauthProviders, error,
      passwordRecovery,
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
