import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../src/lib/supabase";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");

type Overview = {
  planCode: string;
  subscriptionStatus: string;
  currency: string;
  creditsAvailable: number;
  translationsLast30Days: number;
  maxTranslationsPer24Hours: number;
  currentPeriodEnd: string | null;
};
type BillingCatalog = {
  provider: "paystack";
  currency: "NGN";
  enabled: boolean;
  creditPackages: { code: string; name: string; description: string; amountMinor: number; credits: number }[];
  subscriptionPlans: { code: string; name: string; description: string; paystackPlanCode: string; amountMinor: number; interval: "month" | "year" }[];
};
type VoiceProfile = {
  id: string;
  display_name: string;
  status: string;
  consent: { consent_scope: string; speaker_name: string | null } | null;
};

export default function AccountScreen() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [billingCatalog, setBillingCatalog] = useState<BillingCatalog | null>(null);
  const [billingBusyCode, setBillingBusyCode] = useState("");
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [scope, setScope] = useState<"own_voice" | "authorized_third_party">("own_voice");
  const [speakerName, setSpeakerName] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setLoading(false); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!supabase || !API_URL) throw new Error("The API or Supabase connection is not configured.");
    const { data: { session: current } } = await supabase.auth.getSession();
    if (!current) throw new Error("Your session has expired. Sign in again.");
    const response = await fetch(API_URL + path, {
      ...init,
      headers: { Authorization: "Bearer " + current.access_token, ...(init.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "The request could not be completed.");
    return data;
  }, []);

  const refresh = useCallback(async () => {
    if (!session) { setOverview(null); setProfiles([]); setBillingCatalog(null); return; }
    setBusy(true); setError("");
    try {
      const [summary, voiceList, catalog] = await Promise.all([
        request("/v1/account/overview"),
        request("/v1/account/voice-profiles"),
        request("/v1/billing/catalog"),
      ]);
      setOverview(summary);
      setProfiles(voiceList.items || []);
      setBillingCatalog(catalog);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load account information."); }
    finally { setBusy(false); }
  }, [session, request]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function createProfile() {
    if (!displayName.trim() || !consent || (scope === "authorized_third_party" && !speakerName.trim())) return;
    setBusy(true); setError("");
    try {
      await request("/v1/account/voice-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), consentScope: scope, speakerName: speakerName.trim() || undefined }),
      });
      setDisplayName(""); setSpeakerName(""); setConsent(false);
      await refresh();
      Alert.alert("Saved", "The voice permission record has been saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this voice permission."); }
    finally { setBusy(false); }
  }

  function revokeProfile(id: string) {
    Alert.alert("Revoke voice permission?", "This prevents the profile from being used for future authorized processing.", [
      { text: "Keep", style: "cancel" },
      { text: "Revoke", style: "destructive", onPress: async () => {
        setBusy(true);
        try { await request("/v1/account/voice-profiles/" + id + "/revoke", { method: "POST" }); await refresh(); }
        catch (e) { setError(e instanceof Error ? e.message : "Could not revoke this permission."); }
        finally { setBusy(false); }
      } },
    ]);
  }

  async function startCheckout(type: "credit_topup" | "subscription", productCode: string) {
    const busyCode = type + ":" + productCode;
    setBillingBusyCode(busyCode); setError("");
    try {
      const result = await request("/v1/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, productCode }),
      });
      await Linking.openURL(result.authorizationUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open Paystack checkout."); }
    finally { setBillingBusyCode(""); }
  }

  const formatNGN = (amountMinor: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amountMinor / 100);

  async function signOut() {
    if (!supabase) return;
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) return Alert.alert("Sign-out failed", signOutError.message);
    router.replace("/");
  }

  if (loading) return <SafeAreaView style={styles.safe}><Text style={styles.copy}>Loading your account…</Text></SafeAreaView>;
  if (!session) return <SafeAreaView style={styles.safe}><View style={styles.page}><Text style={styles.brand}>VOICEBRIDGE</Text><Text style={styles.title}>Sign in required</Text><Text style={styles.copy}>Return to the app and sign in to manage your account.</Text><Pressable style={styles.primary} onPress={() => router.replace("/")}><Text style={styles.primaryText}>Back to VoiceBridge</Text></Pressable></View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.top}><Pressable onPress={() => router.back()}><Text style={styles.back}>‹  BACK</Text></Pressable><Pressable onPress={signOut}><Text style={styles.signOut}>SIGN OUT</Text></Pressable></View>
      <Text style={styles.brand}>VOICEBRIDGE</Text>
      <Text style={styles.title}>Your account.</Text>
      <Text style={styles.copy}>{session.user.email || "Signed-in account"}</Text>

      <View style={styles.card}>
        <Text style={styles.kicker}>PLAN & USAGE</Text>
        {overview ? <>
          <Text style={styles.plan}>{overview.planCode.toUpperCase()} PLAN</Text>
          <View style={styles.metricRow}><Text style={styles.metricLabel}>Translations · last 30 days</Text><Text style={styles.metricValue}>{overview.translationsLast30Days}</Text></View>
          <View style={styles.metricRow}><Text style={styles.metricLabel}>Rolling 24-hour limit</Text><Text style={styles.metricValue}>{overview.maxTranslationsPer24Hours}</Text></View>
          <View style={styles.metricRow}><Text style={styles.metricLabel}>Available credits</Text><Text style={styles.metricValue}>{overview.creditsAvailable}</Text></View>
          <Text style={styles.note}>Payments are processed securely by Paystack. Credits are added only after server verification.</Text>
        </> : <Text style={styles.copy}>{busy ? "Loading…" : "Usage information is not available."}</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.kicker}>PAYSTACK CHECKOUT · NGN</Text>
        <Text style={styles.cardTitle}>Credits & subscriptions</Text>
        {!billingCatalog?.enabled ? <Text style={styles.copy}>Paystack checkout will appear here after the server test keys and prices are configured.</Text> : <>
          <Text style={styles.label}>Credit top-ups</Text>
          {billingCatalog.creditPackages.length ? billingCatalog.creditPackages.map(item => <View key={item.code} style={styles.billingRow}><View style={{ flex: 1 }}><Text style={styles.profileName}>{item.name}</Text><Text style={styles.profileMeta}>{item.credits.toLocaleString("en-NG")} credits · {formatNGN(item.amountMinor)}</Text>{item.description ? <Text style={styles.profileMeta}>{item.description}</Text> : null}</View><Pressable disabled={Boolean(billingBusyCode)} onPress={() => void startCheckout("credit_topup", item.code)} style={styles.buyButton}><Text style={styles.buyButtonText}>{billingBusyCode === "credit_topup:"+item.code ? "…" : "Buy"}</Text></Pressable></View>) : <Text style={styles.copy}>No credit packages are configured yet.</Text>}
          <Text style={styles.label}>Recurring plans</Text>
          {billingCatalog.subscriptionPlans.length ? billingCatalog.subscriptionPlans.map(item => <View key={item.code} style={styles.billingRow}><View style={{ flex: 1 }}><Text style={styles.profileName}>{item.name}</Text><Text style={styles.profileMeta}>{formatNGN(item.amountMinor)} / {item.interval === "month" ? "month" : "year"}</Text>{item.description ? <Text style={styles.profileMeta}>{item.description}</Text> : null}</View><Pressable disabled={Boolean(billingBusyCode)} onPress={() => void startCheckout("subscription", item.code)} style={styles.buyButton}><Text style={styles.buyButtonText}>{billingBusyCode === "subscription:"+item.code ? "…" : "Subscribe"}</Text></Pressable></View>) : <Text style={styles.copy}>Subscription plans will appear after Paystack plan codes are configured.</Text>}
        </>}
      </View>

      <View style={styles.card}>
        <Text style={styles.kicker}>VOICE PERMISSIONS</Text>
        <Text style={styles.cardTitle}>Authorized voices</Text>
        <Text style={styles.copy}>Save a permission record for voices you are authorized to process. This does not create a permanent cloned voice; Dubbing v2 uses the current recording as its voice reference.</Text>
        <Text style={styles.label}>Profile name</Text>
        <TextInput value={displayName} onChangeText={setDisplayName} placeholder="e.g. My voice" placeholderTextColor="#71806F" style={styles.input} maxLength={80} />
        <Text style={styles.label}>Permission type</Text>
        <View style={styles.choiceRow}>
          <Pressable onPress={() => setScope("own_voice")} style={[styles.choice, scope === "own_voice" && styles.choiceActive]}><Text style={[styles.choiceText, scope === "own_voice" && styles.choiceTextActive]}>My voice</Text></Pressable>
          <Pressable onPress={() => setScope("authorized_third_party")} style={[styles.choice, scope === "authorized_third_party" && styles.choiceActive]}><Text style={[styles.choiceText, scope === "authorized_third_party" && styles.choiceTextActive]}>Someone else's</Text></Pressable>
        </View>
        {scope === "authorized_third_party" ? <><Text style={styles.label}>Speaker name</Text><TextInput value={speakerName} onChangeText={setSpeakerName} placeholder="Speaker's name" placeholderTextColor="#71806F" style={styles.input} maxLength={80} /></> : null}
        <Pressable onPress={() => setConsent(value => !value)} style={styles.consentRow} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
          <View style={[styles.checkbox, consent && styles.checkboxActive]}>{consent ? <Text style={styles.checkboxTick}>✓</Text> : null}</View>
          <Text style={styles.consentText}>I confirm that I am the speaker, or that the speaker has explicitly authorized VoiceBridge to store this voice permission record and process their voice for the selected purpose. I understand consent can be revoked for future use.</Text>
        </Pressable>
        <Pressable disabled={busy || !displayName.trim() || !consent || (scope === "authorized_third_party" && !speakerName.trim())} onPress={createProfile} style={[styles.primary, (busy || !displayName.trim() || !consent || (scope === "authorized_third_party" && !speakerName.trim())) && styles.disabled]}><Text style={styles.primaryText}>{busy ? "Please wait…" : "Save voice permission"}</Text></Pressable>
        {profiles.map(profile => <View key={profile.id} style={styles.profileRow}><View style={{ flex: 1 }}><Text style={styles.profileName}>{profile.display_name}</Text><Text style={styles.profileMeta}>{profile.consent?.consent_scope === "own_voice" ? "Own voice" : "Authorized speaker"} · {profile.status}</Text></View>{profile.status === "active" ? <Pressable onPress={() => revokeProfile(profile.id)}><Text style={styles.revoke}>REVOKE</Text></Pressable> : <Text style={styles.revoked}>REVOKED</Text>}</View>)}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable onPress={() => void refresh()} style={styles.secondary}><Text style={styles.secondaryText}>Refresh account data</Text></Pressable>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0D120F" },
  page: { padding: 22, paddingBottom: 42 },
  top: { flexDirection: "row", justifyContent: "space-between", marginBottom: 28 },
  back: { color: "#D6F269", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  signOut: { color: "#9BA79A", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  brand: { color: "#D6F269", fontSize: 11, fontWeight: "900", letterSpacing: 2.2 },
  title: { color: "#F3F5EF", fontSize: 29, fontWeight: "800", marginTop: 16 },
  copy: { color: "#9BA79A", fontSize: 11, lineHeight: 18, marginTop: 8 },
  card: { backgroundColor: "#171F19", borderWidth: 1, borderColor: "#2B382D", borderRadius: 18, padding: 17, marginTop: 18 },
  kicker: { color: "#B5CE62", fontSize: 9, fontWeight: "900", letterSpacing: 1.6 },
  plan: { color: "#F2F5EE", fontSize: 19, fontWeight: "900", marginTop: 12, marginBottom: 10 },
  cardTitle: { color: "#F2F5EE", fontSize: 16, fontWeight: "800", marginTop: 10 },
  metricRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11, borderTopWidth: 1, borderTopColor: "#2B382D" },
  metricLabel: { color: "#9BA79A", fontSize: 10 },
  metricValue: { color: "#D6F269", fontSize: 11, fontWeight: "900" },
  note: { color: "#849181", fontSize: 9, lineHeight: 15, marginTop: 12 },
  label: { color: "#B8C3B4", fontSize: 10, fontWeight: "800", marginTop: 15, marginBottom: 7 },
  input: { backgroundColor: "#101712", color: "#F3F5EF", borderWidth: 1, borderColor: "#344036", borderRadius: 10, padding: 12, fontSize: 11 },
  choiceRow: { flexDirection: "row", gap: 8 },
  choice: { flex: 1, borderWidth: 1, borderColor: "#344036", borderRadius: 9, padding: 11, alignItems: "center" },
  choiceActive: { backgroundColor: "#29351F", borderColor: "#AFCB60" },
  choiceText: { color: "#9BA79A", fontSize: 10, fontWeight: "700" },
  choiceTextActive: { color: "#D6F269" },
  consentRow: { flexDirection: "row", alignItems: "flex-start", marginTop: 15 },
  checkbox: { width: 18, height: 18, borderWidth: 1, borderColor: "#66745B", borderRadius: 5, marginRight: 9, alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: "#D6F269", borderColor: "#D6F269" },
  checkboxTick: { color: "#172014", fontWeight: "900", fontSize: 12 },
  consentText: { color: "#B9C4B5", fontSize: 10, flex: 1, lineHeight: 16 },
  primary: { backgroundColor: "#D6F269", borderRadius: 11, padding: 14, alignItems: "center", marginTop: 15 },
  primaryText: { color: "#172014", fontSize: 11, fontWeight: "900" },
  disabled: { opacity: 0.45 },
  profileRow: { flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#2B382D", paddingVertical: 12, marginTop: 10 },
  billingRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: "#2B382D", paddingVertical: 12, marginTop: 8 },
  buyButton: { backgroundColor: "#D6F269", borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },
  buyButtonText: { color: "#172014", fontSize: 9, fontWeight: "900" },
  profileName: { color: "#E6ECE2", fontSize: 11, fontWeight: "800" },
  profileMeta: { color: "#849181", fontSize: 9, marginTop: 4 },
  revoke: { color: "#F0B2A7", fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  revoked: { color: "#849181", fontSize: 8, fontWeight: "900" },
  error: { color: "#F1C27B", fontSize: 10, lineHeight: 16, marginTop: 12 },
  secondary: { borderWidth: 1, borderColor: "#56683B", borderRadius: 11, padding: 13, alignItems: "center", marginTop: 16 },
  secondaryText: { color: "#D6F269", fontSize: 10, fontWeight: "800" },
});
