import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

export const supabaseAdmin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
export const supabasePublic = publishableKey ? createClient(url, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
}) : null;
export const audioBucket = process.env.SUPABASE_STORAGE_BUCKET || "voicebridge-private";
export type AuthenticatedUser = { id: string; email?: string };
