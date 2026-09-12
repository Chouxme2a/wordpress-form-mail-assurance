import { writeFileSync } from "node:fs";

const key = process.env.STRIPE_SECRET_KEY;
if (!key?.startsWith("sk_live_")) throw new Error("Live Stripe key missing");

const api = async (path, values, idempotencyKey) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": idempotencyKey,
    },
    body: new URLSearchParams(values),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error?.message || response.status}`);
  return data;
};

const specs = [
  ["starter", "WordPress Form Mail Assurance Starter", 4900, 20],
  ["agency", "WordPress Form Mail Assurance Agency", 12900, 50],
  ["scale", "WordPress Form Mail Assurance Scale", 29900, 100],
];
const prices = {};
for (const [slug, name, amount, sites] of specs) {
  const product = await api("products", {
    name,
    description: `Continuous end-to-end monitoring for up to ${sites} WordPress sites`,
    "metadata[wfma_plan]": slug,
  }, `wfma-product-${slug}-v1`);
  const price = await api("prices", {
    product: product.id,
    currency: "eur",
    unit_amount: String(amount),
    "recurring[interval]": "month",
    nickname: `${slug}-${amount}-monthly`,
    "metadata[wfma_plan]": slug,
  }, `wfma-price-${slug}-v1`);
  prices[slug] = price.id;
}

const webhook = await api("webhook_endpoints", {
  url: "https://wp-form-mail-assurance-api.wordpress-form-mail-assurance.workers.dev/api/stripe/webhook",
  "enabled_events[0]": "checkout.session.completed",
  "enabled_events[1]": "customer.subscription.deleted",
  "enabled_events[2]": "charge.refunded",
  description: "WFMA production checkout and lifecycle events",
}, "wfma-webhook-v1");

const portal = await api("billing_portal/configurations", {
  "features[customer_update][enabled]": "true",
  "features[customer_update][allowed_updates][0]": "email",
  "features[invoice_history][enabled]": "true",
  "features[subscription_cancel][enabled]": "true",
  "features[subscription_cancel][mode]": "at_period_end",
  "business_profile[headline]": "Manage your WordPress Form Mail Assurance subscription",
  "business_profile[privacy_policy_url]": "https://wp-form-mail-assurance.wordpress-form-mail-assurance.workers.dev/privacy/",
  "business_profile[terms_of_service_url]": "https://wp-form-mail-assurance.wordpress-form-mail-assurance.workers.dev/terms/",
  default_return_url: "https://wp-form-mail-assurance.wordpress-form-mail-assurance.workers.dev/",
}, "wfma-portal-v1");

writeFileSync("/private/tmp/wfma-stripe-config.json", JSON.stringify({
  prices,
  webhookSecret: webhook.secret,
  webhookId: webhook.id,
  portalId: portal.id,
}), { mode: 0o600 });
console.log(JSON.stringify({ configured: true, prices: Object.keys(prices), webhook: true, portal: true }));
