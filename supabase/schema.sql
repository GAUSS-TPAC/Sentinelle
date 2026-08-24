-- Racine — schéma Supabase (triage causal CEMAC)
-- À exécuter dans Supabase → SQL Editor → New query → Run.
-- Basé sur src/lib/types.ts (Ticket, DetectedPattern) et src/lib/taxonomy.ts.

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  texte_brut text not null,
  categorie_causale text not null,
  sous_categorie text,
  date_creation timestamptz not null default now(),
  statut text not null default 'nouveau'
    check (statut in ('nouveau', 'en_cours', 'resolu', 'en_retard')),
  provider_utilise text,
  delai_reponse_jours integer,
  confiance real,
  justification text,
  created_at timestamptz not null default now()
);

create index if not exists idx_tickets_categorie on tickets (categorie_causale);
create index if not exists idx_tickets_date_creation on tickets (date_creation);
create index if not exists idx_tickets_statut on tickets (statut);

create table if not exists patterns_detectes (
  -- id texte déterministe (ex: "pattern-volume-<categorie>", "pattern-cobac-delai"),
  -- généré par detectPatterns() côté app — pas un uuid.
  id text primary key,
  description text not null,
  categorie_causale text not null,
  tickets_lies text[] not null default '{}',
  date_detection timestamptz not null default now(),
  severite text not null
    check (severite in ('faible', 'moyenne', 'elevee', 'critique')),
  type text not null
    check (type in ('volume', 'conformite_cobac')),
  created_at timestamptz not null default now()
);

create index if not exists idx_patterns_date on patterns_detectes (date_detection);
create index if not exists idx_patterns_type on patterns_detectes (type);

-- RLS activée avec accès total réservé au backend (service_role bypass RLS par défaut).
-- Aucune clé anon/publique n'est utilisée côté client dans ce projet — l'API passe
-- toujours par server/index.ts avec la service_role key.
alter table tickets enable row level security;
alter table patterns_detectes enable row level security;
