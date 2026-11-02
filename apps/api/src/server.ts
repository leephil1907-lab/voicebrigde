import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("http://localhost:8081"),
});

const env = envSchema.parse(process.env);
const app = Fastify({
  logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
  bodyLimit: 1_048_576,
  trustProxy: true,
});

await app.register(helmet);
await app.register(cors, {
  origin: env.CORS_ORIGIN.split(",").map((value) => value.trim()),
  credentials: true,
});
await app.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute",
});

app.get("/health", async () => ({
  status: "ok",
  service: "voicebridge-api",
  timestamp: new Date().toISOString(),
}));

app.get("/v1/languages", async () => ({
  items: [
    { code: "en", name: "English", nativeName: "English" },
    { code: "es", name: "Spanish", nativeName: "Español" },
    { code: "fr", name: "French", nativeName: "Français" },
    { code: "pt", name: "Portuguese", nativeName: "Português" },
    { code: "de", name: "German", nativeName: "Deutsch" },
    { code: "it", name: "Italian", nativeName: "Italiano" },
    { code: "ar", name: "Arabic", nativeName: "العربية" },
    { code: "zh", name: "Chinese", nativeName: "中文" },
    { code: "ja", name: "Japanese", nativeName: "日本語" },
    { code: "ko", name: "Korean", nativeName: "한국어" },
  ],
}));

app.setNotFoundHandler((request, reply) => {
  return reply.code(404).send({
    error: "NOT_FOUND",
    message: `Route ${request.method} ${request.url} was not found.`,
  });
});

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
