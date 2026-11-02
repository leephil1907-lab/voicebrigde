export type LanguageCode = string;

export type TranslationJobStatus =
  | "recorded"
  | "uploading"
  | "transcribing"
  | "transcribed"
  | "translating"
  | "translated"
  | "generating_voice"
  | "voice_generated"
  | "ready_to_send"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "cancelled";

export interface LanguageOption {
  code: LanguageCode;
  name: string;
  nativeName: string;
}

export interface TranslationRequest {
  sourceLanguage: LanguageCode | "auto";
  targetLanguage: LanguageCode;
  audioAssetId: string;
  voiceProfileId?: string;
}

export interface TranslationJob {
  id: string;
  status: TranslationJobStatus;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
  sourceTranscript?: string;
  translatedText?: string;
  generatedAudioAssetId?: string;
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export type MessagingPlatform =
  | "whatsapp_business"
  | "whatsapp_share"
  | "telegram"
  | "android_share";

export interface SendVoiceMessageRequest {
  translationJobId: string;
  platform: MessagingPlatform;
  recipientId?: string;
  approvalToken: string;
}

export interface ProviderCapability {
  platform: MessagingPlatform;
  supportsNativeVoiceMessage: boolean;
  requiresBusinessAccount: boolean;
  requiresRecipientOptIn: boolean;
  notes: string[];
}
