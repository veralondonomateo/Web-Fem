ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS privacy_consent_at timestamptz;
