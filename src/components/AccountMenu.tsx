import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Loader2, LogOut, UserPlus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export function AccountMenu() {
  const { email, organisation, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (!organisation) return null;

  const canInvite = organisation.role === 'proprietaire' || organisation.role === 'administrateur';

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseBrowser) return;
    setBusy(true);
    setFeedback(null);

    const { error } = await supabaseBrowser.from('invitations').insert({
      organisation_id: organisation.id,
      email: invite.trim().toLowerCase(),
      role: 'membre',
    });

    setBusy(false);
    if (error) {
      // 23505 = violation d'unicité : une invitation est déjà en attente pour cette adresse.
      setFeedback({
        ok: false,
        message: error.code === '23505'
          ? 'Une invitation est déjà en attente pour cette adresse.'
          : error.message,
      });
      return;
    }

    setInvite('');
    setFeedback({
      ok: true,
      message: "Invitation enregistrée. La personne la verra en créant son compte avec cette adresse.",
    });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-line-soft bg-surface hover:bg-elevated transition-colors"
      >
        <Building2 className="w-3.5 h-3.5 text-ink-faint" />
        <span className="text-[12.5px] font-medium max-w-[12rem] truncate">{organisation.nom}</span>
        <ChevronDown className="w-3.5 h-3.5 text-ink-faint" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 z-40 rounded-xl border border-line bg-surface shadow-2xl p-4">
          <div className="pb-3 border-b border-line-soft">
            <div className="text-[13px] font-semibold truncate">{organisation.nom}</div>
            <div className="text-[12px] text-ink-faint truncate mt-0.5">{email}</div>
            <div className="font-mono text-[10.5px] uppercase tracking-wide text-ink-faint mt-1.5">
              rôle : {organisation.role}
            </div>
          </div>

          {canInvite && (
            <form onSubmit={sendInvite} className="pt-3 pb-1">
              <label className="text-[12.5px] font-medium text-ink flex items-center gap-1.5 mb-2">
                <UserPlus className="w-3.5 h-3.5" /> Inviter un collègue
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  required
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="collegue@banque.cm"
                  className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-line bg-elevated text-ink text-[12.5px] outline-none focus-visible:border-accent"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="px-3 py-2 rounded-lg text-[12.5px] font-semibold disabled:opacity-50 shrink-0"
                  style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Inviter'}
                </button>
              </div>

              {feedback && (
                <p
                  className="text-[11.5px] mt-2 flex items-start gap-1.5"
                  style={{ color: feedback.ok ? 'var(--color-success)' : 'var(--color-danger-critical)' }}
                >
                  {feedback.ok && <Check className="w-3.5 h-3.5 shrink-0 mt-px" />}
                  {feedback.message}
                </p>
              )}
            </form>
          )}

          <button
            onClick={() => void signOut()}
            className="w-full mt-3 pt-3 border-t border-line-soft inline-flex items-center gap-2 text-[12.5px] text-ink-soft hover:text-ink transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
