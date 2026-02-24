import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const pageSizeRaw = parsePositiveInt(searchParams.get("pageSize"), 20);
  const pageSize = Math.min(pageSizeRaw, 100);
  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  const result = await supabaseAdmin
    .from("audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(rangeFrom, rangeTo);

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const total = result.count ?? 0;
  const totalPages = total === 0 ? 1 : Math.ceil(total / pageSize);

  return NextResponse.json({
    data: result.data ?? [],
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
