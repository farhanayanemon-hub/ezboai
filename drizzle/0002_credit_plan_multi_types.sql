-- Allow a single credit plan to grant credits across multiple categories
-- (e.g. text + image + video). The legacy `creditType` column stays for
-- backwards compatibility with existing rows and any code path that still
-- reads it; new code should prefer `creditTypes`.
ALTER TABLE "credit_plan" ADD COLUMN IF NOT EXISTS "creditTypes" text[];

-- Backfill existing rows so each historical plan continues to grant exactly
-- the credit type it was originally created with.
UPDATE "credit_plan"
SET "creditTypes" = ARRAY["creditType"]
WHERE "creditTypes" IS NULL;
