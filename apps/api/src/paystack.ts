import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const creditPackageSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(240).default(""),
  amountMinor: z.number().int().min(10000).max(100_000_000),
  credits: z.number().int().positive().max(10_000_000),
});
const subscriptionPlanSchema = z.object({
  code: z.enum(["creator", "pro", "business", "enterprise"]),
  name: z.string().min(1).max(80),
  description: z.string().max(240).default(""),
  paystackPlanCode: z.string().min(3).max(80),
  amountMinor: z.number().int().min(10000).max(100_000_000),
  interval: z.enum(["month", "year"]),
});

export type PaystackCreditPackage = z.infer<typeof creditPackageSchema>;
export type PaystackSubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

export function parsePaystackCatalog(creditJson: string, planJson: string) {
  const credits = z.array(creditPackageSchema).max(20).parse(JSON.parse(creditJson || "[]"));
  const plans = z.array(subscriptionPlanSchema).max(10).parse(JSON.parse(planJson || "[]"));
  if (new Set(credits.map((item) => item.code)).size !== credits.length) throw new Error("Duplicate Paystack credit package code.");
  if (new Set(plans.map((item) => item.code)).size !== plans.length) throw new Error("Duplicate Paystack subscription plan code.");
  if (new Set(plans.map((item) => item.paystackPlanCode)).size !== plans.length) throw new Error("Duplicate Paystack plan code.");
  return { credits, plans };
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{128}$/i.test(left) || !/^[a-f0-9]{128}$/i.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyPaystackWebhookSignature(input: {
  rawBody: Buffer;
  paystackSignature?: string;
  legacySignature?: string;
  webhookSecret?: string;
  secretKey?: string;
  nowSeconds?: number;
}) {
  const { rawBody, paystackSignature, legacySignature, webhookSecret, secretKey } = input;
  if (paystackSignature && webhookSecret) {
    const parts = paystackSignature.split(",").map((part) => part.trim());
    const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
    const timestampNumber = Number(timestamp);
    if (!timestamp || !Number.isInteger(timestampNumber)) return false;
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestampNumber) > 300) return false;
    const signedParts = parts.filter((part) => part.startsWith("v1="));
    const expected = createHmac("sha512", webhookSecret).update(timestamp + ".").update(rawBody).digest("hex");
    for (const signed of signedParts) {
      const signature = signed.slice(3).split(":").at(-1) || "";
      if (safeHexEqual(signature, expected)) return true;
    }
    return false;
  }
  if (legacySignature && secretKey) {
    const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
    return safeHexEqual(legacySignature, expected);
  }
  return false;
}

export async function paystackRequest<T>(
  secretKey: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.paystack.co" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + secretKey,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json() as { status?: boolean; message?: string; data?: T };
  if (!response.ok || payload.status !== true || payload.data === undefined) {
    throw new Error("Paystack request failed: " + (payload.message || response.statusText || "unknown error"));
  }
  return payload.data;
}
