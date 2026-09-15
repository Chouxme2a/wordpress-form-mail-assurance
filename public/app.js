const analyticsBeacon = document.createElement("script");
analyticsBeacon.type = "module";
analyticsBeacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
analyticsBeacon.dataset.cfBeacon = JSON.stringify({ token: "332b088c1f04467db0da0627f0d657c7" });
document.head.append(analyticsBeacon);

const API = window.WFMA_API || "https://wp-form-mail-assurance-api.wordpress-form-mail-assurance.workers.dev";

// Internal-traffic tagging: visit once with ?wfma_internal=1 (e.g. bookmark it) to
// permanently flag this browser's own events as internal, without dropping them.
const params = new URLSearchParams(location.search);
if (params.get("wfma_internal") === "1") { try { localStorage.setItem("wfma_internal", "1"); } catch {} }
let isInternal = false;
try { isInternal = localStorage.getItem("wfma_internal") === "1"; } catch {}

// First-touch attribution: capture UTM params + referrer once per browser and
// keep sending them on every event so later funnel steps stay attributable.
let attribution = {};
try {
  const stored = localStorage.getItem("wfma_attribution");
  if (stored) attribution = JSON.parse(stored);
  const hasUtm = ["utm_source", "utm_medium", "utm_campaign", "utm_content"].some((key) => params.has(key));
  // Fallback for directories that rewrite outbound links to their own "?ref=" param
  // instead of preserving our UTM (observed on Product Hunt; same pattern is common
  // on SaaSHub, AlternativeTo, etc.) so this traffic is still attributable.
  const ref = params.get("ref");
  if (!stored || hasUtm || ref) {
    attribution = {
      utm_source: params.get("utm_source") || attribution.utm_source || ref || null,
      utm_medium: params.get("utm_medium") || attribution.utm_medium || (ref ? "referral" : null),
      utm_campaign: params.get("utm_campaign") || attribution.utm_campaign || null,
      utm_content: params.get("utm_content") || attribution.utm_content || null,
      referrer: attribution.referrer || document.referrer || null,
      landing_path: attribution.landing_path || location.pathname,
    };
    localStorage.setItem("wfma_attribution", JSON.stringify(attribution));
  }
} catch {}

const track = (name, properties = {}) => fetch(`${API}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, properties: { ...attribution, internal: isInternal, ...properties } }), keepalive: true }).catch(() => {});
track(location.pathname.startsWith("/pricing") ? "pricing_view" : location.pathname.startsWith("/onboarding") ? "onboarding_start" : "landing_view");

const checker = document.querySelector("[data-checker]");
if (checker) checker.addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = checker.querySelector("[data-result]");
  output.className = "result"; output.style.display = "block"; output.textContent = "Checking public signals…";
  try {
    const response = await fetch(`${API}/api/compatibility`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: new FormData(checker).get("url") }) });
    const data = await response.json();
    output.innerHTML = `<strong>${data.status}</strong><br>${data.provider || data.reason || ""}<br><small>Email arrival is verified only after the helper is installed and authorized.</small>${data.status !== "UNSUPPORTED" ? '<br><a class="button" href="/pricing/" style="margin-top:12px">Monitor this site continuously</a>' : ''}`;
    if (data.status === "UNSUPPORTED") output.classList.add("error");
  } catch { output.textContent = "The checker is temporarily unavailable. Please retry."; output.classList.add("error"); }
});

document.querySelectorAll("[data-plan]").forEach((button) => button.addEventListener("click", () => sessionStorage.setItem("wfma_plan", button.dataset.plan)));
const checkout = document.querySelector("[data-checkout]");
if (checkout) {
  const selected = sessionStorage.getItem("wfma_plan") || "agency";
  checkout.elements.plan.value = selected;
  checkout.addEventListener("submit", async (event) => {
    event.preventDefault();
    track("checkout_start", { plan: checkout.elements.plan.value });
    const submit = checkout.querySelector("button"); submit.disabled = true; submit.textContent = "Verifying and opening secure checkout…";
    try {
      const body = Object.fromEntries(new FormData(checkout)); body.managed_sites = Number(body.managed_sites);
      const response = await fetch(`${API}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.compatibility?.reason || data.error || "Checkout unavailable");
      location.href = data.url;
    } catch (error) { document.querySelector("[data-checkout-error]").textContent = error.message; submit.disabled = false; submit.textContent = "Continue to Stripe Checkout"; }
  });
}

const onboarding = document.querySelector("[data-onboarding]");
if (onboarding) {
  const sessionId = new URLSearchParams(location.search).get("session_id");
  if (!sessionId) onboarding.innerHTML = "<h2>Payment session missing</h2><p>Return using the secure link supplied after checkout.</p>";
  else fetch(`${API}/api/onboarding/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) })
    .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
    .then((data) => {
      onboarding.innerHTML = `<span class="status">Payment verified</span><h1>Connect your WordPress sites</h1><div class="grid3"><div class="step"><h3>1. Download</h3><p><a class="button" href="${data.plugin_url}">Download WordPress helper</a></p></div><div class="step"><h3>2. Install</h3><p>WordPress → Plugins → Add New → Upload Plugin → Activate.</p></div><div class="step"><h3>3. Connect</h3><p>Settings → Form & Mail Assurance. Paste this agency connection token:</p><div class="onboarding-token">${data.activation_token}</div></div></div><p class="fine">The token can connect every site included in your plan for 24 hours. Reopen this secure checkout-success page later to generate a fresh token. Discovery and the first delivery test start automatically after each connection. Unsupported sites are rejected without manual setup.</p><p><button type="button" data-portal>Manage or cancel subscription</button></p>`;
      track("onboarding_completed");
      onboarding.querySelector("[data-portal]").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        const response = await fetch(`${API}/api/stripe/portal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
        const portal = await response.json();
        if (response.ok) location.href = portal.url;
        else { event.currentTarget.disabled = false; event.currentTarget.textContent = "Portal temporarily unavailable — retry"; }
      });
    });
}
