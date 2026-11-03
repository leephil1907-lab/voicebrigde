import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import type { RuntimeConfig } from "../lib/types";
import { ApiError } from "../lib/api";

export function useSession(config: RuntimeConfig | null) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const client = useMemo(() => config?.supabaseUrl && config.supabasePublishableKey ? createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  }) : null, [config?.supabaseUrl, config?.supabasePublishableKey]);

  useEffect(() => {
    if (!client) { setReady(true); setSession(null); return; }
    let active = true;
    setReady(false);
    void client.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setReady(true); } });
    const { data: { subscription } } = client.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setReady(true);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [client]);

  const getToken = useCallback(async () => {
    if (!client) throw new ApiError("Connect Supabase before signing in.", "AUTH_NOT_CONFIGURED", 503);
    const { data: { session: current }, error } = await client.auth.getSession();
    if (error || !current) throw new ApiError("Sign in to translate and save your voice note.", "AUTH_REQUIRED", 401);
    return current.access_token;
  }, [client]);

  return { client, session, ready, recovery, clearRecovery: () => setRecovery(false), getToken };
}
