const PLANS = {
  starter: { amount: 4900, sites: 20, priceEnv: "STRIPE_PRICE_STARTER" },
  agency: { amount: 12900, sites: 50, priceEnv: "STRIPE_PRICE_AGENCY" },
  scale: { amount: 29900, sites: 100, priceEnv: "STRIPE_PRICE_SCALE" },
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...extra },
});
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" };
const bytesToHex = (bytes) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const randomHex = (length = 32) => bytesToHex(crypto.getRandomValues(new Uint8Array(length)));
const sha256 = async (value) => bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const hmac = async (secret, value) => bytesToHex(await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), new TextEncoder().encode(value)));

async function event(env, name, { accountId = null, siteId = null, properties = {} } = {}) {
  await env.DB.prepare("INSERT INTO events(name, account_id, site_id, properties, anthony_minutes) VALUES(?,?,?,?,0)")
    .bind(name, accountId, siteId, JSON.stringify(properties)).run();
}

async function compatibility(url) {
  let normalized;
  try { normalized = new URL(url); } catch { return { status: "UNSUPPORTED", reason: "Invalid URL" }; }
  if (normalized.protocol !== "https:") return { status: "UNSUPPORTED", reason: "HTTPS is required" };
  const response = await fetch(normalized.href, { redirect: "follow", headers: { "user-agent": "WFMA-Compatibility/1.0" } });
  if (!response.ok) return { status: "UNSUPPORTED", reason: `Site returned ${response.status}` };
  const html = (await response.text()).slice(0, 750_000).toLowerCase();
  const wordpress = html.includes("wp-content/") || html.includes("wp-includes/") || response.headers.get("link")?.includes("wp-json");
  if (!wordpress) return { status: "UNSUPPORTED", reason: "WordPress not detected" };
  if (html.includes("wpcf7") || html.includes("contact-form-7")) return { status: "COMPATIBLE", provider: "Contact Form 7", caveat: "Email delivery is verified only after helper installation." };
  if (html.includes("wpforms") || html.includes("gform_")) return { status: "UNSUPPORTED", reason: "Detected form plugin is not monitored in the Founding Agency Pilot" };
  return { status: "LIKELY COMPATIBLE — INSTALL HELPER TO VERIFY", provider: "WordPress" };
}

