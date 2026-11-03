# Research: voice translation repositories

Reviewed 3 November 2026. This is a technical review, not a claim that these projects were run, benchmarked, security-audited, or integrated. The website currently uses Supabase and ElevenLabs Dubbing v2; retain that stack for voice notes. Native messaging still requires official provider integrations.

## CODUM-STREAM

Sources: [README](https://github.com/codumtr/CODUM-STREAM), [VAD](https://github.com/codumtr/CODUM-STREAM/blob/main/core/vad.py), [health monitor](https://github.com/codumtr/CODUM-STREAM/blob/main/core/health_monitor.py), [license](https://github.com/codumtr/CODUM-STREAM/blob/main/LICENSE.md).

The repository describes a Turkish-to-English streaming workflow: microphone capture, voice activity detection, speech-to-text, language translation, voice synthesis and playback. The source describes frame-counted silence detection and separate latency/queue health signals. Product ideas worth independently designing: private rehearsal before sending, recording quality warnings, and visible stage/queue diagnostics. A future streaming proof of concept could test endpoint detection and capture-to-first-audio latency, but must report interruptions and avoid silently discarding speech in a personal conversation. Its README claims a lab latency of roughly 650 ms to 1.1 s under specific conditions; that is a repository claim, not a benchmark of VoiceBridge or a promise for users.

The license is proprietary and restricts rebranding, paid SaaS and distributing modified versions as an independent product. Do not copy its source, UI assets, or branding into VoiceBridge without appropriate permission and legal review. General engineering concepts can be designed independently.

## ALAD-Mobile

Sources: [README](https://github.com/navidseyedain/ALAD-Mobile), [license](https://github.com/navidseyedain/ALAD-Mobile/blob/main/LICENSE).

An Android app describes capture through MediaProjection, WebSocket audio streaming, simultaneous original and translated subtitles, adjustable original/dub volume and output voice personas. This is useful as a design reference for bilingual captions and a clearly labeled future live-session interface. It uses Android-specific capture; a website does not inherit access to a personal WhatsApp inbox or every app's audio. Its listed personas should not be represented as cloning the user's own voice. Its MIT license requires preserving the copyright and permission notices when code or substantial portions are reused; also review third-party dependencies and model/provider terms. This research does not add Gemini or switch the existing backend.

## shiefzhang/voicetranslator

Sources: [README](https://github.com/shiefzhang/voicetranslator), [GitHub license lookup](https://api.github.com/repos/shiefzhang/voicetranslator/license).

The repository describes an offline Android/iOS speech-recognition and text-translation pipeline, model readiness indicators, language-route-specific availability and playback/recording tradeoffs. Useful ideas: show the original and translated transcript separately, expose missing capability and never present unsupported routes as available; test accuracy by language pair and keep a manual replay option. It uses system TTS, which is not evidence of preservation of the user's voice. The offline models have substantial storage and device requirements and are not a drop-in replacement for the existing web/backend stack. GitHub's license endpoint returned 404 and a root license was not identified in this review; do not copy code without confirming rights. Models and dependencies may have separate licenses.

## AsamiKafune/VoiceTranslator-Python

Sources: [source](https://github.com/AsamiKafune/VoiceTranslator-Python/blob/main/waifu_voicechanger.py), [README](https://github.com/AsamiKafune/VoiceTranslator-Python), [license](https://github.com/AsamiKafune/VoiceTranslator-Python/blob/main/LICENSE).

A desktop push-to-talk proof of concept records a short utterance, uses speech recognition and translation, speaks with a selected VOICEVOX voice, and presents original and translated subtitles. Useful conceptual references: explicit push-to-talk and showing both transcripts. It relies on local desktop audio routing, a configurable synthetic speaker and external recognition/translation; it does not demonstrate cloning the user's voice or sending WhatsApp native voice messages. The code contains broad silent exception handling, hard-coded device indices and local output files, so should not be adopted as production architecture. MIT license conditions apply if copying substantial code, alongside third-party terms.

## Recommended application to VoiceBridge

1. **Near term:** improve bilingual transcript presentation, recording feedback and setup diagnostics while retaining the current asynchronous ElevenLabs voice-note flow. Test with real language pairs and real provider credentials; do not assert language support based only on a static list.
2. **Native sending:** keep OGG/Opus, preview and recipient-consent checks, WhatsApp Business Cloud API `audio.voice` and Telegram `sendVoice`. None of these repositories establishes that personal WhatsApp accounts can be programmed to send native voice messages.
3. **Future live calls:** build a separately scoped streaming experiment with explicit microphone permissions, short audio frames, speech-boundary handling, original/translated text, playback management, cancellation, reconnection, latency measurement and interruption policy. Assess an authorized provider for streaming voice synthesis and whether it preserves the user's voice, then measure actual latency, pricing and quality. Preserve speech/order rather than silently dropping late segments. This is not implemented or promised by the current app.
4. **Privacy and safety:** keep server secrets off the client; use consent, access control, clear deletion/retention policies and opt-in diagnostics. Do not feed third-party recordings into a cloned-voice path without permission.

No third-party code or assets from the reviewed repositories were copied as part of this research.
