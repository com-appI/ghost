import worker from "./_worker.mjs";
import assert from "node:assert/strict";

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
