-- Sentinelle — création d'organisation atomique (à exécuter APRÈS 002_organisations.sql).
-- Supabase → SQL Editor → New query → Run.
--
-- Corrige deux défauts de 002 :
--
-- 1. Œuf et poule. Le client insérait l'organisation puis s'y rattachait en deux requêtes.
--    Mais PostgREST, pour renvoyer la ligne créée (`return=representation`), doit passer la
--    policy SELECT — laquelle exige d'être membre. Or l'adhésion n'existe pas encore à cet
--    instant : l'insertion réussissait, et la lecture échouait en 42501. Création
--    d'organisation donc systématiquement impossible depuis l'interface.
--
-- 2. Atomicité. Si le rattachement échouait après l'insertion, l'organisation restait en
--    base sans aucun membre : invisible pour tous, impossible à reprendre, et un nouvel
--    essai en créait une deuxième.
--
-- Les deux écritures passent maintenant par une seule fonction. SECURITY DEFINER lui permet
-- de renvoyer la ligne sans buter sur la policy SELECT ; elle reste sûre car elle n'écrit
-- jamais que pour auth.uid() — impossible de créer une organisation au nom d'autrui.

create or replace function creer_organisation(p_nom text, p_pays text default null)
returns organisations
language plpgsql
security definer
set search_path = public
as $$
declare
  nouvelle organisations;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise' using errcode = '42501';
  end if;

  if coalesce(trim(p_nom), '') = '' then
    raise exception 'Le nom de l''organisation est obligatoire' using errcode = '22023';
  end if;

  insert into organisations (nom, pays, created_by)
  values (trim(p_nom), nullif(trim(coalesce(p_pays, '')), ''), auth.uid())
  returning * into nouvelle;

  insert into membres (organisation_id, user_id, role)
  values (nouvelle.id, auth.uid(), 'proprietaire');

  return nouvelle;
end;
$$;

revoke all on function creer_organisation(text, text) from public;
grant execute on function creer_organisation(text, text) to authenticated;

-- L'insertion directe n'a plus lieu d'être, et c'était la seule façon de produire une
-- organisation orpheline. On la retire : la fonction devient le seul chemin de création.
drop policy if exists org_insert on organisations;

-- Rattrapage : supprime les organisations sans aucun membre laissées par l'ancien chemin.
delete from organisations o
where not exists (select 1 from membres m where m.organisation_id = o.id);
