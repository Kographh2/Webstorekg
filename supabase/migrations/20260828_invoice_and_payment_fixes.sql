-- ============================================
-- Migration: Invoice + payment system fixes (Aug 28, 2026)
-- Safe to run on an EXISTING database — additive only, no DROP TABLE,
-- no data loss. Paste directly into Supabase SQL Editor.
-- ============================================

-- New columns for idempotent invoice/digital-product email delivery —
-- without these, the payment webhook, the status-polling endpoint, and
-- the success page could each independently re-trigger the same email,
-- sending duplicates.
alter table public.orders
  add column if not exists invoice_sent_at timestamptz,
  add column if not exists digital_delivered_at timestamptz;
