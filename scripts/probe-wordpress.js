import { signRequest } from "../src/monitor-core.js";

const base = process.env.WFMA_WORDPRESS_URL || "http://127.0.0.1:9401";
const secret = process.env.WFMA_SITE_SECRET || "local-proof-secret-change-before-public-use";

async function signedFetch(path, init = {}) {
  const body = init.body || "";
  const timestamp = Math.floor(Date.now() / 1000);
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "x-wfma-timestamp": String(timestamp),
      "x-wfma-signature": signRequest(secret, timestamp, body),
    },
  });
}

const response = await signedFetch("/wp-json/wfma/v1/forms");
console.log(response.status, await response.text());
process.exit(response.ok ? 0 : 1);
