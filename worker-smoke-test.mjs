import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Load Cloudflare's _worker.js as an ES module without requiring package.json.
const workerSource = await readFile(new URL("./_worker.js", import.meta.url), "utf8");
const workerUrl = `data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`;
const { default: worker } = await import(workerUrl);

const assets = { fetch: async () => new Response("Ghost AI UI", { status: 200 }) };
const request = path => new Request(`https://ghost.example${path}`);

let response = await worker.fetch(request("/api/health"), { ASSETS: assets });
assert.equal(response.status, 200);
let health = await response.json();
assert.equal(health.ok, true);
assert.equal(health.nvidiaConfigured, false);
assert.deepEqual(health.nvidiaBindings, []);
assert.equal(health.firebaseConfigured, true); // public project ID fallback

response = await worker.fetch(new Request("https://ghost.example/api/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Привет" }] })
}), { ASSETS: assets });
assert.equal(response.status, 503);
assert.match((await response.json()).error, /Cloudflare не передал секрет/);

response = await worker.fetch(request("/api/health"), {
  ASSETS: assets, NVIDIA_API_KEY: "test-only"
});
health = await response.json();
assert.equal(health.nvidiaConfigured, true);
assert.deepEqual(health.nvidiaBindings, ["NVIDIA_API_KEY"]);

response = await worker.fetch(request("/api/health"), {
  ASSETS: assets, NVIDIA: "test-only"
});
health = await response.json();
assert.equal(health.nvidiaConfigured, true); // backwards-compatible alias
assert.deepEqual(health.nvidiaBindings, ["NVIDIA"]);

response = await worker.fetch(new Request("https://ghost.example/api/chat", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Привет" }] })
}), { ASSETS: assets, NVIDIA_API_KEY: "test-only" });
assert.equal(response.status, 401); // key exists; Firebase auth is now the next gate

response = await worker.fetch(request("/"), { ASSETS: assets });
assert.equal(await response.text(), "Ghost AI UI");
console.log("Cloudflare Worker smoke tests: 6 passed");
