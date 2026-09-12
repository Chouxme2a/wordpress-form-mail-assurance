# WordPress Form & Mail Assurance

Continuous end-to-end WordPress form email monitoring for agencies managing 20–100 client sites. The Founding Agency Pilot currently supports only Contact Form 7.

## Verified foundation

- HMAC-SHA256 signed synthetic requests with a five-minute replay window.
- Contact Form 7-only discovery; unsupported providers are rejected without manual work.
- Synthetic recipient isolation using a unique Gmail plus-address and `X-WFMA-Test-ID`.
- Gmail API delivery oracle and automated alert delivery.
- Three-attempt failure confirmation, deduplicated incident notification and recovery notification.
- Every operational event carries `anthony_minutes: 0`.

On 12 September 2026 the complete WordPress → SMTP → Gmail → Gmail API path passed, including forced SMTP failure, retries, incident, alert, restoration, recovery and recovery alert.

## Components

- `wordpress-plugin/`: signed helper, isolated synthetic delivery and self-service connection.
- `worker/`: Cloudflare Worker API, D1 schema, Stripe checkout/webhooks, onboarding, monitor scheduler and Gmail alerting.
- `public/`: landing, free compatibility checker, pricing, qualification and onboarding.
- `.github/workflows/monitor.yml`: scheduled orchestration with retries.

`npm test` exercises the signed protocol and autonomy state machine. `npm run proof:cycle` runs the external proof when the documented environment variables are supplied.

No paid infrastructure is required before the first customer payment. Stripe transaction fees may be deducted from customer revenue.
