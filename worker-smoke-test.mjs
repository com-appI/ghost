import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Load Cloudflare's _worker.js as an ES module without requiring a package.json.
const workerSource = await readFile(new URL("./_worker.js", import.meta.url), "utf8");
const workerUrl = `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`;
const { default: worker } = await import(workerUrl);

const assets = { fetch: async () => new Response("Ghost AI UI", { status: 200 }) };
let response = await worker.fetch(new Request("https://ghost.example/api/health"), {
  ASSETS: assets, FIREBASE_PROJECT_ID: "toypsig-2953f"
});
assert.equal(response.status, 200);
let health = await response.json();
assert.equal(health.ok, true);
assert.equal(health.nvidiaConfigured, false);

response = await worker.fetch(new Request("https://ghost.example/api/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Привет" }] })
}), { ASSETS: assets });
assert.equal(response.status, 503);

response = await worker.fetch(new Request("https://ghost.example/api/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Привет" }] })
}), { ASSETS: assets, NVIDIA_API_KEY: "test-only" });
assert.equal(response.status, 503); // project id missing

response = await worker.fetch(new Request("https://ghost.example/api/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Привет" }] })
}), { ASSETS: assets, NVIDIA_API_KEY: "test-only", FIREBASE_PROJECT_ID: "toypsig-2953f" });
assert.equal(response.status, 401);

response = await worker.fetch(new Request("https://ghost.example/"), { ASSETS: assets });
assert.equal(await response.text(), "Ghost AI UI");
console.log("Cloudflare Worker smoke tests: 5 passed");
