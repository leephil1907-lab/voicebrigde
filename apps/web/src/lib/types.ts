export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface RuntimeConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
  maxAudioBytes: number;
  maxAudioSeconds: number;
  maxTranslationsPerDay?: number;
  targetLanguages: string[];
  channels?: { whatsapp: boolean; telegram: boolean };
}

export interface Capabilities {
  authentication: boolean;
  durableJobs: boolean;
  privateAudioStorage: boolean;
  audioToAudioDubbing: boolean;
}

export interface Health {
  status: "ok" | "degraded" | "not_configured";
  service: string;
  capabilities: Capabilities;
}

export interface Language { code: string; name: string; nativeName: string }

export interface TranslationJob {
  id: string;
  status: JobStatus;
  stage: string;
  targetLanguage: string;
  sourceLanguage: string | null;
  sourceTranscript: string;
  translatedTranscript: string;
  audioUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt?: string;
  completedAt: string | null;
}

export interface HistoryJob {
  id: string;
  status: JobStatus;
  stage: string;
  target_language: string;
  source_language: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface AudioClip {
  blob: Blob;
  url: string;
  name: string;
  duration: number;
  peaks: number[];
  origin: "microphone" | "upload";
}

export type ConnectionStatus = "checking" | "ready" | "setup" | "offline";

export interface DeliveryCapabilities {
  authorizedSender: boolean;
  channels: { whatsapp: boolean; telegram: boolean };
}

export interface AccountOverview {
  planCode: "free" | "creator" | "pro" | "business" | "enterprise" | string;
  subscriptionStatus: string;
  currency: string;
  billingInterval: "month" | "year" | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  creditsAvailable: number;
  translationsLast30Days: number;
  maxTranslationsPer24Hours: number;
  checkoutEnabled: boolean;
}
