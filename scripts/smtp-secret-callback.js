import http from "node:http";
import { writeFileSync } from "node:fs";

const page = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>WFMA — SMTP local</title>
<style>body{font:16px system-ui;max-width:560px;margin:64px auto;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin-top:12px}small{color:#555}</style>
<h1>WFMA — secret SMTP local</h1><p>Collez ici le mot de passe d’application Google à 16 caractères. Il est envoyé uniquement à <code>127.0.0.1</code>, jamais à un site tiers.</p>
<form method="post"><input name="secret" type="password" autocomplete="off" required minlength="16" aria-label="Mot de passe d’application"><button>Transmettre localement</button></form>
<small>Cette page et son serveur s’arrêtent immédiatement après réception.</small></html>`;

const server = http.createServer((request, response) => {
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    return;
  }
  if (request.method !== "POST") return response.writeHead(405).end();
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const secret = new URLSearchParams(body).get("secret")?.replace(/\s+/g, "") || "";
    if (secret.length < 16) return response.writeHead(400).end("Secret invalide.");
    writeFileSync("/private/tmp/wfma-smtp-secret", secret, { mode: 0o600 });
    console.log("SMTP_APP_PASSWORD_STORED");
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Secret reçu localement. Revenez dans Codex.");
    server.close();
  });
});

server.listen(9877, "127.0.0.1", () => console.log("SMTP_SECRET_FORM_READY http://127.0.0.1:9877"));
