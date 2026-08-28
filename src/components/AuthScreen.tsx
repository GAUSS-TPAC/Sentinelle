import { useState } from 'react';
import { AlertTriangle, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';

function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
      <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
      <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
      <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
    </svg>
  );
}

const OAUTH_BUTTON =
  'flex items-center justify-center gap-2.5 w-full px-4 py-2.5 rounded-lg border border-line bg-surface text-ink text-[13px] font-medium hover:bg-elevated transition-colors disabled:opacity-50';

export function AuthScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithOAuth } = useAuth();
  const [mode, setMode] = useState<'connexion' | 'inscription'>('connexion');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy('email');
    try {
      if (mode === 'connexion') {
        await signInWithPassword(email.trim(), password);
      } else {
        const { needsConfirmation } = await signUpWithPassword(email.trim(), password);
        if (needsConfirmation) {
          setNotice(
            `Compte créé. Ouvre le lien de confirmation envoyé à ${email.trim()} pour activer l'accès.`,
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la connexion');
    } finally {
      setBusy(null);
    }
  };

  const oauth = async (provider: 'google' | 'azure') => {
    setError(null);
    setBusy(provider);
    try {
      await signInWithOAuth(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la connexion');
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-base text-ink font-sans flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-7">
          <div className="w-9 h-9 rounded-[9px] bg-elevated border border-line flex items-center justify-center shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="7" r="2.4" />
              <path d="M12 9.4 V13 M12 13 L6.5 19 M12 13 L12 19.5 M12 13 L17.5 19" />
              <circle cx="6.5" cy="19.6" r="1.3" />
              <circle cx="12" cy="20.1" r="1.3" />
              <circle cx="17.5" cy="19.6" r="1.3" />
            </svg>
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight leading-tight">Racine</div>
            <div className="font-mono text-[10.5px] tracking-wide uppercase text-ink-faint mt-0.5">
              Triage causal · zone CEMAC
            </div>
          </div>
        </div>

        <h1 className="text-[19px] font-semibold tracking-tight">
          {mode === 'connexion' ? 'Connexion' : 'Créer un compte'}
        </h1>
        <p className="text-[13px] text-ink-soft mt-1 mb-6">
          {mode === 'connexion'
            ? 'Accède au portefeuille de réclamations de ton établissement.'
            : "Crée ton compte, puis ton organisation — ou rejoins celle qui t'a invité."}
        </p>

        {error && (
          <div
            className="flex items-start gap-2 px-3.5 py-2.5 mb-4 rounded-lg border border-line text-[12.5px] text-danger-critical"
            style={{ backgroundColor: 'color-mix(in oklch, var(--color-danger-critical) 10%, var(--color-surface))' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div
            className="flex items-start gap-2 px-3.5 py-2.5 mb-4 rounded-lg border border-line text-[12.5px]"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-success) 10%, var(--color-surface))',
              color: 'var(--color-success)',
            }}
          >
            <Mail className="w-4 h-4 shrink-0 mt-px" />
            <span>{notice}</span>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <button className={OAUTH_BUTTON} disabled={busy !== null} onClick={() => void oauth('google')}>
            {busy === 'google' ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
            Continuer avec Google
          </button>
          <button className={OAUTH_BUTTON} disabled={busy !== null} onClick={() => void oauth('azure')}>
            {busy === 'azure' ? <Loader2 className="w-4 h-4 animate-spin" /> : <MicrosoftMark />}
            Continuer avec Microsoft
          </button>
        </div>

        <div className="flex items-center gap-3 my-5">
          <span className="h-px flex-1 bg-line-soft" />
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">ou</span>
          <span className="h-px flex-1 bg-line-soft" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink">Adresse e-mail</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-line bg-elevated text-ink text-[13px] outline-none focus-visible:border-accent"
              placeholder="prenom.nom@banque.cm"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink">Mot de passe</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'connexion' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="px-3 py-2.5 rounded-lg border border-line bg-elevated text-ink text-[13px] outline-none focus-visible:border-accent"
              placeholder="6 caractères minimum"
            />
          </label>

          <button
            type="submit"
            disabled={busy !== null}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-[13px] font-semibold disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}
          >
            {busy === 'email' && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'connexion' ? 'Se connecter' : 'Créer le compte'}
          </button>
        </form>

        <p className="text-[12.5px] text-ink-soft mt-5 text-center">
          {mode === 'connexion' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
          <button
            onClick={() => {
              setMode(mode === 'connexion' ? 'inscription' : 'connexion');
              setError(null);
              setNotice(null);
            }}
            className="font-medium underline underline-offset-2"
            style={{ color: 'var(--color-accent)' }}
          >
            {mode === 'connexion' ? 'Créer un compte' : 'Se connecter'}
          </button>
        </p>
      </div>
    </div>
  );
}
