import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function parseAmount(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Amount is required.");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  return amount;
}

function parseFee(value: unknown, amount: number) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Fee is required.");
  }
  const fee = Number(value);
  if (!Number.isFinite(fee) || fee < 0) {
    throw new Error("Fee must be zero or greater.");
  }
  if (fee >= amount) {
    throw new Error("Fee must be less than amount.");
  }
  return fee;
}

function toDate(value: unknown) {
  if (!value) {
    throw new Error("Timestamp is required.");
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp.");
  }
  if (date.getTime() > Date.now()) {
    throw new Error("Timestamp cannot be in the future.");
  }
  return date;
}

function buildIdempotencyKey(
  merchantId: string,
  reference: string,
  amount: number,
  occurredAt: Date
) {
  const normalizedAmount = amount.toFixed(2);
  const normalizedTimestamp = occurredAt.toISOString();
  const payload = `${merchantId}|${reference}|${normalizedAmount}|${normalizedTimestamp}`;
  return createHash("sha256").update(payload).digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const merchantId = String(body.merchantId || "").trim();
    const reference = String(body.reference || "").trim();
    const actor = String(body.actor || "admin");

    if (!merchantId || !reference) {
      return NextResponse.json(
        { error: "merchantId and reference are required." },
        { status: 400 }
      );
    }

    const amount = parseAmount(body.amount);
    const fee = parseFee(body.fee, amount);
    const netAmount = Math.round((amount - fee) * 100) / 100;
    const occurredAt = toDate(body.occurredAt);
    const idempotencyKey = buildIdempotencyKey(
      merchantId,
      reference,
      amount,
      occurredAt
    );

    const result = await supabaseAdmin.rpc("record_payment", {
      p_merchant_id: merchantId,
      p_reference: reference,
      p_amount: amount,
      p_fee: fee,
      p_net_amount: netAmount,
      p_occurred_at: occurredAt.toISOString(),
      p_idempotency_key: idempotencyKey,
      p_actor: actor,
    });

    if (result.error) {
      throw result.error;
    }

    const payload = Array.isArray(result.data)
      ? result.data[0]
      : result.data;

    if (!payload) {
      return NextResponse.json(
        { error: "Failed to create payment." },
        { status: 500 }
      );
    }

    const { duplicate, ...transaction } = payload;

    return NextResponse.json({
      transaction,
      ...(duplicate ? { duplicate: true } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message)
        : "Unexpected error";
    console.error("Payment error", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
