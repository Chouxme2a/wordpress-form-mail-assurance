import http from "node:http";
import { writeFileSync } from "node:fs";

const page = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>WFMA — Stripe local</title>
<style>body{font:16px system-ui;max-width:560px;margin:64px auto;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin-top:12px}small{color:#555}</style>
<h1>WFMA — clé Stripe locale</h1><p>Collez la clé secrète de production Stripe. Elle est envoyée uniquement à <code>127.0.0.1</code>.</p>
<form method="post"><input name="secret" type="password" autocomplete="off" required pattern="rk_live_.+|sk_live_.+" aria-label="Clé secrète Stripe"><button>Transmettre localement</button></form>
<small>Le serveur s’arrête immédiatement après réception.</small></html>`;

const server = http.createServer((request, response) => {
  if (request.method === "GET") return response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
  if (request.method !== "POST") return response.writeHead(405).end();
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const secret = new URLSearchParams(body).get("secret")?.trim() || "";
    if (!/^(sk|rk)_live_[A-Za-z0-9]+$/.test(secret)) return response.writeHead(400).end("Clé invalide.");
    writeFileSync("/private/tmp/wfma-stripe-secret", secret, { mode: 0o600 });
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Clé Stripe reçue localement. Revenez dans Codex.");
    server.close();
  });
});

server.listen(9878, "127.0.0.1", () => console.log("STRIPE_SECRET_FORM_READY http://127.0.0.1:9878"));
