import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const transactionId = String(body.transactionId || "").trim();
    const actor = String(body.actor || "admin");

    if (!transactionId) {
      return NextResponse.json(
        { error: "transactionId is required." },
        { status: 400 }
      );
    }

    const paymentResult = await supabaseAdmin
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .single();

    const payment = paymentResult.data;
    if (!payment || payment.type !== "PAYMENT") {
      return NextResponse.json(
        { error: "Payment not found." },
        { status: 404 }
      );
    }

    const reversalCheck = await supabaseAdmin
      .from("transactions")
      .select("*")
      .eq("original_transaction_id", payment.id)
      .eq("type", "REVERSAL")
      .maybeSingle();

    if (reversalCheck.data) {
      return NextResponse.json({ transaction: reversalCheck.data, duplicate: true });
    }

    const reversalResult = await supabaseAdmin
      .from("transactions")
      .insert({
        type: "REVERSAL",
        merchant_id: payment.merchant_id,
        reference: payment.reference,
        amount: Number(payment.amount) * -1,
        fee: Number(payment.fee) * -1,
        net_amount: Number(payment.net_amount) * -1,
        occurred_at: new Date().toISOString(),
        original_transaction_id: payment.id,
      })
      .select()
      .single();

    if (reversalResult.error) {
      throw reversalResult.error;
    }

    const reversal = reversalResult.data;

    await supabaseAdmin.from("audit_log").insert({
      actor,
      action: "payment_reversed",
      entity_type: "transaction",
      entity_id: reversal.id,
      details: {
        originalTransactionId: payment.id,
        merchantId: payment.merchant_id,
        reference: payment.reference,
      },
    });

    return NextResponse.json({ transaction: reversal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
