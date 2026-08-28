import { useState } from 'react';
import { AlertTriangle, Building2, Loader2, LogOut, MailCheck } from 'lucide-react';
import { useAuth, type PendingInvitation } from '@/auth/AuthProvider';

const PAYS_CEMAC = [
  'Cameroun', 'Gabon', 'Congo', 'Tchad', 'Centrafrique', 'Guinée équatoriale',
];

export function OnboardingScreen() {
  const { email, invitations, createOrganisation, acceptInvitation, signOut } = useAuth();
  const [nom, setNom] = useState('');
  const [pays, setPays] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('creation');
    try {
      await createOrganisation(nom.trim(), pays);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création de l'organisation impossible");
    } finally {
      setBusy(null);
    }
  };

  const accept = async (invitation: PendingInvitation) => {
    setError(null);
    setBusy(invitation.id);
    try {
      await acceptInvitation(invitation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de rejoindre l'organisation");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-base text-ink font-sans flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <span className="text-[12.5px] text-ink-soft truncate">{email}</span>
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-faint hover:text-ink transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Se déconnecter
          </button>
        </div>

        {error && (
          <div
            className="flex items-start gap-2 px-3.5 py-2.5 mb-4 rounded-lg border border-line text-[12.5px] text-danger-critical"
            style={{ backgroundColor: 'color-mix(in oklch, var(--color-danger-critical) 10%, var(--color-surface))' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        {invitations.length > 0 && (
          <section className="mb-8">
            <h1 className="text-[17px] font-semibold tracking-tight">Une invitation t'attend</h1>
            <p className="text-[13px] text-ink-soft mt-1 mb-4">
              Rejoins l'organisation qui t'a invité pour accéder à son portefeuille de réclamations.
            </p>

            <div className="flex flex-col gap-2.5">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-line bg-surface"
                >
                  <MailCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium truncate">{inv.organisation_nom}</div>
                    <div className="font-mono text-[11px] text-ink-faint">rôle : {inv.role}</div>
                  </div>
                  <button
                    onClick={() => void accept(inv)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-50"
                    style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}
                  >
                    {busy === inv.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Rejoindre
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-7 mb-1">
              <span className="h-px flex-1 bg-line-soft" />
              <span className="font-mono text-[10.5px] uppercase tracking-wide text-ink-faint">ou</span>
              <span className="h-px flex-1 bg-line-soft" />
            </div>
          </section>
        )}

        <section>
          <h1 className="text-[17px] font-semibold tracking-tight">
            {invitations.length > 0 ? 'Créer ta propre organisation' : 'Crée ton organisation'}
          </h1>
          <p className="text-[13px] text-ink-soft mt-1 mb-5">
            Les réclamations, patterns et rapports appartiennent à l'organisation — tes collègues
            invités y accèdent, et rien n'est perdu si un compte est supprimé.
          </p>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink">Nom de l'établissement</span>
              <input
                required
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-line bg-elevated text-ink text-[13px] outline-none focus-visible:border-accent"
                placeholder="Ex. Afriland First Bank"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink">Pays (facultatif)</span>
              <select
                value={pays}
                onChange={(e) => setPays(e.target.value)}
                className="px-3 py-2.5 rounded-lg border border-line bg-elevated text-ink text-[13px] outline-none focus-visible:border-accent"
              >
                <option value="">— non précisé —</option>
                {PAYS_CEMAC.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={busy !== null || nom.trim() === ''}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 mt-1 rounded-lg text-[13px] font-semibold disabled:opacity-50 transition-colors"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}
            >
              {busy === 'creation' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
              Créer l'organisation
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
