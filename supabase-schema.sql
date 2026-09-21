-- ============================================================
-- Ricettario — schema Supabase
-- Esegui tutto questo file in Supabase → SQL Editor → New query → Run
-- Idempotente: puoi rilanciarlo senza rompere nulla.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Categorie (alimenta la tendina "categoria" nell'app)
-- ------------------------------------------------------------
create table if not exists public.categories (
  id          bigserial primary key,
  name        text    not null unique,
  sort_order  int     not null default 500
);

insert into public.categories (name, sort_order) values
  ('Pasta',             10),
  ('Riso e cereali',    20),
  ('Carne',             30),
  ('Pesce',             40),
  ('Uova',              50),
  ('Legumi',            60),
  ('Verdure',           70),
  ('Zuppe e vellutate', 80),
  ('Formaggi',          90),
  ('Contorni',          95),
  ('Piatto unico',     100),
  ('Frutta',           110),
  ('Colazione',        120),
  ('Dolci',            130),
  ('Altro',            999)
on conflict (name) do nothing;

-- ------------------------------------------------------------
-- 2. Ricette
--    target: 'bimbo' | 'adulti' | 'entrambi'
-- ------------------------------------------------------------
create table if not exists public.recipes (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  target        text        not null default 'entrambi'
                            check (target in ('bimbo','adulti','entrambi')),
  category      text        not null default 'Altro',
  prep_minutes  int         check (prep_minutes is null or prep_minutes between 0 and 600),
  ingredients   text,
  notes         text,
  is_archived   boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- contorni: ricette selezionabili come accompagnamento (aggiunta successiva,
-- l'ALTER rende il file rilanciabile anche su un database già creato)
alter table public.recipes
  add column if not exists is_side boolean not null default false;

-- nessun doppione sul nome (case-insensitive)
create unique index if not exists recipes_name_key on public.recipes (lower(name));
create index if not exists recipes_side_idx on public.recipes (is_side);
create index if not exists recipes_target_idx   on public.recipes (target);
create index if not exists recipes_category_idx on public.recipes (category);

-- aggiorna updated_at ad ogni modifica
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Pasti registrati
--    un solo piatto per (data, pranzo/cena, adulto/bimbo)
-- ------------------------------------------------------------
create table if not exists public.meals (
  id         uuid primary key default gen_random_uuid(),
  meal_date  date        not null,
  slot       text        not null check (slot in ('pranzo','cena')),
  eater      text        not null check (eater in ('adulto','bimbo')),
  recipe_id  uuid        not null references public.recipes(id) on delete cascade,
  notes      text,
  created_at timestamptz not null default now(),
  constraint meals_slot_key unique (meal_date, slot, eater)
);

-- contorno opzionale abbinato al pasto (usato dall'app sulla cena dell'adulto)
alter table public.meals
  add column if not exists side_recipe_id uuid references public.recipes(id) on delete set null;

create index if not exists meals_date_idx   on public.meals (meal_date);
create index if not exists meals_recipe_idx on public.meals (recipe_id);
create index if not exists meals_side_idx   on public.meals (side_recipe_id);

-- ------------------------------------------------------------
-- 4. Vista comoda per il recap (opzionale, l'app non la richiede)
-- ------------------------------------------------------------
-- la si elimina prima di ricrearla: CREATE OR REPLACE VIEW non sa inserire
-- colonne nuove in mezzo a quelle esistenti (errore 42P16)
drop view if exists public.meals_expanded cascade;

create view public.meals_expanded as
select
  m.id,
  m.meal_date,
  date_trunc('month', m.meal_date)::date as month,
  m.slot,
  m.eater,
  r.name     as recipe_name,
  r.category as recipe_category,
  r.target   as recipe_target,
  s.name     as side_name,
  s.category as side_category,
  m.notes
from public.meals m
join public.recipes r on r.id = m.recipe_id
left join public.recipes s on s.id = m.side_recipe_id;

-- ------------------------------------------------------------
-- 5. Row Level Security
--    L'app è statica e usa SOLO la chiave anon: le policy qui sotto
--    danno lettura/scrittura al ruolo anon. Chiunque abbia URL +
--    chiave anon può leggere e scrivere. Vedi il README, sezione
--    "Sicurezza", per la variante con login.
-- ------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.recipes    enable row level security;
alter table public.meals      enable row level security;

drop policy if exists rc_categories_select on public.categories;
create policy rc_categories_select on public.categories
  for select to anon, authenticated using (true);

drop policy if exists rc_recipes_all on public.recipes;
create policy rc_recipes_all on public.recipes
  for all to anon, authenticated using (true) with check (true);

drop policy if exists rc_meals_all on public.meals;
create policy rc_meals_all on public.meals
  for all to anon, authenticated using (true) with check (true);

-- ============================================================
-- VARIANTE PROTETTA (opzionale)
-- Se attivi Supabase Auth e fai login nell'app, sostituisci le tre
-- policy sopra con queste: solo utenti autenticati leggono/scrivono.
-- ============================================================
-- drop policy if exists rc_categories_select on public.categories;
-- create policy rc_categories_select on public.categories
--   for select to authenticated using (true);
--
-- drop policy if exists rc_recipes_all on public.recipes;
-- create policy rc_recipes_all on public.recipes
--   for all to authenticated using (true) with check (true);
--
-- drop policy if exists rc_meals_all on public.meals;
-- create policy rc_meals_all on public.meals
--   for all to authenticated using (true) with check (true);

-- ============================================================
-- Controllo finale
-- ============================================================
select 'categories' as tabella, count(*) as righe from public.categories
union all select 'recipes', count(*) from public.recipes
union all select 'meals',   count(*) from public.meals;
