-- Sentinelle — couche comptes / organisations (à exécuter APRÈS schema.sql).
-- Supabase → SQL Editor → New query → Run.
--
-- Modèle : un compte appartient à une ou plusieurs organisations (une banque). Les
-- réclamations et les patterns appartiennent à l'organisation, pas à l'utilisateur : deux
-- employés de la même banque travaillent sur le même portefeuille, et le départ d'un
-- employé n'emporte pas les données.

-- ============================================================ organisations et membres

create table if not exists organisations (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  pays text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table if not exists membres (
  organisation_id uuid not null references organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'membre'
    check (role in ('proprietaire', 'administrateur', 'membre')),
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create index if not exists idx_membres_user on membres (user_id);

create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisations (id) on delete cascade,
  email text not null,
  role text not null default 'membre' check (role in ('administrateur', 'membre')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);

-- Une seule invitation en attente par adresse et par organisation.
create unique index if not exists idx_invitations_en_attente
  on invitations (organisation_id, lower(email))
  where accepted_at is null;

create index if not exists idx_invitations_email on invitations (lower(email));

-- ============================================================ rattachement des données

alter table tickets
  add column if not exists organisation_id uuid references organisations (id) on delete cascade;
alter table patterns_detectes
  add column if not exists organisation_id uuid references organisations (id) on delete cascade;

create index if not exists idx_tickets_org on tickets (organisation_id);
create index if not exists idx_patterns_org on patterns_detectes (organisation_id);

-- `patterns_detectes.id` est un identifiant déterministe produit par detectPatterns()
-- (« pattern-volume-<catégorie> », « pattern-cobac-delai »), identique d'une organisation à
-- l'autre. En clé primaire seule, deux banques écraseraient mutuellement leurs patterns.
-- La clé devient donc composite (organisation_id, id).
--
-- ATTENTION : les lignes antérieures à cette migration n'ont pas d'organisation et sont
-- supprimées ici — il s'agit des patterns de test, régénérés au prochain classement.
delete from patterns_detectes where organisation_id is null;
delete from tickets where organisation_id is null;

alter table patterns_detectes alter column organisation_id set not null;
alter table tickets alter column organisation_id set not null;

alter table patterns_detectes drop constraint if exists patterns_detectes_pkey;
alter table patterns_detectes add primary key (organisation_id, id);

-- ============================================================ RLS

-- SECURITY DEFINER : sans cela, vérifier l'appartenance depuis une policy de `membres`
-- relancerait la RLS de `membres`, donc une récursion infinie. La fonction est STABLE et
-- son search_path est figé pour qu'elle ne puisse pas être détournée.
create or replace function est_membre(org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from membres m
    where m.organisation_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function a_role_admin(org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from membres m
    where m.organisation_id = org
      and m.user_id = auth.uid()
      and m.role in ('proprietaire', 'administrateur')
  );
$$;

-- Mêmes précautions pour les deux vérifications utilisées par la policy d'auto-rattachement :
-- les écrire en sous-requête directe dans une policy de `membres` relancerait la RLS de
-- `membres` (récursion) et celle de `invitations`.
create or replace function organisation_sans_membre(org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (select 1 from membres m where m.organisation_id = org);
$$;

create or replace function invitation_en_attente(org uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from invitations i
    where i.organisation_id = org
      and lower(i.email) = lower(auth.jwt() ->> 'email')
      and i.accepted_at is null
      and i.expires_at > now()
  );
$$;

alter table organisations enable row level security;
alter table membres enable row level security;
alter table invitations enable row level security;

-- organisations : visible aux membres ; créable par tout compte authentifié (l'onboarding
-- crée l'organisation puis s'y ajoute comme propriétaire) ; modifiable par les admins.
drop policy if exists org_select on organisations;
-- L'invité n'est pas encore membre : sans le second terme, il ne pourrait pas lire le nom
-- de l'organisation qui l'invite, et l'écran d'invitation n'afficherait qu'un identifiant.
create policy org_select on organisations for select using (
  est_membre(id) or invitation_en_attente(id)
);

drop policy if exists org_insert on organisations;
create policy org_insert on organisations for insert with check (auth.uid() is not null);

drop policy if exists org_update on organisations;
create policy org_update on organisations for update using (a_role_admin(id));

-- membres : chacun voit les membres de ses organisations. L'auto-rattachement à l'insertion
-- est autorisé uniquement pour soi-même — soit à la création de l'organisation, soit en
-- acceptant une invitation nominative encore valide.
drop policy if exists membres_select on membres;
create policy membres_select on membres for select using (est_membre(organisation_id));

drop policy if exists membres_insert on membres;
create policy membres_insert on membres for insert with check (
  a_role_admin(organisation_id)
  or (
    -- On ne peut s'inscrire que soi-même, et seulement dans une organisation qu'on vient de
    -- créer (encore sans membre) ou qui nous a nommément invité.
    user_id = auth.uid()
    and (organisation_sans_membre(organisation_id) or invitation_en_attente(organisation_id))
  )
);

drop policy if exists membres_delete on membres;
create policy membres_delete on membres for delete using (
  a_role_admin(organisation_id) or user_id = auth.uid()
);

-- invitations : visibles aux membres de l'organisation, et à l'invité lui-même (il doit
-- pouvoir découvrir l'invitation qui l'attend après sa première connexion).
drop policy if exists invit_select on invitations;
create policy invit_select on invitations for select using (
  est_membre(organisation_id) or lower(email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists invit_insert on invitations;
create policy invit_insert on invitations for insert with check (a_role_admin(organisation_id));

drop policy if exists invit_update on invitations;
create policy invit_update on invitations for update using (
  a_role_admin(organisation_id) or lower(email) = lower(auth.jwt() ->> 'email')
);

drop policy if exists invit_delete on invitations;
create policy invit_delete on invitations for delete using (a_role_admin(organisation_id));

-- tickets et patterns : accès total aux membres de l'organisation propriétaire, rien sinon.
drop policy if exists tickets_all on tickets;
create policy tickets_all on tickets for all
  using (est_membre(organisation_id))
  with check (est_membre(organisation_id));

drop policy if exists patterns_all on patterns_detectes;
create policy patterns_all on patterns_detectes for all
  using (est_membre(organisation_id))
  with check (est_membre(organisation_id));
