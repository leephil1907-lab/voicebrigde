import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parsePaystackCatalog, verifyPaystackWebhookSignature } from "../src/paystack.js";

test("parses server-defined Paystack credit packages and subscription plans", () => {
  const catalog = parsePaystackCatalog(
    JSON.stringify([{ code: "starter", name: "Starter", amountMinor: 500000, credits: 1000 }]),
    JSON.stringify([{ code: "creator", name: "Creator", paystackPlanCode: "PLN_test", amountMinor: 2500000, interval: "month" }]),
  );
  assert.equal(catalog.credits[0]?.credits, 1000);
  assert.equal(catalog.plans[0]?.paystackPlanCode, "PLN_test");
  assert.throws(() => parsePaystackCatalog(
    JSON.stringify([{ code: "bad code", name: "Invalid", amountMinor: 500000, credits: 1000 }]),
    "[]",
  ));
  assert.throws(() => parsePaystackCatalog(
    JSON.stringify([{ code: "starter", name: "Starter", amountMinor: 500000, credits: 1000 }, { code: "starter", name: "Duplicate", amountMinor: 600000, credits: 1200 }]),
    "[]",
  ));
});

test("verifies legacy Paystack HMAC SHA512 signatures against the exact raw body", () => {
  const rawBody = Buffer.from('{"event":"charge.success","data":{"reference":"VB-test"}}');
  const secretKey = "sk_test_voicebridge";
  const signature = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  assert.equal(verifyPaystackWebhookSignature({ rawBody, legacySignature: signature, secretKey }), true);
  assert.equal(verifyPaystackWebhookSignature({ rawBody: Buffer.from(rawBody.toString() + " "), legacySignature: signature, secretKey }), false);
});

test("verifies timestamped Paystack-Signature webhooks and rejects stale signatures", () => {
  const rawBody = Buffer.from('{"event":"charge.success"}');
  const secret = "whsec_voicebridge_test";
  const timestamp = 1_800_000_000;
  const signature = createHmac("sha512", secret).update(String(timestamp) + ".").update(rawBody).digest("hex");
  const header = `t=${timestamp},v1=whk_test:${signature}`;
  assert.equal(verifyPaystackWebhookSignature({ rawBody, paystackSignature: header, webhookSecret: secret, nowSeconds: timestamp }), true);
  assert.equal(verifyPaystackWebhookSignature({ rawBody, paystackSignature: header, webhookSecret: secret, nowSeconds: timestamp + 301 }), false);
});
