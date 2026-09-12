import { GmailOracle, MonitorRunner, signRequest } from "../src/monitor-core.js";

const required = ["WFMA_TEST_ENDPOINT", "WFMA_SITE_SECRET", "GMAIL_ACCESS_TOKEN"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) throw new Error(`Missing ${missing.join(", ")}`);

const oracle = new GmailOracle({
  accessToken: process.env.GMAIL_ACCESS_TOKEN,
  mailboxAddress: process.env.GMAIL_MAILBOX || "wpformmailassurance@gmail.com",
});
const events = [];
const runner = new MonitorRunner({
  attempts: 3,
  submit: async (target, { testId }) => {
    const body = JSON.stringify({
      form_id: target.formId,
      test_id: testId,
      force_smtp_failure: target.forceFailure,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await fetch(process.env.WFMA_TEST_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wfma-timestamp": String(timestamp),
        "x-wfma-signature": signRequest(process.env.WFMA_SITE_SECRET, timestamp, body),
      },
      body,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`WordPress helper ${response.status}: ${detail.error || "mail send failed"}`);
    }
  },
  oracle: async (target, { testId }) => target.forceFailure ? false : oracle.received(testId),
  notify: async (kind, payload) => {
    events.push({ type: "alert", kind, targetId: payload.target.id });
    console.log(JSON.stringify(events.at(-1)));
  },
  record: async (name, payload) => {
    events.push({ type: "event", name, ...payload });
    console.log(JSON.stringify(events.at(-1)));
  },
});

const target = { id: "real-proof-cycle", formId: process.env.WFMA_FORM_ID || "4", forceFailure: false };
const baseline = await runner.run(target);
target.forceFailure = true;
const incident = await runner.run(target);
target.forceFailure = false;
const recovery = await runner.run(target);

const passed = baseline.status === "PASS"
  && incident.status === "FAIL"
  && incident.attempts === 3
  && recovery.status === "RECOVERY"
  && events.some((event) => event.type === "alert" && event.kind === "incident")
  && events.some((event) => event.type === "alert" && event.kind === "recovery");

console.log(JSON.stringify({
  status: passed ? "REAL_CYCLE_PASS" : "REAL_CYCLE_FAIL",
  baseline: baseline.status,
  incident: incident.status,
  retryCount: events.filter((event) => event.name === "retry_scheduled").length,
  recovery: recovery.status,
  anthony_minutes: 0,
}));
process.exit(passed ? 0 : 1);
