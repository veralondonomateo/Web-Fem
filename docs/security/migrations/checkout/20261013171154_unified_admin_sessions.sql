CREATE TABLE IF NOT EXISTS public.fem_admin_sessions(token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
ALTER TABLE public.fem_admin_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fem_admin_sessions FROM anon, authenticated;
GRANT SELECT,INSERT,DELETE ON public.fem_admin_sessions TO service_role;
