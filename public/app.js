const analyticsBeacon = document.createElement("script");
analyticsBeacon.type = "module";
analyticsBeacon.src = "https://static.cloudflareinsights.com/beacon.min.js";
analyticsBeacon.dataset.cfBeacon = JSON.stringify({ token: "332b088c1f04467db0da0627f0d657c7" });
document.head.append(analyticsBeacon);

const API = window.WFMA_API || "https://wp-form-mail-assurance-api.wordpress-form-mail-assurance.workers.dev";
const track = (name, properties = {}) => fetch(`${API}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, properties }), keepalive: true }).catch(() => {});
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
      onboarding.innerHTML = `<span class="status">Payment verified</span><h1>Connect your first site</h1><div class="grid3"><div class="step"><h3>1. Download</h3><p><a class="button" href="${data.plugin_url}">Download WordPress helper</a></p></div><div class="step"><h3>2. Install</h3><p>WordPress → Plugins → Add New → Upload Plugin → Activate.</p></div><div class="step"><h3>3. Connect</h3><p>Settings → Form & Mail Assurance. Paste this one-time token:</p><div class="onboarding-token">${data.activation_token}</div></div></div><p class="fine">The token expires in 24 hours. Discovery and the first delivery test start automatically after connection. Unsupported sites are rejected without manual setup.</p><p><button type="button" data-portal>Manage or cancel subscription</button></p>`;
      onboarding.querySelector("[data-portal]").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        const response = await fetch(`${API}/api/stripe/portal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: sessionId }) });
        const portal = await response.json();
        if (response.ok) location.href = portal.url;
        else { event.currentTarget.disabled = false; event.currentTarget.textContent = "Portal temporarily unavailable — retry"; }
      });
    });
}
