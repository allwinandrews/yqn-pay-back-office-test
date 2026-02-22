"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type TransactionRow = {
  id: string;
  type: "PAYMENT" | "REVERSAL";
  merchantId: string;
  reference: string;
  amount: string;
  fee: string;
  netAmount: string;
  occurredAt: string;
  status: "COMPLETED" | "REVERSED" | "REVERSAL";
  reversalId: string | null;
  originalTransactionId?: string | null;
};

type AuditRow = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
};

const defaultFilters = {
  merchantId: "",
  reference: "",
  from: "",
  to: "",
};

export default function HomeClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = (searchParams.get("section") || "record").toLowerCase();
  const [createForm, setCreateForm] = useState({
    merchantId: "",
    reference: "",
    amount: "",
    fee: "",
    occurredAt: "",
  });
  const [filters, setFilters] = useState(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState(defaultFilters);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [status, setStatus] = useState<string>("");
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [confirmReversalId, setConfirmReversalId] = useState<string | null>(null);
  const hasAnyFilters = Boolean(
    filters.merchantId || filters.reference || filters.from || filters.to
  );
  const hasAppliedFilters = Boolean(
    appliedFilters.merchantId ||
      appliedFilters.reference ||
      appliedFilters.from ||
      appliedFilters.to
  );
  const hasTransactions = transactions.length > 0;

  function setSection(section: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", section);
    if (section !== "transactions") {
      params.delete("merchantId");
      params.delete("reference");
      params.delete("from");
      params.delete("to");
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedFilters.merchantId)
      params.set("merchantId", appliedFilters.merchantId);
    if (appliedFilters.reference)
      params.set("reference", appliedFilters.reference);
    if (appliedFilters.from) params.set("from", appliedFilters.from);
    if (appliedFilters.to) params.set("to", appliedFilters.to);
    return `/api/export?${params.toString()}`;
  }, [appliedFilters]);

  const todayDate = new Date().toISOString().slice(0, 10);
  const amountNumber = Number(createForm.amount);
  const feeNumber = Number(createForm.fee);
  const computedNet =
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    Number.isFinite(feeNumber) &&
    feeNumber >= 0 &&
    feeNumber < amountNumber
      ? Math.round((amountNumber - feeNumber) * 100) / 100
      : null;

  async function loadTransactions() {
    setLoadingTransactions(true);
    const params = new URLSearchParams();
    if (appliedFilters.merchantId)
      params.set("merchantId", appliedFilters.merchantId);
    if (appliedFilters.reference)
      params.set("reference", appliedFilters.reference);
    if (appliedFilters.from) params.set("from", appliedFilters.from);
    if (appliedFilters.to) params.set("to", appliedFilters.to);

    const response = await fetch(`/api/transactions?${params.toString()}`);
    const payload = await response.json();
    setTransactions(payload.data || []);
    setLoadingTransactions(false);
  }

  async function loadAuditLogs() {
    setLoadingAudit(true);
    const response = await fetch("/api/audit?limit=25");
    const payload = await response.json();
    setAuditLogs(payload.data || []);
    setLoadingAudit(false);
  }

  async function handleCreatePayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingPayment) return;
    setStatus("");
    setToast(null);
    if (!createForm.occurredAt) {
      const message = "Timestamp is required.";
      setStatus(message);
      setToast({ type: "error", message });
      return;
    }
    if (createForm.occurredAt) {
      const entered = new Date(createForm.occurredAt);
      if (Number.isNaN(entered.getTime())) {
        const message = "Timestamp is invalid.";
        setStatus(message);
        setToast({ type: "error", message });
        return;
      }
      if (entered.getTime() > Date.now()) {
        const message = "Timestamp cannot be in the future.";
        setStatus(message);
        setToast({ type: "error", message });
        return;
      }
    }
    if (Number.isFinite(amountNumber) && amountNumber > 0) {
      if (!Number.isFinite(feeNumber) || feeNumber < 0) {
        const message = "Fee must be zero or greater.";
        setStatus(message);
        setToast({ type: "error", message });
        return;
      }
      if (feeNumber >= amountNumber) {
        const message = "Fee must be less than amount.";
        setStatus(message);
        setToast({ type: "error", message });
        return;
      }
    }
    setSubmittingPayment(true);
    const response = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...createForm,
        occurredAt: createForm.occurredAt,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error || "Failed to create payment.");
      setToast({
        type: "error",
        message: payload.error || "Failed to create payment.",
      });
      setSubmittingPayment(false);
      return;
    }

    const successMessage = payload.duplicate
      ? "Duplicate ignored."
      : "Payment recorded.";
    setStatus(successMessage);
    setToast({ type: "success", message: successMessage });
    setCreateForm({
      merchantId: "",
      reference: "",
      amount: "",
      fee: "",
      occurredAt: "",
    });
    await loadTransactions();
    await loadAuditLogs();
    setSubmittingPayment(false);
  }

  async function handleReverse(transactionId: string) {
    setStatus("");
    setToast(null);
    const response = await fetch("/api/reversals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload.error || "Failed to reverse payment.");
      setToast({
        type: "error",
        message: payload.error || "Failed to reverse payment.",
      });
      return;
    }

    const successMessage = payload.duplicate ? "Already reversed." : "Reversal added.";
    setStatus(successMessage);
    setToast({ type: "success", message: successMessage });
    await loadTransactions();
    await loadAuditLogs();
  }

  async function confirmReverse() {
    if (!confirmReversalId) return;
    const id = confirmReversalId;
    setConfirmReversalId(null);
    await handleReverse(id);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    loadAuditLogs();
  }, []);

  useEffect(() => {
    if (activeSection !== "transactions") return;
    const merchantId = searchParams.get("merchantId") || "";
    const reference = searchParams.get("reference") || "";
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";
    const nextFilters = { merchantId, reference, from, to };
    setFilters(nextFilters);
    setAppliedFilters(nextFilters);
  }, [activeSection, searchParams]);

  useEffect(() => {
    if (activeSection !== "transactions") return;
    loadTransactions();
  }, [activeSection, appliedFilters]);

  function formatTimestamp(value: string | null | undefined) {
    if (!value) return "Unknown time";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return date.toLocaleString();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            className={`pointer-events-auto flex max-w-xl items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${
              toast.type === "error"
                ? "bg-rose-600 text-white"
                : "bg-emerald-600 text-white"
            }`}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss notification"
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-sm font-semibold text-white transition hover:bg-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      {confirmReversalId ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">
              Confirm reversal
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This will add a reversal entry that cancels the original payment.
              The original record will remain unchanged.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmReversalId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmReverse}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Reverse payment
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
            YQN Pay Back Office
          </p>
          <h1 className="text-3xl font-semibold text-slate-900">
            Payments Control Room
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Record merchant payments, reverse errors without deleting history, and
            export clean CSVs for finance.
          </p>
        </header>

        <nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {[
            { id: "record", label: "Record Payment" },
            { id: "transactions", label: "Search + Transactions" },
            { id: "audit", label: "Audit Log" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                activeSection === item.id
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {activeSection === "record" ? (
          <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Record Payment</h2>
              <p className="text-sm text-slate-500">
                Net amount is calculated automatically.
              </p>
              <form className="mt-4 grid gap-4" onSubmit={handleCreatePayment}>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-600">
                    Merchant ID
                    <span className="ml-1 text-rose-500">*</span>
                  </label>
                  <input
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                    value={createForm.merchantId}
                    disabled={submittingPayment}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        merchantId: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-600">
                    Reference
                    <span className="ml-1 text-rose-500">*</span>
                  </label>
                  <input
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                    value={createForm.reference}
                    disabled={submittingPayment}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        reference: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="grid gap-2">
  <label className="text-xs font-semibold text-slate-600">
    Amount
    <span className="ml-1 text-rose-500">*</span>
  </label>
  <input
    type="number"
    step="0.01"
    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
    value={createForm.amount}
    disabled={submittingPayment}
    onChange={(event) =>
      setCreateForm((prev) => ({
        ...prev,
        amount: event.target.value,
      }))
    }
    required
  />
</div>
<div className="grid gap-2">
  <label className="text-xs font-semibold text-slate-600">
    Fee
    <span className="ml-1 text-rose-500">*</span>
  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={
                      Number.isFinite(amountNumber) && amountNumber > 0
                        ? Math.max(0, amountNumber - 0.01)
                        : undefined
                    }
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                    value={createForm.fee}
    disabled={submittingPayment}
    onChange={(event) =>
      setCreateForm((prev) => ({
        ...prev,
        fee: event.target.value,
      }))
    }
    required
  />
  <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
      Net Amount
    </div>
    <div className="text-sm font-semibold text-slate-800">
      {computedNet === null ? "—" : computedNet.toFixed(2)}
    </div>
  </div>
</div>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold text-slate-600">
                    Timestamp
                    <span className="ml-1 text-rose-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                    value={createForm.occurredAt}
                    max={new Date().toISOString().slice(0, 16)}
                    disabled={submittingPayment}
                    onChange={(event) =>
                      setCreateForm((prev) => ({
                        ...prev,
                        occurredAt: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submittingPayment ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-white" />
                  ) : null}
                  {submittingPayment ? "Saving..." : "Save Payment"}
                </button>
              </form>
            </div>
          </section>
        ) : null}

        {activeSection === "transactions" ? (
          <section className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Search</h2>
                  <p className="text-sm text-slate-500">
                    Filter by merchant, reference, or date range.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadTransactions}
                  aria-label="Refresh transactions"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-50"
                >
                  {loadingTransactions ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                  ) : (
                    "⟳"
                  )}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr]">
                <input
                  placeholder="Merchant ID"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                  value={filters.merchantId}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      merchantId: event.target.value,
                    }))
                  }
                />
                <input
                  placeholder="Reference"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                  value={filters.reference}
                  onChange={(event) =>
                    setFilters((prev) => ({
                      ...prev,
                      reference: event.target.value,
                    }))
                  }
                />
                <input
                  type="date"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                  value={filters.from}
                  max={filters.to || todayDate}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, from: event.target.value }))
                  }
                />
                <input
                  type="date"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400"
                  value={filters.to}
                  min={filters.from || ""}
                  max={todayDate}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, to: event.target.value }))
                  }
                />
              </div>
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAppliedFilters(filters);
                    const params = new URLSearchParams(searchParams.toString());
                    if (filters.merchantId)
                      params.set("merchantId", filters.merchantId);
                    else params.delete("merchantId");
                    if (filters.reference) params.set("reference", filters.reference);
                    else params.delete("reference");
                    if (filters.from) params.set("from", filters.from);
                    else params.delete("from");
                    if (filters.to) params.set("to", filters.to);
                    else params.delete("to");
                    params.set("section", "transactions");
                    router.replace(`${pathname}?${params.toString()}`);
                    loadTransactions();
                  }}
                  disabled={!hasAnyFilters}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Apply Filters
                </button>
                <a
                  href={exportUrl}
                  className={`rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white ${
                    hasTransactions
                      ? ""
                      : "pointer-events-none cursor-not-allowed opacity-50"
                  }`}
                >
                  Export CSV
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setFilters(defaultFilters);
                    if (!hasAppliedFilters) return;
                    setAppliedFilters(defaultFilters);
                    const params = new URLSearchParams(searchParams.toString());
                    params.delete("merchantId");
                    params.delete("reference");
                    params.delete("from");
                    params.delete("to");
                    params.set("section", "transactions");
                    router.replace(`${pathname}?${params.toString()}`);
                    loadTransactions();
                  }}
                  disabled={!hasAnyFilters}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-3 pr-4">Type</th>
                    <th className="py-3 pr-4">Merchant</th>
                    <th className="py-3 pr-4">Reference</th>
                    <th className="py-3 pr-4">Amount</th>
                    <th className="py-3 pr-4">Fee</th>
                    <th className="py-3 pr-4">Net</th>
                    <th className="py-3 pr-4">Occurred</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-slate-100">
                      <td className="py-3 pr-4">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                          {tx.type}
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-medium text-slate-900">
                        {tx.merchantId}
                      </td>
                      <td className="py-3 pr-4 text-slate-500">{tx.reference}</td>
                      <td className="py-3 pr-4 text-slate-700">{tx.amount}</td>
                      <td className="py-3 pr-4 text-slate-700">{tx.fee}</td>
                      <td className="py-3 pr-4 text-slate-700">{tx.netAmount}</td>
                      <td className="py-3 pr-4 text-slate-500">
                        {new Date(tx.occurredAt).toLocaleString()}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={
                            tx.status === "REVERSED"
                              ? "rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700"
                              : tx.status === "REVERSAL"
                                ? "rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700"
                                : "rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700"
                          }
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        {tx.status === "COMPLETED" ? (
                          <button
                            type="button"
                            onClick={() => setConfirmReversalId(tx.id)}
                            className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700"
                          >
                            Reverse
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {tx.type === "REVERSAL" && tx.originalTransactionId
                              ? `Reversal of ${tx.originalTransactionId.slice(0, 8)}`
                              : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="py-6 text-center text-sm text-slate-400"
                      >
                        {loadingTransactions ? "Loading…" : "No transactions yet."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeSection === "audit" ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                Audit Log (read-only)
              </h2>
              <button
                type="button"
                onClick={loadAuditLogs}
                aria-label="Refresh audit log"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-50"
              >
                {loadingAudit ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                ) : (
                  "⟳"
                )}
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              {auditLogs.map((log) => (
                <div key={log.id} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {log.action.replaceAll("_", " ")}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatTimestamp(log.created_at)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>Actor: {log.actor}</span>
                    <span>
                      Entity: {log.entity_type} {log.entity_id}
                    </span>
                  </div>
                </div>
              ))}
              {auditLogs.length === 0 ? (
                <div className="text-sm text-slate-400">
                  No audit activity yet.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

