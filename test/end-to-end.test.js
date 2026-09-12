import assert from "node:assert/strict";
import test from "node:test";
import { MonitorRunner, signRequest, verifyRequest } from "../src/monitor-core.js";

test("signed synthetic requests reject tampering and replay", () => {
  const secret = "proof-secret";
  const now = Date.now();
  const timestamp = Math.floor(now / 1000);
  const body = JSON.stringify({ formId: "42", testId: "abc" });
  const signature = signRequest(secret, timestamp, body);
  assert.equal(verifyRequest(secret, timestamp, body, signature, now), true);
  assert.equal(verifyRequest(secret, timestamp, `${body}x`, signature, now), false);
  assert.equal(verifyRequest(secret, timestamp - 301, body, signature, now), false);
});

test("PASS -> retry -> incident alert -> recovery is autonomous", async () => {
  const events = [];
  const alerts = [];
  let mailEnabled = true;
  const delivered = new Set();
  const runner = new MonitorRunner({
    attempts: 3,
    submit: async (_target, { testId }) => {
      if (mailEnabled) delivered.add(testId);
    },
    oracle: async (_target, { testId }) => delivered.has(testId),
    notify: async (kind, payload) => alerts.push({ kind, payload }),
    record: async (name, payload) => events.push({ name, payload }),
  });
  const target = { id: "site-1", url: "https://wordpress.test", formId: "42" };

  assert.deepEqual((await runner.run(target)).status, "PASS");
  mailEnabled = false;
  const failed = await runner.run(target);
  assert.equal(failed.status, "FAIL");
  assert.equal(failed.attempts, 3);
  assert.deepEqual(alerts.map((a) => a.kind), ["incident"]);
  assert.equal(events.filter((e) => e.name === "incident").length, 1);

  await runner.run(target);
  assert.deepEqual(alerts.map((a) => a.kind), ["incident"]);

  mailEnabled = true;
  assert.deepEqual((await runner.run(target)).status, "RECOVERY");
  assert.deepEqual(alerts.map((a) => a.kind), ["incident", "recovery"]);
  assert.equal(events.every((e) => e.payload.anthony_minutes === 0), true);
});
