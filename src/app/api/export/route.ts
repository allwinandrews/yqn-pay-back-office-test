import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function parseDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const merchantId = searchParams.get("merchantId")?.trim();
  const reference = searchParams.get("reference")?.trim();
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));

  const where: Record<string, unknown> = {};
  if (merchantId) where.merchantId = merchantId;
  if (from || to) {
    where.occurredAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  let query = supabaseAdmin
    .from("transactions")
    .select(
      "id, type, merchant_id, reference, amount, fee, net_amount, occurred_at, created_at, original_transaction_id"
    )
    .order("occurred_at", { ascending: false });

  if (merchantId) query = query.eq("merchant_id", merchantId);
  if (from) query = query.gte("occurred_at", from.toISOString());
  if (to) query = query.lte("occurred_at", to.toISOString());

  const result = await query;
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const transactions = result.data ?? [];

  const headers = [
    "id",
    "type",
    "merchantId",
    "reference",
    "amount",
    "fee",
    "netAmount",
    "occurredAt",
    "createdAt",
    "originalTransactionId",
  ];

  const rows = transactions.map((t) => [
    t.id,
    t.type,
    t.merchant_id,
    t.reference,
    String(t.amount),
    String(t.fee),
    String(t.net_amount),
    new Date(t.occurred_at).toISOString(),
    new Date(t.created_at).toISOString(),
    t.original_transaction_id ?? "",
  ]);

  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");

  const safe = (value: string) =>
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/(^-|-$)/g, "");

  const parts = ["transactions"];
  if (merchantId) parts.push(`merchant-${safe(merchantId)}`);
  if (reference) parts.push(`reference-${safe(reference)}`);
  if (from) parts.push(`from-${from.toISOString().slice(0, 10)}`);
  if (to) parts.push(`to-${to.toISOString().slice(0, 10)}`);
  const filename = `${parts.join("_")}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=${filename}`,
    },
  });
}
