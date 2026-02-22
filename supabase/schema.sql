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
  original_transaction_id uuid references public.transactions(id),
  idempotency_key text
);

alter table if exists public.transactions
  add column if not exists idempotency_key text;


create unique index if not exists transactions_one_reversal_idx
  on public.transactions (original_transaction_id)
  where original_transaction_id is not null;

create index if not exists transactions_merchant_occurred_idx
  on public.transactions (merchant_id, occurred_at desc);

create index if not exists transactions_reference_idx
  on public.transactions (reference);

drop index if exists public.transactions_payment_idempotency_idx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_payment_idempotency_required'
  ) then
    alter table public.transactions
      add constraint transactions_payment_idempotency_required
      check (type <> 'PAYMENT' or idempotency_key is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_payment_idempotency_uniq'
  ) then
    alter table public.transactions
      add constraint transactions_payment_idempotency_uniq
      unique (merchant_id, idempotency_key, type);
  end if;
end;
$$;

create or replace function public.record_payment(
  p_merchant_id text,
  p_reference text,
  p_amount numeric,
  p_fee numeric,
  p_net_amount numeric,
  p_occurred_at timestamptz,
  p_idempotency_key text,
  p_actor text
)
returns table (
  id uuid,
  type text,
  merchant_id text,
  reference text,
  amount numeric,
  fee numeric,
  net_amount numeric,
  occurred_at timestamptz,
  created_at timestamptz,
  original_transaction_id uuid,
  idempotency_key text,
  duplicate boolean
)
language plpgsql
as $$
declare
  v_transaction public.transactions%rowtype;
begin
  insert into public.transactions (
    type,
    merchant_id,
    reference,
    amount,
    fee,
    net_amount,
    occurred_at,
    idempotency_key
  ) values (
    'PAYMENT',
    p_merchant_id,
    p_reference,
    p_amount,
    p_fee,
    p_net_amount,
    p_occurred_at,
    p_idempotency_key
  )
  on conflict on constraint transactions_payment_idempotency_uniq
  do nothing
  returning * into v_transaction;

  if v_transaction.id is not null then
    insert into public.audit_log (
      actor,
      action,
      entity_type,
      entity_id,
      details
    ) values (
      p_actor,
      'payment_created',
      'transaction',
      v_transaction.id,
      jsonb_build_object(
        'merchantId', p_merchant_id,
        'reference', p_reference,
        'amount', p_amount,
        'fee', p_fee,
        'netAmount', p_net_amount,
        'occurredAt', p_occurred_at
      )
    );

    return query select v_transaction.*, false;
  end if;

  select t.* into v_transaction
    from public.transactions as t
    where t.merchant_id = p_merchant_id
      and t.idempotency_key = p_idempotency_key
      and t.type = 'PAYMENT';

  if v_transaction.id is null then
    raise exception 'Payment not found after conflict' using errcode = 'P0001';
  end if;

  return query select v_transaction.*, true;
end;
$$;

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
