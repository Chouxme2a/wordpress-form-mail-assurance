import { GmailOracle, MonitorRunner } from "../src/monitor-core.js";

const required = ["WFMA_TEST_ENDPOINT", "WFMA_SITE_SECRET", "GMAIL_ACCESS_TOKEN"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`REAL_PROOF_BLOCKED missing ${missing.join(", ")}`);
  process.exit(2);
}

const endpoint = process.env.WFMA_TEST_ENDPOINT;
const secret = process.env.WFMA_SITE_SECRET;
const gmail = new GmailOracle({
  accessToken: process.env.GMAIL_ACCESS_TOKEN,
  mailboxAddress: process.env.GMAIL_MAILBOX || "wpformmailassurance@gmail.com",
});
const runner = new MonitorRunner({
  submit: async (target, { testId }) => {
    const body = JSON.stringify({
      form_id: target.formId,
      test_id: testId,
      force_smtp_failure: process.env.WFMA_FORCE_SMTP_FAILURE === "1",
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const { signRequest } = await import("../src/monitor-core.js");
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-wfma-timestamp": String(timestamp),
        "x-wfma-signature": signRequest(secret, timestamp, body),
      },
      body,
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(`WordPress helper ${response.status}: ${detail.error || "mail send failed"}`);
    }
  },
  oracle: async (_target, { testId }) => gmail.received(testId),
  notify: async (kind, payload) => console.log(JSON.stringify({ kind, payload })),
  record: async (name, payload) => console.log(JSON.stringify({ name, payload })),
});

const result = await runner.run({ id: "real-proof", formId: process.env.WFMA_FORM_ID || "1" });
console.log(JSON.stringify(result));
process.exit(result.status === "FAIL" ? 1 : 0);
