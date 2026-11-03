import { loadEnv, type PreviewServer, type ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, ""), ...loadEnv(mode, resolve(root, "apps/web"), ""), ...process.env };
  const target = env.API_PROXY_TARGET;
  const publicConfig = {
    supabaseUrl: env.VITE_SUPABASE_URL || env.SUPABASE_URL || "",
    supabasePublishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || "",
    maxAudioBytes: 20 * 1024 * 1024,
    maxAudioSeconds: 120,
    channels: { whatsapp: false, telegram: false },
    targetLanguages: ["es", "fr", "pt", "de", "it", "ar", "hi", "ja", "ko", "zh", "nl", "ru", "tr"],
  };
  // Explicit allowlist: loadEnv reads server settings, but none are bundled or
  // returned here. Only the public Supabase URL and publishable key are public.
  const previewMiddleware = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      const path = req.url?.split("?")[0];
      if (target || !["/config", "/health", "/v1"].some((prefix) => path === prefix || path?.startsWith(prefix + "/"))) return next();
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      if (path === "/config") return res.end(JSON.stringify(publicConfig));
      if (path === "/health") {
        res.statusCode = 503;
        return res.end(JSON.stringify({
          status: "not_configured", service: "voicebridge-web-preview",
          capabilities: { authentication: Boolean(publicConfig.supabaseUrl && publicConfig.supabasePublishableKey), durableJobs: false, privateAudioStorage: false, audioToAudioDubbing: false },
        }));
      }
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "API_NOT_CONNECTED", message: "The VoiceBridge API is not running. Recording and original-audio download work locally; start the API and worker with your Supabase and ElevenLabs settings to translate." }));
    });
  };
  return {
    plugins: [
      react(),
      { name: "voicebridge-honest-preview", configureServer: previewMiddleware, configurePreviewServer: previewMiddleware },
    ],
    server: {
      host: "0.0.0.0", port: 3000, strictPort: true,
      allowedHosts: [".e2b.app"],
      proxy: target ? Object.fromEntries(["/config", "/health", "/v1"].map((path) => [path, { target, changeOrigin: true }])) : undefined,
    },
    preview: {
      host: "0.0.0.0", port: 3000, strictPort: true, allowedHosts: [".e2b.app"],
      proxy: target ? Object.fromEntries(["/config", "/health", "/v1"].map((path) => [path, { target, changeOrigin: true }])) : undefined,
    },
    test: { include: ["src/**/*.test.ts"], environment: "node" },
  };
});
