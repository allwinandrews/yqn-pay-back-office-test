create extension if not exists "pgcrypto";

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('PAYMENT', 'REVERSAL')),
  merchant_id text not null,
  reference text not null,
  amount numeric(12, 2) not null,
  fee numeric(12, 2) not null,
  net_amount numeric(12, 2) not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  original_transaction_id uuid references public.transactions(id)
);

create unique index if not exists transactions_dedupe_idx
  on public.transactions (merchant_id, reference, type);

create unique index if not exists transactions_one_reversal_idx
  on public.transactions (original_transaction_id)
  where original_transaction_id is not null;

create index if not exists transactions_merchant_occurred_idx
  on public.transactions (merchant_id, occurred_at desc);

create index if not exists transactions_reference_idx
  on public.transactions (reference);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id);
