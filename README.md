# YQN Pay Back Office Test

Tiny back-office system to record, reverse, and export merchant payment transactions with audit logging and duplicate protection.

## Features
- Record payments with merchant ID, amount, fee, timestamp, and reference.
- Prevent duplicate payment ingestion (same merchant + reference).
- Reverse payments by adding a reversal entry (no deletes).
- Audit log that captures every change (who/what/when).
- CSV export for merchant or date range.
- Simple admin UI for search + reverse + export.

## Tech
- Next.js (App Router)
- Supabase (Postgres)

## Setup
1. Install dependencies:
   ```bash
   npm.cmd install
   ```
2. Create tables in Supabase:
   - Open the SQL editor and run `supabase/schema.sql`.
3. Create `.env.local`:
   ```bash
   SUPABASE_URL="https://your-project-id.supabase.co"
   SUPABASE_ANON_KEY="sb_publishable_..."
   SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
   ```
4. Start the app:
   ```bash
   npm run dev
   ```
5. Open `http://localhost:3000`.

## Demo Script
1. Record a payment with `merchantId=demo`, `reference=INV-100`, `amount=100`.
2. Try recording the same payment again → duplicate ignored.
3. Reverse the payment from the Transactions table.
4. Export CSV with the current filter.
5. Show audit log entries for create, duplicate attempt, and reversal.

## Notes
- Fee rule: `1.5%` of amount, stored to two decimals.
- Reversal entries use negative amounts to cancel the original payment.
- Activity log is append-only; no deletions or edits.
