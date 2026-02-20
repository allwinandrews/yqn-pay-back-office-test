import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const FEE_RATE = 0.015;

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

function toDate(value: unknown) {
  if (!value) {
    return new Date();
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid timestamp.");
  }
  return date;
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
    const fee = Math.round(amount * FEE_RATE * 100) / 100;
    const netAmount = Math.round((amount - fee) * 100) / 100;
    const occurredAt = toDate(body.occurredAt);

    const insertResult = await supabaseAdmin
      .from("transactions")
      .insert({
        type: "PAYMENT",
        merchant_id: merchantId,
        reference,
        amount,
        fee,
        net_amount: netAmount,
        occurred_at: occurredAt.toISOString(),
      })
      .select()
      .single();

    if (insertResult.error) {
      if (insertResult.error.code === "23505") {
        const existing = await supabaseAdmin
          .from("transactions")
          .select("*")
          .eq("merchant_id", merchantId)
          .eq("reference", reference)
          .eq("type", "PAYMENT")
          .single();

        if (existing.data) {
          await supabaseAdmin.from("audit_log").insert({
            actor,
            action: "payment_duplicate_ignored",
            entity_type: "transaction",
            entity_id: existing.data.id,
            details: {
              merchantId,
              reference,
              attemptedAmount: amount,
            },
          });

          return NextResponse.json({ transaction: existing.data, duplicate: true });
        }
      }
      throw insertResult.error;
    }

    const transaction = insertResult.data;

    await supabaseAdmin.from("audit_log").insert({
      actor,
      action: "payment_created",
      entity_type: "transaction",
      entity_id: transaction.id,
      details: {
        merchantId,
        reference,
        amount,
        fee,
        netAmount,
        occurredAt: occurredAt.toISOString(),
      },
    });

    return NextResponse.json({ transaction });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
