import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState, useAudioPlayer } from "expo-audio";

const API_URL = (process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8080").replace(/\/$/, "");

const languages = [
  { code: "es", label: "Spanish", native: "Español" },
  { code: "fr", label: "French", native: "Français" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "ar", label: "Arabic", native: "العربية" },
];

export default function HomeScreen() {
  const [languageIndex, setLanguageIndex] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const player = useAudioPlayer(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const selectedLanguage = languages[languageIndex];

  async function createVoiceProfile() {
    if (!recordingUri) return Alert.alert("Voice sample required", "Record a clear sample of your voice first.");
    if (!voiceConsent) return Alert.alert("Permission required", "Confirm that this is your voice or that you have explicit permission to clone it.");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("name", "My Voice");
      form.append("consent", "true");
      form.append("file", { uri: recordingUri, name: "voice-sample.m4a", type: "audio/m4a" } as any);
      const response = await fetch(API_URL + "/v1/voice-profiles", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Voice profile creation failed.");
      setVoiceId(data.voiceId);
      Alert.alert("Voice profile created", "Your voice profile is ready. Record a message and translate it.");
    } catch (error) {
      Alert.alert("Voice profile error", error instanceof Error ? error.message : "Check your API connection and provider key.");
    } finally { setBusy(false); }
  }

  async function translateRecording() {
    if (!recordingUri) return;
    if (!voiceId) return Alert.alert("Create your voice profile", "Record a clear voice sample, confirm permission, and create your voice profile first.");
    setBusy(true);
    setTranscript(""); setTranslatedText(""); setPreviewUrl(null);
    try {
      const form = new FormData();
      form.append("sourceLanguage", "en");
      form.append("targetLanguage", selectedLanguage.code);
      form.append("voiceId", voiceId);
      form.append("file", { uri: recordingUri, name: "voice-message.m4a", type: "audio/m4a" } as any);
      const response = await fetch(API_URL + "/v1/voice/translate", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Voice translation failed.");
      setTranscript(data.transcript);
      setTranslatedText(data.translatedText);
      const url = API_URL + data.audioUrl;
      setPreviewUrl(url);
      await player.replace({ uri: url });
      Alert.alert("Translation ready", "Review the transcript and translation, then play your generated voice preview.");
    } catch (error) {
      Alert.alert("Translation error", error instanceof Error ? error.message : "Check your API connection and provider keys.");
    } finally { setBusy(false); }
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
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      Alert.alert("Recording error", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandMark}><Text style={styles.brandMarkText}>V</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.brand}>VOICEBRIDGE</Text>
            <Text style={styles.brandSub}>YOUR VOICE. EVERY LANGUAGE.</Text>
          </View>
          <View style={styles.avatar}><Text style={styles.avatarText}>You</Text></View>
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
              <Text style={styles.panelHint}>Original language · English</Text>
            </View>
            <View style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>READY</Text></View>
          </View>

          <View style={styles.wave}>
            {Array.from({ length: 37 }, (_, i) => (
              <View key={i} style={[styles.waveBar, { height: 12 + ((i * 17 + 9) % 35) }]} />
            ))}
          </View>

          <Text style={styles.recordStatus}>
            {recorderState.isRecording ? "Recording your voice…" : recordingUri ? "Recording saved on this device" : "Tap below to start recording"}
          </Text>

          <Pressable onPress={toggleRecording} style={({ pressed }) => [styles.recordButton, pressed && styles.pressed]}>
            <View style={styles.recordIcon}><View style={recorderState.isRecording ? styles.stopIcon : styles.micIcon} /></View>
            <Text style={styles.recordButtonText}>{recorderState.isRecording ? "Stop recording" : "Start recording"}</Text>
          </Pressable>

          <Text style={styles.sectionLabel}>TRANSLATE INTO</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.languageList}>
            {languages.map((language, index) => (
              <Pressable key={language.code} onPress={() => setLanguageIndex(index)} style={[styles.languageChip, languageIndex === index && styles.languageChipActive]}>
                <Text style={[styles.languageName, languageIndex === index && styles.languageNameActive]}>{language.label}</Text>
                <Text style={[styles.languageNative, languageIndex === index && styles.languageNameActive]}>{language.native}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.voiceSetup}>
            <Text style={styles.sectionLabel}>YOUR CLONED VOICE</Text>
            <Text style={styles.voiceHint}>{voiceId ? "Voice profile connected" : "Create a voice profile from a clear recording (ideally 1–2 minutes)."}</Text>
            <Pressable onPress={() => setVoiceConsent(!voiceConsent)} style={styles.consentRow}>
              <View style={[styles.consentBox, voiceConsent && styles.consentBoxActive]}>{voiceConsent ? <Text style={styles.consentTick}>✓</Text> : null}</View>
              <Text style={styles.consentText}>This is my voice, or I have explicit permission to clone it.</Text>
            </Pressable>
            <Pressable onPress={createVoiceProfile} disabled={!recordingUri || busy || !!voiceId} style={[styles.secondaryButton, (!recordingUri || busy || !!voiceId) && styles.translateDisabled]}>
              <Text style={styles.secondaryButtonText}>{voiceId ? "✓  Voice profile ready" : busy ? "Creating voice profile…" : "Create my voice profile"}</Text>
            </Pressable>
          </View>
          <Pressable onPress={translateRecording} disabled={!recordingUri || busy} style={[styles.translateButton, (!recordingUri || busy) && styles.translateDisabled]}>
            <Text style={styles.translateButtonText}>{busy ? "Processing your voice…" : "✦  Transcribe · Translate · Generate voice"}</Text>
          </Pressable>
          {(transcript || translatedText) ? <View style={styles.resultCard}>
            <Text style={styles.sectionLabel}>WHAT YOU SAID · ENGLISH</Text>
            <Text style={styles.resultText}>{transcript}</Text>
            <Text style={styles.sectionLabel}>TRANSLATION · {selectedLanguage.label.toUpperCase()}</Text>
            <Text style={styles.resultText}>{translatedText}</Text>
            <Pressable onPress={() => { if (previewUrl) { player.replace({ uri: previewUrl }); player.play(); } }} disabled={!previewUrl} style={styles.previewButton}>
              <Text style={styles.previewButtonText}>▶  Play cloned-voice preview</Text>
            </Pressable>
          </View> : null}
          <Text style={styles.disclaimer}>AI processing requires API keys on your server. Preview links expire after 30 minutes in this build.</Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Messaging channels</Text>
          <Text style={styles.sectionMeta}>CONNECT IN PHASE 2</Text>
        </View>
        <View style={styles.channels}>
          <View style={styles.channelCard}><Text style={styles.channelIcon}>◉</Text><Text style={styles.channelName}>WhatsApp</Text><Text style={styles.channelState}>Not connected</Text></View>
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
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 29, marginBottom: 12 },
  sectionTitle: { color: "#F1F4ED", fontSize: 15, fontWeight: "800" },
  sectionMeta: { color: "#84917F", fontSize: 8, letterSpacing: 1, fontWeight: "700" },
  channels: { flexDirection: "row", gap: 9 },
  channelCard: { flex: 1, backgroundColor: "#151C17", borderWidth: 1, borderColor: "#28342B", borderRadius: 15, padding: 12, minHeight: 103 },
  channelIcon: { color: "#67D88A", fontSize: 22, fontWeight: "900", marginBottom: 9 },
  channelName: { color: "#E6ECE2", fontSize: 10, fontWeight: "800" },
  channelState: { color: "#829080", fontSize: 8, marginTop: 5 },
  footer: { alignItems: "center", marginTop: 31 },
  footerText: { color: "#667365", fontSize: 8, letterSpacing: 1.3 },
});
