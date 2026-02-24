import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function parseDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const merchantId = searchParams.get("merchantId")?.trim();
  const reference = searchParams.get("reference")?.trim();
  const from = parseDate(searchParams.get("from"));
  const to = parseDate(searchParams.get("to"));
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const pageSizeRaw = parsePositiveInt(searchParams.get("pageSize"), 25);
  const pageSize = Math.min(pageSizeRaw, 100);
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  let query = supabaseAdmin
    .from("transactions")
    .select(
      "id, type, merchant_id, reference, amount, fee, net_amount, occurred_at, original_transaction_id",
      { count: "exact" }
    )
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (merchantId) query = query.eq("merchant_id", merchantId);
  if (reference) query = query.eq("reference", reference);
  if (from) query = query.gte("occurred_at", from.toISOString());
  if (to) query = query.lte("occurred_at", to.toISOString());

  const result = await query;

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const rows = result.data || [];
  const reversalByOriginal = new Map<string, string>();
  rows.forEach((row) => {
    if (row.type === "REVERSAL" && row.original_transaction_id) {
      reversalByOriginal.set(row.original_transaction_id, row.id);
    }
  });

  const data = rows.map((row) => {
    const reversalId =
      row.type === "PAYMENT" ? reversalByOriginal.get(row.id) ?? null : null;
    const status =
      row.type === "REVERSAL"
        ? "REVERSAL"
        : reversalId
          ? "REVERSED"
          : "COMPLETED";

    return {
      id: row.id,
      type: row.type,
      merchantId: row.merchant_id,
      reference: row.reference,
      amount: String(row.amount),
      fee: String(row.fee),
      netAmount: String(row.net_amount),
      occurredAt: new Date(row.occurred_at).toISOString(),
      status,
      reversalId,
      originalTransactionId: row.original_transaction_id ?? null,
    };
  });

  const total = result.count ?? 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);

  return NextResponse.json({
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
}
