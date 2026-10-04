-- Sentinelle — acceptation d'invitation atomique (à exécuter APRÈS 003_creation_organisation.sql).
-- Supabase → SQL Editor → New query → Run.
--
-- Corrige trois défauts de 002, tous liés au fait que l'invité écrivait lui-même dans
-- `membres` et `invitations` :
--
-- 1. Escalade de privilèges. La policy `membres_insert` vérifiait *qui* s'inscrivait et *où*,
--    jamais *avec quel rôle* : un compte invité comme « membre » pouvait s'insérer directement
--    comme « proprietaire ».
--
-- 2. Invitation modifiable par l'invité. `invit_update` lui laissait toute la ligne : il
--    pouvait relever son rôle ou repousser `expires_at` avant d'accepter.
--
-- 3. Reprise d'une organisation vide. La branche `organisation_sans_membre` ne servait plus
--    depuis 003 (la création passe par `creer_organisation`), mais elle laissait n'importe
--    quel compte connaissant l'identifiant d'une organisation dont tous les membres étaient
--    partis s'y inscrire — et lire tout son portefeuille.
--
-- L'acceptation passe maintenant par une seule fonction, qui lit le rôle dans l'invitation
-- au lieu de le recevoir du client. Plus aucun compte n'écrit directement dans `membres`.

create or replace function accepter_invitation(p_invitation uuid)
returns membres
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invitations;
  adhesion membres;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  -- L'invitation doit être nominative (adresse du jeton), en attente et non expirée.
  -- FOR UPDATE : deux acceptations simultanées ne peuvent pas la consommer deux fois.
  select * into inv
  from invitations i
  where i.id = p_invitation
    and lower(i.email) = lower(auth.jwt() ->> 'email')
    and i.accepted_at is null
    and i.expires_at > now()
  for update;

  if not found then
    raise exception 'Invitation introuvable, expirée ou destinée à une autre adresse'
      using errcode = '42501';
  end if;

  -- Déjà membre : on garde le rôle existant plutôt que de l'écraser par celui de l'invitation.
  insert into membres (organisation_id, user_id, role)
  values (inv.organisation_id, auth.uid(), inv.role)
  on conflict (organisation_id, user_id) do nothing;

  select * into adhesion
  from membres m
  where m.organisation_id = inv.organisation_id and m.user_id = auth.uid();

  update invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  return adhesion;
end;
$$;

revoke all on function accepter_invitation(uuid) from public, anon;
grant execute on function accepter_invitation(uuid) to authenticated;

-- Les adhésions ne naissent plus que de `creer_organisation` et `accepter_invitation`.
drop policy if exists membres_insert on membres;

-- L'invité n'a plus à modifier son invitation : la fonction s'en charge.
drop policy if exists invit_update on invitations;
create policy invit_update on invitations for update
  using (a_role_admin(organisation_id))
  with check (a_role_admin(organisation_id));

-- Plus référencée par aucune policy.
drop function if exists organisation_sans_membre(uuid);
