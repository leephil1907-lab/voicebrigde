import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

type User = { id: string; email?: string };
type Dependencies = {
  supabaseAdmin: SupabaseClient;
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  openAiApiKey?: string;
};

const supportedInputLanguages = new Set([
  "en", "es", "fr", "pt", "de", "it", "ar", "zh", "ja", "ko",
  "ha", "yo", "sw", "hi", "nl", "ru", "tr", "ur", "id", "vi",
]);
const supportedOutputLanguages = new Set([
  "en", "es", "pt", "fr", "ja", "ru", "zh", "de", "ko", "hi", "id", "vi", "it",
]);

const languagePair = z.object({
  spokenLanguage: z.string().min(2).max(8).refine((value) => supportedInputLanguages.has(value), "Choose a supported spoken language."),
  preferredLanguage: z.string().min(2).max(8).refine((value) => supportedOutputLanguages.has(value), "Choose a supported listening language.");
});

function userId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: User | null }).user;
  if (!user?.id) throw new Error("AUTH_REQUIRED");
  return user.id;
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(reply: FastifyReply, status: number, error: string, message: string) {
  return reply.code(status).send({ error, message });
}

export function registerLiveCallRoutes(app: FastifyInstance, deps: Dependencies) {
  const { supabaseAdmin, authenticate, openAiApiKey } = deps;

  app.post("/v1/live-calls", { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ channel: z.literal("in_app"), ...languagePair.shape }).safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "INVALID_CALL_SETTINGS", parsed.error.issues[0]?.message || "Check the call settings.");
    const ownerId = userId(request);
    const inviteToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data: call, error: callError } = await supabaseAdmin.from("voicebridge_live_calls").insert({
      created_by: ownerId,
      channel: "in_app",
      status: "waiting",
      provider: "webrtc",
      invite_token_hash: hashToken(inviteToken),
      invite_expires_at: expiresAt,
    }).select("id,status,channel,created_at,invite_expires_at").single();
    if (callError || !call) {
      request.log.error({ error: callError }, "Could not create live call");
      return fail(reply, 500, "LIVE_CALL_CREATE_FAILED", "Could not create the call. Please try again.");
    }

    const { error: participantError } = await supabaseAdmin.from("voicebridge_live_call_participants").insert({
      call_id: call.id,
      user_id: ownerId,
      participant_type: "app_user",
      seat: 1,
      spoken_language: parsed.data.spokenLanguage,
      preferred_language: parsed.data.preferredLanguage,
      joined_at: new Date().toISOString(),
    });
    if (participantError) {
      await supabaseAdmin.from("voicebridge_live_calls").delete().eq("id", call.id);
      request.log.error({ error: participantError }, "Could not create live call host participant");
      return fail(reply, 500, "LIVE_CALL_PARTICIPANT_FAILED", "Could not prepare the call. Please try again.");
    }

    return reply.code(201).send({
      id: call.id,
      status: call.status,
      channel: call.channel,
      inviteToken,
      inviteExpiresAt: call.invite_expires_at,
      participant: { spokenLanguage: parsed.data.spokenLanguage, preferredLanguage: parsed.data.preferredLanguage },
    });
  });

  app.post<{ Params: { id: string } }>("/v1/live-calls/:id/join", { preHandler: authenticate }, async (request, reply) => {
    const parsed = z.object({ inviteToken: z.string().min(32).max(128), ...languagePair.shape }).safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, "INVALID_JOIN_DETAILS", parsed.error.issues[0]?.message || "Check the invite and language settings.");
    const joiningUserId = userId(request);
    const { data: call, error } = await supabaseAdmin.from("voicebridge_live_calls")
      .select("id,created_by,status,invite_token_hash,invite_expires_at")
      .eq("id", request.params.id).maybeSingle();
    if (error || !call) return fail(reply, 404, "LIVE_CALL_NOT_FOUND", "This call link is invalid or has expired.");
    if (call.created_by === joiningUserId) return fail(reply, 409, "CALL_HOST_CANNOT_JOIN", "You are already the host of this call.");
    if (call.status !== "waiting" || call.invite_token_hash !== hashToken(parsed.data.inviteToken) || !call.invite_expires_at || new Date(call.invite_expires_at).getTime() < Date.now()) {
      return fail(reply, 410, "LIVE_CALL_INVITE_EXPIRED", "This call invitation is no longer active.");
    }

    const { error: participantError } = await supabaseAdmin.from("voicebridge_live_call_participants").insert({
      call_id: call.id,
      user_id: joiningUserId,
      participant_type: "app_user",
      seat: 2,
      spoken_language: parsed.data.spokenLanguage,
      preferred_language: parsed.data.preferredLanguage,
      joined_at: new Date().toISOString(),
    });
    if (participantError) {
      request.log.info({ callId: call.id, error: participantError.code }, "Live call seat could not be claimed");
      return fail(reply, 409, "LIVE_CALL_FULL", "This call has already been joined or is no longer available.");
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin.from("voicebridge_live_calls")
      .update({ status: "active", started_at: now, updated_at: now, invite_token_hash: null, invite_expires_at: null })
      .eq("id", call.id).eq("status", "waiting");
    if (updateError) {
      await supabaseAdmin.from("voicebridge_live_call_participants").delete().eq("call_id", call.id).eq("user_id", joiningUserId);
      return fail(reply, 409, "LIVE_CALL_START_FAILED", "The call could not be started. Please request a new invitation.");
    }

    return reply.send({ id: call.id, status: "active", channel: "in_app" });
  });

  app.get<{ Params: { id: string } }>("/v1/live-calls/:id", { preHandler: authenticate }, async (request, reply) => {
    const currentUserId = userId(request);
    const { data: call, error } = await supabaseAdmin.from("voicebridge_live_calls")
      .select("id,created_by,channel,status,created_at,started_at,ended_at,end_reason")
      .eq("id", request.params.id).maybeSingle();
    if (error || !call) return fail(reply, 404, "LIVE_CALL_NOT_FOUND", "This call could not be found.");
    const { data: participants, error: participantError } = await supabaseAdmin.from("voicebridge_live_call_participants")
      .select("user_id,seat,spoken_language,preferred_language,joined_at,left_at")
      .eq("call_id", call.id);
    if (participantError || !(participants || []).some((participant) => participant.user_id === currentUserId) && call.created_by !== currentUserId) {
      return fail(reply, 404, "LIVE_CALL_NOT_FOUND", "This call could not be found.");
    }
    return {
      id: call.id, channel: call.channel, status: call.status, createdAt: call.created_at,
      startedAt: call.started_at, endedAt: call.ended_at, endReason: call.end_reason,
      participants: (participants || []).map((participant) => ({
        seat: participant.seat, spokenLanguage: participant.spoken_language,
        preferredLanguage: participant.preferred_language, joinedAt: participant.joined_at, leftAt: participant.left_at,
        isYou: participant.user_id === currentUserId,
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/v1/live-calls/:id/translation-session", { preHandler: authenticate }, async (request, reply) => {
    if (!openAiApiKey) return fail(reply, 503, "LIVE_TRANSLATION_NOT_CONFIGURED", "Live translation is not configured yet.");
    const currentUserId = userId(request);
    const { data: call } = await supabaseAdmin.from("voicebridge_live_calls")
      .select("id,status").eq("id", request.params.id).maybeSingle();
    if (!call || call.status !== "active") return fail(reply, 409, "LIVE_CALL_NOT_ACTIVE", "The call is not active.");
    const { data: participants } = await supabaseAdmin.from("voicebridge_live_call_participants")
      .select("user_id,spoken_language,left_at").eq("call_id", call.id);
    const mine = (participants || []).find((participant) => participant.user_id === currentUserId && !participant.left_at);
    const others = (participants || []).filter((participant) => participant.user_id !== currentUserId && !participant.left_at);
    if (!mine || others.length !== 1) return fail(reply, 403, "LIVE_CALL_PARTICIPANT_REQUIRED", "Only active call participants can start translation.");
    try {
      const response = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          session: {
            model: "gpt-realtime-translate",
            audio: {
              input: {
                transcription: { model: "gpt-realtime-whisper" },
                noise_reduction: { type: "near_field" },
              },
              output: { language: mine.preferred_language },
            },
          },
        }),
      });
      const payload = await response.json() as { client_secret?: { value?: string; expires_at?: number } | string; error?: { message?: string } };
      if (!response.ok) {
        request.log.error({ status: response.status, providerError: payload.error?.message }, "OpenAI live translation session creation failed");
        return fail(reply, 502, "LIVE_TRANSLATION_SESSION_FAILED", "The translation session could not be prepared.");
      }
      const clientSecret = typeof payload.client_secret === "string" ? payload.client_secret : payload.client_secret?.value;
      if (!clientSecret) return fail(reply, 502, "LIVE_TRANSLATION_SESSION_INVALID", "The translation provider returned an invalid session.");
      return { clientSecret, expiresAt: typeof payload.client_secret === "object" ? payload.client_secret.expires_at : undefined, targetLanguage: mine.preferred_language };
    } catch (error) {
      request.log.error({ error }, "OpenAI live translation request failed");
      return fail(reply, 502, "LIVE_TRANSLATION_SESSION_FAILED", "The translation session could not be prepared.");
    }
  });

  app.post<{ Params: { id: string } }>("/v1/live-calls/:id/end", { preHandler: authenticate }, async (request, reply) => {
    const currentUserId = userId(request);
    const { data: call } = await supabaseAdmin.from("voicebridge_live_calls")
      .select("id,created_by,status").eq("id", request.params.id).maybeSingle();
    if (!call) return fail(reply, 404, "LIVE_CALL_NOT_FOUND", "This call could not be found.");
    const { data: participant } = await supabaseAdmin.from("voicebridge_live_call_participants")
      .select("id").eq("call_id", call.id).eq("user_id", currentUserId).maybeSingle();
    if (call.created_by !== currentUserId && !participant) return fail(reply, 404, "LIVE_CALL_NOT_FOUND", "This call could not be found.");
    if (call.status !== "ended") {
      const now = new Date().toISOString();
      await supabaseAdmin.from("voicebridge_live_calls").update({ status: "ended", ended_at: now, updated_at: now, end_reason: "participant_ended" }).eq("id", call.id);
      await supabaseAdmin.from("voicebridge_live_call_participants").update({ left_at: now }).eq("call_id", call.id).is("left_at", null);
    }
    return { id: call.id, status: "ended" };
  });
}
