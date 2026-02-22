import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const shouldSkip = !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY;

function buildIdempotencyKey(merchantId, reference, amount, occurredAt) {
  const normalizedAmount = amount.toFixed(2);
  const normalizedTimestamp = occurredAt.toISOString();
  const payload = `${merchantId}|${reference}|${normalizedAmount}|${normalizedTimestamp}`;
  return createHash("sha256").update(payload).digest("hex");
}

test("idempotent payment insert returns original on duplicate", { skip: shouldSkip }, async () => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const merchantId = `test-merchant-${randomUUID()}`;
  const reference = `INV-${randomUUID()}`;
  const amount = 120.5;
  const fee = 1.5;
  const netAmount = Math.round((amount - fee) * 100) / 100;
  const occurredAt = new Date("2024-01-01T00:00:00.000Z");
  const idempotencyKey = buildIdempotencyKey(
    merchantId,
    reference,
    amount,
    occurredAt
  );

  try {
    const first = await supabaseAdmin
      .rpc("record_payment", {
        p_merchant_id: merchantId,
        p_reference: reference,
        p_amount: amount,
        p_fee: fee,
        p_net_amount: netAmount,
        p_occurred_at: occurredAt.toISOString(),
        p_idempotency_key: idempotencyKey,
        p_actor: "test",
      })
      .single();

    assert.equal(first.error, null);
    assert.ok(first.data);
    assert.equal(first.data.duplicate, false);
    assert.equal(first.data.idempotency_key, idempotencyKey);

    const second = await supabaseAdmin
      .rpc("record_payment", {
        p_merchant_id: merchantId,
        p_reference: reference,
        p_amount: amount,
        p_fee: fee,
        p_net_amount: netAmount,
        p_occurred_at: occurredAt.toISOString(),
        p_idempotency_key: idempotencyKey,
        p_actor: "test",
      })
      .single();

    assert.equal(second.error, null);
    assert.ok(second.data);
    assert.equal(second.data.duplicate, true);
    assert.equal(second.data.id, first.data.id);

    const rows = await supabaseAdmin
      .from("transactions")
      .select("id", { count: "exact" })
      .eq("merchant_id", merchantId)
      .eq("type", "PAYMENT");

    assert.equal(rows.error, null);
    assert.equal(rows.count, 1);
  } finally {
    await supabaseAdmin
      .from("transactions")
      .delete()
      .eq("merchant_id", merchantId)
      .eq("type", "REVERSAL");
    await supabaseAdmin
      .from("transactions")
      .delete()
      .eq("merchant_id", merchantId)
      .eq("type", "PAYMENT");
  }
});

test("reversal inserts are unaffected", { skip: shouldSkip }, async () => {
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const merchantId = `test-merchant-${randomUUID()}`;
  const reference = `INV-${randomUUID()}`;
  const amount = 200;
  const fee = 2;
  const netAmount = Math.round((amount - fee) * 100) / 100;
  const occurredAt = new Date("2024-01-02T00:00:00.000Z");
  const idempotencyKey = buildIdempotencyKey(
    merchantId,
    reference,
    amount,
    occurredAt
  );

  try {
    const payment = await supabaseAdmin
      .rpc("record_payment", {
        p_merchant_id: merchantId,
        p_reference: reference,
        p_amount: amount,
        p_fee: fee,
        p_net_amount: netAmount,
        p_occurred_at: occurredAt.toISOString(),
        p_idempotency_key: idempotencyKey,
        p_actor: "test",
      })
      .single();

    assert.equal(payment.error, null);
    assert.ok(payment.data);

    const reversal = await supabaseAdmin
      .from("transactions")
      .insert({
        type: "REVERSAL",
        merchant_id: merchantId,
        reference,
        amount: amount * -1,
        fee: fee * -1,
        net_amount: netAmount * -1,
        occurred_at: occurredAt.toISOString(),
        original_transaction_id: payment.data.id,
      })
      .select("id")
      .single();

    assert.equal(reversal.error, null);
    assert.ok(reversal.data);

    const counts = await supabaseAdmin
      .from("transactions")
      .select("id", { count: "exact" })
      .eq("merchant_id", merchantId);

    assert.equal(counts.error, null);
    assert.equal(counts.count, 2);
  } finally {
    await supabaseAdmin
      .from("transactions")
      .delete()
      .eq("merchant_id", merchantId)
      .eq("type", "REVERSAL");
    await supabaseAdmin
      .from("transactions")
      .delete()
      .eq("merchant_id", merchantId)
      .eq("type", "PAYMENT");
  }
});
