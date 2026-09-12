const token = process.env.GMAIL_ACCESS_TOKEN;
if (!token) throw new Error("GMAIL_ACCESS_TOKEN missing");
const mailbox = "wpformmailassurance@gmail.com";
const marker = `WFMA-ALERT-${crypto.randomUUID()}`;
const message = [`From: WP Form & Mail Assurance <${mailbox}>`, `To: ${mailbox}`, `Subject: ${marker}`, "Content-Type: text/plain; charset=utf-8", "", "Automated incident alert delivery test."].join("\r\n");
const raw = Buffer.from(message).toString("base64url");
const sent = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ raw }) });
if (!sent.ok) throw new Error(`Gmail send ${sent.status}: ${await sent.text()}`);
let found = false;
for (let attempt = 0; attempt < 6 && !found; attempt += 1) {
  const query = encodeURIComponent(`subject:${marker}`);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=1`, { headers: { authorization: `Bearer ${token}` } });
  const data = await response.json();
  found = response.ok && (data.resultSizeEstimate || 0) > 0;
  if (!found && attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
}
console.log(JSON.stringify({ status: found ? "ALERT_DELIVERY_PASS" : "ALERT_DELIVERY_FAIL", anthony_minutes: 0 }));
process.exit(found ? 0 : 1);
