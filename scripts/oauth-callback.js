import http from "node:http";

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:9876");
  if (url.pathname !== "/") {
    response.writeHead(404).end();
    return;
  }
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  response.writeHead(code ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
  response.end(code ? "WFMA Gmail authorization received. You may return to Codex." : `Authorization failed: ${error || "missing code"}`);
  console.log(code ? `OAUTH_CODE=${code}` : `OAUTH_ERROR=${error || "missing_code"}`);
  server.close();
});

server.listen(9876, "127.0.0.1", () => console.log("OAUTH_CALLBACK_READY http://127.0.0.1:9876"));
