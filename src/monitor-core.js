import crypto from "node:crypto";

export function signRequest(secret, timestamp, body) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyRequest(secret, timestamp, body, signature, now = Date.now()) {
  const age = Math.abs(now - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60_000) return false;
  const expected = signRequest(secret, timestamp, body);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(signature), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class MonitorRunner {
  constructor({ submit, oracle, notify, record, attempts = 3 }) {
    this.submit = submit;
    this.oracle = oracle;
    this.notify = notify;
    this.record = record;
    this.attempts = attempts;
    this.states = new Map();
  }

  async run(target) {
    await this.record("monitor_run", { targetId: target.id, anthony_minutes: 0 });
    let lastError = "Delivery not observed";

    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      const testId = crypto.randomUUID();
      try {
        await this.submit(target, { testId, attempt });
        if (await this.oracle(target, { testId, attempt })) {
          const wasIncident = this.states.get(target.id) === "incident";
          this.states.set(target.id, "healthy");
          if (wasIncident) {
            await this.record("recovery", { targetId: target.id, testId, anthony_minutes: 0 });
            await this.notify("recovery", { target, testId });
            return { status: "RECOVERY", attempts: attempt, testId };
          }
          await this.record("first_test_success", { targetId: target.id, testId, anthony_minutes: 0 });
          return { status: "PASS", attempts: attempt, testId };
        }
        await this.record("attempt_failed", { targetId: target.id, testId, attempt, reason: lastError, anthony_minutes: 0 });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await this.record("attempt_failed", { targetId: target.id, testId, attempt, reason: lastError, anthony_minutes: 0 });
      }
      if (attempt < this.attempts) await this.record("retry_scheduled", { targetId: target.id, nextAttempt: attempt + 1, anthony_minutes: 0 });
    }

    const alreadyIncident = this.states.get(target.id) === "incident";
    this.states.set(target.id, "incident");
    if (!alreadyIncident) {
      await this.record("incident", { targetId: target.id, reason: lastError, anthony_minutes: 0 });
      await this.notify("incident", { target, reason: lastError });
    }
    return { status: "FAIL", attempts: this.attempts, reason: lastError };
  }
}

export class GmailOracle {
  constructor({ accessToken, mailbox = "me", mailboxAddress = "wpformmailassurance@gmail.com", fetchImpl = fetch, pollCount = 6, pollDelayMs = 10_000 }) {
    this.accessToken = accessToken;
    this.mailbox = mailbox;
    this.mailboxAddress = mailboxAddress;
    this.fetchImpl = fetchImpl;
    this.pollCount = pollCount;
    this.pollDelayMs = pollDelayMs;
  }

  async received(testId) {
    const [local, domain] = this.mailboxAddress.split("@");
    const query = encodeURIComponent(`to:(${local}+${testId}@${domain}) newer_than:1d`);
    for (let i = 0; i < this.pollCount; i += 1) {
      const response = await this.fetchImpl(
        `https://gmail.googleapis.com/gmail/v1/users/${this.mailbox}/messages?q=${query}&maxResults=1`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } },
      );
      if (!response.ok) throw new Error(`Gmail API ${response.status}`);
      const data = await response.json();
      if ((data.resultSizeEstimate ?? 0) > 0) return true;
      if (i + 1 < this.pollCount) await new Promise((resolve) => setTimeout(resolve, this.pollDelayMs));
    }
    return false;
  }
}
