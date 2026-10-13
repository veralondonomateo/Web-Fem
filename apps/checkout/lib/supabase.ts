import { createClient } from "@supabase/supabase-js";

// Server-side only — uses service role key (bypasses RLS)
export function createServerClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
