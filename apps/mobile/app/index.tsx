import { useEffect, useState } from "react";
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, useAudioPlayer } from "expo-audio";
import { supabase } from "../src/lib/supabase";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/$/, "");

const languages = [
  { code: "es", label: "Spanish", native: "Español" },
  { code: "fr", label: "French", native: "Français" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "ar", label: "Arabic", native: "العربية" },
  { code: "ha", label: "Hausa", native: "Hausa" },
  { code: "yo", label: "Yoruba", native: "Yorùbá" },
  { code: "sw", label: "Swahili", native: "Kiswahili" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "nl", label: "Dutch", native: "Nederlands" },
  { code: "ru", label: "Russian", native: "Русский" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "ur", label: "Urdu", native: "اردو" },
];

export default function HomeScreen() {
  const [session, setSession] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [languageIndex, setLanguageIndex] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceTranscript, setSourceTranscript] = useState("");
  const [translatedTranscript, setTranslatedTranscript] = useState("");
  const [detectedSourceLanguage, setDetectedSourceLanguage] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  const player = useAudioPlayer(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const selectedLanguage = languages[languageIndex];

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setAuthReady(true); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    if (AppState.currentState === "active") client.auth.startAutoRefresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
    return () => subscription.remove();
  }, []);

  async function submitAuth() {
    if (!supabase) return Alert.alert("Authentication is not configured", "Set the Supabase URL and publishable key in the mobile environment.");
    if (!email.trim() || password.length < 8) return Alert.alert("Check your details", "Enter a valid email and a password with at least 8 characters.");
    setAuthBusy(true);
    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        if (!data.session) Alert.alert("Check your email", "Confirm your email address, then sign in to VoiceBridge.");
        else setSession(data.session);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setSession(data.session);
      }
    } catch (error) {
      Alert.alert(authMode === "signup" ? "Sign-up failed" : "Sign-in failed", error instanceof Error ? error.message : "Please try again.");
    } finally { setAuthBusy(false); }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert("Sign-out failed", error.message);
    else { setSession(null); setPreviewUrl(null); setRecordingUri(null); }
  }

  async function translateRecording() {
    if (!recordingUri) return;
    if (!API_URL) return Alert.alert("API address required", "Set EXPO_PUBLIC_API_URL in apps/mobile/.env to your deployed API URL or your computer’s LAN IP.");
    if (!supabase || !session) return Alert.alert("Sign in required", "Sign in before creating a translation.");
    setBusy(true);
    setPreviewUrl(null); setSourceTranscript(""); setTranslatedTranscript(""); setDetectedSourceLanguage(null); setTranslationStatus("Uploading your recording…");
    try {
      const form = new FormData();
      form.append("sourceLanguage", "auto");
      form.append("targetLanguage", selectedLanguage.code);
      // Recording and explicitly choosing Translate grants consent for this upload.
      form.append("voiceConsent", "true");
      form.append("file", { uri: recordingUri, name: "voice-message.m4a", type: "audio/m4a" } as any);
      const { data: { session: activeSession } } = await supabase.auth.getSession();
      if (!activeSession) throw new Error("Your session expired. Sign in again.");
      const authHeaders = { Authorization: "Bearer " + activeSession.access_token };
      const response = await fetch(API_URL + "/v1/voice/translate", { method: "POST", headers: authHeaders, body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Voice translation failed.");
      setTranslationStatus("Preparing the original speaker's translated voice…");
      let job = data;
      for (let attempt = 0; attempt < 480; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!currentSession) throw new Error("Your session expired. Sign in again.");
        const statusResponse = await fetch(API_URL + "/v1/voice/translations/" + data.id, { headers: { Authorization: "Bearer " + currentSession.access_token } });
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(statusData.message || "Could not check translation status.");
        job = statusData;
        if (job.status === "failed") throw new Error(job.error || "Voice translation failed.");
        if (job.status === "completed" && job.audioUrl) break;
        const stageMessages: Record<string, string> = {
          queued: "Your recording is safely queued…",
          downloading_source: "Preparing your recording…",
          creating_dubbing_project: "Starting voice translation…",
          preparing_source: "Detecting speech and preparing the source…",
          creating_target_language: "Preparing the target language…",
          translating_audio: "Translating while preserving the speaker's delivery…",
          downloading_translation: "Finishing your translated voice message…",
          retry_wait: "Recovering the translation job; it will retry automatically…",
        };
        setTranslationStatus(stageMessages[job.stage] || "Processing your translated voice message…");
      }
      if (job.status !== "completed" || !job.audioUrl) throw new Error("This translation is taking longer than expected. Please try again.");
      const url = job.audioUrl.startsWith("http") ? job.audioUrl : API_URL + job.audioUrl;
      setPreviewUrl(url);
      setSourceTranscript(job.sourceTranscript || "Transcript unavailable for this recording.");
      setTranslatedTranscript(job.translatedTranscript || "Translated transcript unavailable; listen to the audio preview.");
      setDetectedSourceLanguage(job.sourceLanguage || null);
      setTranslationStatus("Translation ready");
      await player.replace({ uri: url });
      Alert.alert("Translation ready", "Your translated audio is ready. Preview it before sharing.");
    } catch (error) {
      setTranslationStatus("");
      Alert.alert("Translation error", error instanceof Error ? error.message : "Check your API connection and provider keys.");
    } finally { setBusy(false); }
  }

  async function shareToWhatsApp() {
    if (!previewUrl) return Alert.alert("Translation required", "Generate and preview a translated voice message first.");
    if (!API_URL) return Alert.alert("API address required", "Set EXPO_PUBLIC_API_URL in apps/mobile/.env.");
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("The Android share sheet is not available on this device.");
      const source = new File(Paths.cache, `voicebridge-${Date.now()}.ogg`);
      const localAudio = await File.downloadFileAsync(previewUrl, source);
      await Sharing.shareAsync(localAudio.uri, {
        dialogTitle: "Send translated voice message",
        mimeType: "audio/ogg",
      });
    } catch (error) {
      Alert.alert("WhatsApp sharing", error instanceof Error ? error.message : "Could not prepare the translated audio for sharing.");
    } finally {
      setSharing(false);
    }
  }

  async function toggleRecording() {
    try {
      if (recorderState.isRecording) {
        await recorder.stop();
        setRecordingUri(recorder.uri ?? null);
        return;
      }

      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone permission required", "Allow microphone access to record a message.");
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      setRecordingUri(null);
      setPreviewUrl(null);
      setSourceTranscript("");
      setTranslatedTranscript("");
      setTranslationStatus("");
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      Alert.alert("Recording error", error instanceof Error ? error.message : "Please try again.");
    }
  }

  if (!authReady) return <SafeAreaView style={styles.safe}><View style={styles.authPage}><Text style={styles.brand}>VOICEBRIDGE</Text><Text style={styles.authCopy}>Loading your secure session…</Text></View></SafeAreaView>;

  if (!session) return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.authPage}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>V</Text></View>
        <Text style={styles.brand}>VOICEBRIDGE</Text>
        <Text style={styles.authTitle}>{authMode === "signin" ? "Welcome back." : "Create your account."}</Text>
        <Text style={styles.authCopy}>Your translations and recordings are private to your account.</Text>
        {!supabase ? <Text style={styles.authError}>Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable secure sign-in.</Text> : null}
        <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor="#778477" style={styles.authInput} />
        <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password (8+ characters)" placeholderTextColor="#778477" style={styles.authInput} />
        <Pressable disabled={authBusy || !supabase} onPress={submitAuth} style={[styles.authButton, (authBusy || !supabase) && styles.translateDisabled]}><Text style={styles.authButtonText}>{authBusy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}</Text></Pressable>
        <Pressable onPress={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}><Text style={styles.authSwitch}>{authMode === "signin" ? "New to VoiceBridge? Create an account" : "Already registered? Sign in"}</Text></Pressable>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>V</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brand}>VOICEBRIDGE</Text>
            <Text style={styles.brandSub}>YOUR VOICE. EVERY LANGUAGE.</Text>
          </View>
          <Pressable onPress={signOut} style={styles.avatar}><Text style={styles.avatarText}>Sign out</Text></Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>MULTILINGUAL VOICE MESSAGING</Text>
          <Text style={styles.title}>Speak naturally.</Text>
          <Text style={styles.titleAccent}>Be understood everywhere.</Text>
          <Text style={styles.description}>Record in your language. Translate your message. Preview the voice before you send.</Text>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelTop}>
            <View>
              <Text style={styles.panelTitle}>New voice message</Text>
              <Text style={styles.panelHint}>Source language · Auto-detected</Text>
            </View>
            <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>READY</Text></View>
          </View>

          <View style={styles.wave}>
            {Array.from({ length: 37 }, (_, i) => (
              <View key={i} style={[styles.waveBar, { height: 12 + ((i * 17 + 9) % 35) }]} />
            ))}
          </View>

          <Text style={styles.recordStatus}>
            {recorderState.isRecording ? "Recording your voice…" : recordingUri ? "Recording saved on this device" : "Record a message in the language you speak; VoiceBridge detects it automatically"}
          </Text>

          <Pressable onPress={toggleRecording} disabled={busy} style={({ pressed }) => [styles.recordButton, pressed && styles.pressed, busy && styles.translateDisabled]}>
            <View style={styles.recordIcon}><View style={recorderState.isRecording ? styles.stopIcon : styles.micIcon} /></View>
            <Text style={styles.recordButtonText}>{recorderState.isRecording ? "Stop recording" : "Start recording"}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>TRANSLATE INTO</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.languageList}>
            {languages.map((language, index) => (
              <Pressable key={language.code} disabled={busy} onPress={() => { setLanguageIndex(index); setPreviewUrl(null); setSourceTranscript(""); setTranslatedTranscript(""); setTranslationStatus(""); }} style={[styles.languageChip, languageIndex === index && styles.languageChipActive]}>
                <Text style={[styles.languageName, languageIndex === index && styles.languageNameActive]}>{language.label}</Text>
                <Text style={[styles.languageNative, languageIndex === index && styles.languageNameActive]}>{language.native}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.voiceSetup}>
            <Text style={styles.sectionLabel}>VOICE PRESERVATION</Text>
            <Text style={styles.voiceHint}>VoiceBridge uses the speaker in each recording as the voice reference. You do not need to enroll a separate voice profile for Dubbing v2.</Text>
          </View>
          <Pressable onPress={translateRecording} disabled={!recordingUri || busy} style={[styles.translateButton, (!recordingUri || busy) && styles.translateDisabled]}>
            <Text style={styles.translateButtonText}>{busy ? "Processing your voice…" : "✦  Translate voice · Preserve expression"}</Text>
          </Pressable>
          {previewUrl ? <View style={styles.resultCard}>
            <Text style={styles.sectionLabel}>SOURCE · {detectedSourceLanguage ? detectedSourceLanguage.toUpperCase() : "AUTO-DETECTED"}</Text>
            <Text style={styles.resultText}>{sourceTranscript}</Text>
            <Text style={styles.sectionLabel}>TRANSLATION · {selectedLanguage.label.toUpperCase()}</Text>
            <Text style={styles.resultText}>{translatedTranscript}</Text>
            <Pressable onPress={() => { if (previewUrl) { player.replace({ uri: previewUrl }); player.play(); } }} disabled={!previewUrl} style={styles.previewButton}>
              <Text style={styles.previewButtonText}>▶  Play translated voice preview</Text>
            </Pressable>
            <Pressable onPress={shareToWhatsApp} disabled={!previewUrl || sharing} style={[styles.shareButton, (!previewUrl || sharing) && styles.translateDisabled]}>
              <Text style={styles.shareButtonText}>{sharing ? "Preparing audio…" : "Share audio · choose WhatsApp"}</Text>
            </Pressable>
            <Text style={styles.shareHint}>Android will open the system share sheet. Choose WhatsApp, select the chat and confirm. It sends from your personal WhatsApp account, but WhatsApp may display it as an audio attachment rather than a native voice-note bubble.</Text>
          </View> : null}
          <Text style={styles.disclaimer}>{translationStatus || "Dubbing v2 automatically matches the speaker from each recording. Preview links expire after 30 minutes in this build."}</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Messaging channels</Text>
          <Text style={styles.sectionMeta}>WHATSAPP PRIORITY</Text>
        </View>
        <View style={styles.channels}>
          <View style={styles.channelCard}><Text style={styles.channelIcon}>◉</Text><Text style={styles.channelName}>WhatsApp Personal</Text><Text style={styles.channelState}>Android share hand-off</Text></View><View style={styles.channelCard}><Text style={styles.channelIcon}>◉</Text><Text style={styles.channelName}>WhatsApp Business</Text><Text style={styles.channelState}>Cloud API · setup required</Text></View>
          <View style={styles.channelCard}><Text style={[styles.channelIcon, { color: "#55B9F3" }]}>➤</Text><Text style={styles.channelName}>Telegram</Text><Text style={styles.channelState}>Not connected</Text></View>
          <View style={styles.channelCard}><Text style={[styles.channelIcon, { color: "#D7E6D9" }]}>＋</Text><Text style={styles.channelName}>More apps</Text><Text style={styles.channelState}>Coming later</Text></View>
        </View>

        <View style={styles.footer}><Text style={styles.footerText}>VOICEBRIDGE AI  ·  AI VOICE ENGINE 0.2.0</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0D120F" },
  authPage: { flex: 1, justifyContent: "center", padding: 28 },
  authTitle: { color: "#F3F5EF", fontSize: 29, fontWeight: "800", marginTop: 38 },
  authCopy: { color: "#9BA79A", fontSize: 13, lineHeight: 20, marginTop: 10, marginBottom: 22 },
  authError: { color: "#F1C27B", fontSize: 11, lineHeight: 17, marginBottom: 12 },
  authInput: { backgroundColor: "#171F19", color: "#F3F5EF", borderWidth: 1, borderColor: "#344036", borderRadius: 12, padding: 15, marginBottom: 11 },
  authButton: { backgroundColor: "#D6F269", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 7 },
  authButtonText: { color: "#172014", fontWeight: "900", fontSize: 13 },
  authSwitch: { color: "#D6F269", fontSize: 11, fontWeight: "700", textAlign: "center", marginTop: 20 },
  content: { padding: 22, paddingBottom: 42 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 38 },
  brandMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: "#D6F269", alignItems: "center", justifyContent: "center" },
  brandMarkText: { color: "#111710", fontSize: 23, fontWeight: "900" },
  brandCopy: { marginLeft: 11, flex: 1 },
  brand: { color: "#F2F5EE", fontSize: 14, fontWeight: "900", letterSpacing: 2.1 },
  brandSub: { color: "#839080", fontSize: 8, letterSpacing: 1.3, marginTop: 4 },
  avatar: { borderWidth: 1, borderColor: "#344036", borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 },
  avatarText: { color: "#DCE5D8", fontSize: 11, fontWeight: "700" },
  hero: { marginBottom: 27 },
  eyebrow: { color: "#B5CE62", fontSize: 9, fontWeight: "800", letterSpacing: 2, marginBottom: 13 },
  title: { color: "#F3F5EF", fontSize: 33, fontWeight: "800", letterSpacing: -1.1 },
  titleAccent: { color: "#D6F269", fontSize: 27, fontWeight: "700", letterSpacing: -0.8, marginTop: 2 },
  description: { color: "#9BA79A", fontSize: 13, lineHeight: 21, marginTop: 13, maxWidth: 330 },
  panel: { backgroundColor: "#171F19", borderWidth: 1, borderColor: "#2B382D", borderRadius: 23, padding: 18 },
  panelTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panelTitle: { color: "#F2F5EE", fontSize: 16, fontWeight: "800" },
  panelHint: { color: "#899789", fontSize: 10, marginTop: 5 },
  liveBadge: { flexDirection: "row", alignItems: "center", borderRadius: 20, backgroundColor: "#253324", paddingHorizontal: 9, paddingVertical: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 4, backgroundColor: "#D6F269", marginRight: 6 },
  liveText: { color: "#D6F269", fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  wave: { height: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 6 },
  waveBar: { width: 3, borderRadius: 3, backgroundColor: "#A8C45B", opacity: 0.8 },
  recordStatus: { color: "#A0AB9E", textAlign: "center", fontSize: 11, marginBottom: 15 },
  recordButton: { backgroundColor: "#D6F269", borderRadius: 15, paddingVertical: 15, flexDirection: "row", justifyContent: "center", alignItems: "center" },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  recordIcon: { width: 20, height: 20, alignItems: "center", justifyContent: "center", marginRight: 9 },
  micIcon: { width: 9, height: 14, borderRadius: 6, borderWidth: 2, borderColor: "#172014" },
  stopIcon: { width: 11, height: 11, borderRadius: 2, backgroundColor: "#172014" },
  recordButtonText: { color: "#172014", fontSize: 13, fontWeight: "900" },
  sectionLabel: { color: "#839080", fontSize: 9, fontWeight: "800", letterSpacing: 1.5, marginTop: 24, marginBottom: 10 },
  languageList: { gap: 8, paddingBottom: 3 },
  languageChip: { borderWidth: 1, borderColor: "#344036", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, minWidth: 91 },
  languageChipActive: { backgroundColor: "#29351F", borderColor: "#AFCB60" },
  languageName: { color: "#D5DED2", fontSize: 10, fontWeight: "700" },
  languageNative: { color: "#849181", fontSize: 9, marginTop: 3 },
  languageNameActive: { color: "#D6F269" },
  translateButton: { backgroundColor: "#283322", borderRadius: 13, padding: 15, alignItems: "center", marginTop: 17, borderWidth: 1, borderColor: "#56683B" },
  translateDisabled: { opacity: 0.45 },
  translateButtonText: { color: "#D6F269", fontSize: 12, fontWeight: "800" },
  disclaimer: { color: "#788477", fontSize: 9, textAlign: "center", marginTop: 10 },
  voiceSetup: { marginTop: 20, paddingTop: 17, borderTopWidth: 1, borderTopColor: "#2B382D" },
  voiceHint: { color: "#9BA79A", fontSize: 10, lineHeight: 16, marginTop: 4 },
  consentRow: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  consentBox: { width: 18, height: 18, borderWidth: 1, borderColor: "#66745B", borderRadius: 5, marginRight: 9, alignItems: "center", justifyContent: "center" },
  consentBoxActive: { backgroundColor: "#D6F269", borderColor: "#D6F269" },
  consentTick: { color: "#172014", fontWeight: "900", fontSize: 12 },
  consentText: { color: "#B9C4B5", fontSize: 10, flex: 1 },
  secondaryButton: { borderWidth: 1, borderColor: "#56683B", borderRadius: 12, padding: 12, alignItems: "center", marginTop: 12 },
  secondaryButtonText: { color: "#D6F269", fontSize: 11, fontWeight: "800" },
  resultCard: { marginTop: 15, padding: 14, borderRadius: 14, backgroundColor: "#111813", borderWidth: 1, borderColor: "#344036" },
  resultText: { color: "#E4EADF", fontSize: 12, lineHeight: 19, marginTop: 5, marginBottom: 12 },
  previewButton: { backgroundColor: "#D6F269", borderRadius: 11, padding: 13, alignItems: "center" },
  previewButtonText: { color: "#172014", fontSize: 11, fontWeight: "900" },
  shareButton: { backgroundColor: "#26382A", borderWidth: 1, borderColor: "#627B43", borderRadius: 11, padding: 13, alignItems: "center", marginTop: 9 },
  shareButtonText: { color: "#D6F269", fontSize: 10, fontWeight: "900", textAlign: "center" },
  shareHint: { color: "#849181", fontSize: 9, lineHeight: 14, marginTop: 8 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 29, marginBottom: 12 },
  sectionTitle: { color: "#F1F4ED", fontSize: 15, fontWeight: "800" },
  sectionMeta: { color: "#84917F", fontSize: 8, letterSpacing: 1, fontWeight: "700" },
  channels: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  channelCard: { flexGrow: 1, flexBasis: "45%", minWidth: 135, backgroundColor: "#151C17", borderWidth: 1, borderColor: "#28342B", borderRadius: 15, padding: 12, minHeight: 103 },
  channelIcon: { color: "#67D88A", fontSize: 22, fontWeight: "900", marginBottom: 9 },
  channelName: { color: "#E6ECE2", fontSize: 10, fontWeight: "800" },
  channelState: { color: "#829080", fontSize: 8, marginTop: 5 },
  footer: { alignItems: "center", marginTop: 31 },
  footerText: { color: "#667365", fontSize: 8, letterSpacing: 1.3 },
});