async function stripe(env, path, values) {
  const body = new URLSearchParams(values);
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Stripe ${response.status}`);
  return data;
}

async function ensureAccountFromSession(env, session) {
  const email = session.customer_details?.email || session.customer_email;
  if (!email) throw new Error("Checkout email missing");
  let account = await env.DB.prepare("SELECT * FROM accounts WHERE email=?").bind(email).first();
  if (!account) {
    const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO accounts(id,email,stripe_customer_id) VALUES(?,?,?)").bind(id, email, session.customer || null).run();
    account = { id, email, stripe_customer_id: session.customer || null };
  }
  return account;
}

async function issueActivation(env, accountId) {
  const token = `wfma_${randomHex(24)}`;
  const hash = await sha256(token);
  await env.DB.prepare("INSERT INTO activation_tokens(token_hash,account_id,expires_at) VALUES(?,?,datetime('now','+24 hours'))").bind(hash, accountId).run();
  return token;
}

async function verifyStripeSignature(secret, raw, header) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  if (!parts.t || !parts.v1 || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  return (await hmac(secret, `${parts.t}.${raw}`)) === parts.v1;
}

async function gmailAccessToken(env) {
  const body = new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const data = await response.json();
  if (!response.ok) throw new Error(`Gmail OAuth ${response.status}`);
  return data.access_token;
}

async function gmailReceived(env, token, testId) {
  const [local, domain] = env.GMAIL_MAILBOX.split("@");
  const query = encodeURIComponent(`to:(${local}+${testId}@${domain}) newer_than:1d`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=1`, { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(`Gmail API ${response.status}`);
    if ((data.resultSizeEstimate || 0) > 0) return true;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return false;
}

async function signedSiteFetch(site, path, method = "GET", payload = null) {
  const body = payload ? JSON.stringify(payload) : "";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hmac(site.secret, `${timestamp}.${body}`);
  return fetch(`${site.url.replace(/\/$/, "")}/wp-json/wfma/v1/${path}`, { method, headers: { "content-type": "application/json", "x-wfma-timestamp": String(timestamp), "x-wfma-signature": signature }, body: payload ? body : undefined });
}

async function sendAlert(env, token, to, subject, text) {
  const message = [`From: WP Form & Mail Assurance <${env.GMAIL_MAILBOX}>`, `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", text].join("\r\n");
  const raw = btoa(unescape(encodeURIComponent(message))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ raw }) });
  if (!response.ok) throw new Error(`Gmail send ${response.status}`);
}

async function monitorSite(env, site, token) {
  let passed = false;
  let reason = "Delivery not observed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const testId = crypto.randomUUID();
    try {
      const response = await signedSiteFetch(site, "synthetic", "POST", { form_id: site.form_id, test_id: testId });
      if (!response.ok) throw new Error(`Helper ${response.status}`);
      if (await gmailReceived(env, token, testId)) { passed = true; break; }
    } catch (error) { reason = error.message; }
    await event(env, "monitor_run", { accountId: site.account_id, siteId: site.id, properties: { attempt, result: "fail" } });
  }
  const account = await env.DB.prepare("SELECT email FROM accounts WHERE id=?").bind(site.account_id).first();
  if (passed) {
    const recovered = site.state === "incident";
    await env.DB.prepare("UPDATE sites SET state='healthy', consecutive_failures=0, last_checked_at=CURRENT_TIMESTAMP WHERE id=?").bind(site.id).run();
    await event(env, recovered ? "recovery" : site.state === "pending" ? "first_test_success" : "monitor_run", { accountId: site.account_id, siteId: site.id, properties: { result: "pass" } });
    if (recovered) await sendAlert(env, token, account.email, `RECOVERY — ${site.url}`, "Form email delivery is healthy again. No action is required.");
  } else {
    await env.DB.prepare("UPDATE sites SET state='incident', consecutive_failures=consecutive_failures+3, last_checked_at=CURRENT_TIMESTAMP WHERE id=?").bind(site.id).run();
    if (site.state !== "incident") {
      await event(env, "incident", { accountId: site.account_id, siteId: site.id, properties: { reason } });
      await sendAlert(env, token, account.email, `INCIDENT — ${site.url}`, `Three delivery checks failed. Reason: ${reason}`);
    }
  }
}

async function runMonitors(env) {
  const token = await gmailAccessToken(env);
  const { results } = await env.DB.prepare("SELECT * FROM sites WHERE form_id IS NOT NULL AND state != 'disabled' ORDER BY COALESCE(last_checked_at,'1970-01-01') LIMIT 20").all();
  for (const site of results) await monitorSite(env, site, token);
  return results.length;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ ok: true }, 200, cors);
      if (url.pathname === "/api/events" && request.method === "POST") {
        const body = await request.json();
        if (!["landing_view", "pricing_view", "compatibility_check", "checkout_start", "onboarding_start", "cancel", "refund"].includes(body.name)) return json({ error: "invalid_event" }, 400, cors);
        await event(env, body.name, { properties: body.properties || {} });
        return json({ ok: true }, 202, cors);
      }
      if (url.pathname === "/api/compatibility" && request.method === "POST") {
        const result = await compatibility((await request.json()).url);
        await event(env, "compatibility_check", { properties: { status: result.status } });
        return json(result, 200, cors);
      }
      if (url.pathname === "/api/checkout" && request.method === "POST") {
        const body = await request.json();
        const plan = PLANS[body.plan];
        if (!plan || !/^\S+@\S+\.\S+$/.test(body.email || "") || Number(body.managed_sites) < 20 || Number(body.managed_sites) > 100) return json({ error: "pilot_qualification_failed" }, 422, cors);
        const check = await compatibility(body.site_url);
        if (check.status === "UNSUPPORTED") return json({ error: "unsupported", compatibility: check }, 422, cors);
        const session = await stripe(env, "checkout/sessions", {
          mode: "subscription", customer_email: body.email, "line_items[0][price]": env[plan.priceEnv], "line_items[0][quantity]": "1",
          success_url: `${env.APP_URL}/onboarding/?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${env.APP_URL}/pricing/?cancelled=1`,
          "metadata[plan]": body.plan, "metadata[managed_sites]": String(body.managed_sites), "metadata[first_site]": body.site_url,
          allow_promotion_codes: "false",
        });
        await event(env, "checkout_start", { properties: { plan: body.plan } });
        return json({ url: session.url }, 200, cors);
      }
      if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
        const raw = await request.text();
        if (!await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, raw, request.headers.get("stripe-signature") || "")) return json({ error: "bad_signature" }, 400);
        const hook = JSON.parse(raw);
        if (hook.type === "checkout.session.completed") {
          const session = hook.data.object;
          const account = await ensureAccountFromSession(env, session);
          const planName = session.metadata?.plan || "starter";
          await env.DB.prepare("INSERT OR REPLACE INTO subscriptions(id,account_id,stripe_subscription_id,plan,status,site_limit) VALUES(?,?,?,?,?,?)")
            .bind(session.subscription || session.id, account.id, session.subscription || null, planName, "active", PLANS[planName].sites).run();
          await event(env, "payment_success", { accountId: account.id, properties: { plan: planName } });
        }
        if (hook.type === "customer.subscription.deleted") await event(env, "cancel", { properties: { stripe_subscription_id: hook.data.object.id } });
        if (hook.type === "charge.refunded") await event(env, "refund", { properties: { charge_id: hook.data.object.id } });
        return json({ received: true });
      }
      if (url.pathname === "/api/onboarding/session" && request.method === "POST") {
        const { session_id: sessionId } = await request.json();
        const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
        const session = await response.json();
        if (!response.ok || session.payment_status !== "paid") return json({ error: "payment_not_verified" }, 403, cors);
        const account = await ensureAccountFromSession(env, session);
        const token = await issueActivation(env, account.id);
        await event(env, "onboarding_start", { accountId: account.id });
        return json({ email: account.email, activation_token: token, plugin_url: `${env.APP_URL}/wp-form-mail-assurance.zip` }, 200, cors);
      }
      if (url.pathname === "/api/plugin/connect" && request.method === "POST") {
        const body = await request.json();
        const tokenHash = await sha256(body.activation_token || "");
        const activation = await env.DB.prepare("SELECT * FROM activation_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP").bind(tokenHash).first();
        if (!activation) return json({ error: "invalid_or_expired_token" }, 403, cors);
        const siteCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM sites WHERE account_id=?").bind(activation.account_id).first();
        const subscription = await env.DB.prepare("SELECT site_limit FROM subscriptions WHERE account_id=? AND status='active' ORDER BY created_at DESC").bind(activation.account_id).first();
        if (!subscription || siteCount.total >= subscription.site_limit) return json({ error: "site_limit_reached" }, 422, cors);
        let parsedUrl;
        try { parsedUrl = new URL(body.site_url); } catch { return json({ error: "invalid_site_url" }, 400, cors); }
        if (parsedUrl.protocol !== "https:") return json({ error: "https_required" }, 422, cors);
        const forms = Array.isArray(body.forms) ? body.forms : [];
        const supported = forms.find((form) => form.status === "SUPPORTED" && form.provider === "contact-form-7");
        if (!supported) return json({ status: "UNSUPPORTED — NOT MONITORED", error: "no_verified_contact_form_7_form" }, 422, cors);
        const siteId = crypto.randomUUID();
        const secret = randomHex(32);
        const normalizedUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/$/, "")}`;
        await env.DB.batch([
          env.DB.prepare("INSERT INTO sites(id,account_id,url,secret,form_id,provider,state) VALUES(?,?,?,?,?,?,'pending')").bind(siteId, activation.account_id, normalizedUrl, secret, String(supported.id), "contact-form-7"),
          env.DB.prepare("UPDATE activation_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(tokenHash),
        ]);
        await event(env, "plugin_connected", { accountId: activation.account_id, siteId, properties: { provider: "contact-form-7" } });
        const site = { id: siteId, account_id: activation.account_id, url: normalizedUrl, secret, form_id: String(supported.id), provider: "contact-form-7", state: "pending" };
        ctx.waitUntil(gmailAccessToken(env).then((token) => monitorSite(env, site, token)));
        return json({ status: "CONNECTED", site_id: siteId, site_secret: secret, first_test: "scheduled" }, 201, cors);
      }
      if (url.pathname === "/api/plugin/discover" && request.method === "POST") {
        const { site_id: siteId } = await request.json();
        const site = await env.DB.prepare("SELECT * FROM sites WHERE id=?").bind(siteId).first();
        if (!site) return json({ error: "not_found" }, 404, cors);
        const response = await signedSiteFetch(site, "forms");
        const data = await response.json();
        if (!response.ok || !data.forms?.length) return json({ status: "UNSUPPORTED — NOT MONITORED" }, 422, cors);
        const form = data.forms[0];
        await env.DB.prepare("UPDATE sites SET form_id=?, provider=?, state='pending' WHERE id=?").bind(form.id, data.provider, site.id).run();
        return json({ status: "SUPPORTED", provider: data.provider, form }, 200, cors);
      }
      if (url.pathname === "/api/internal/monitor" && request.method === "POST") {
        if (request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return json({ error: "unauthorized" }, 401);
        return json({ monitored: await runMonitors(env) });
      }
      return json({ error: "not_found" }, 404, cors);
    } catch (error) {
      return json({ error: "service_error", message: error.message }, 500, cors);
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(runMonitors(env)); },
};
