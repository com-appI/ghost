const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_BODY = 128 * 1024;
const MAX_MESSAGES = 24;
const MAX_CHARS = 12000;
let jwksCache = { keys: null, expires: 0 };
const rateBuckets = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
function decodeB64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function decodePart(value) {
  return JSON.parse(new TextDecoder().decode(decodeB64url(value)));
}
async function getJwks() {
  if (jwksCache.keys && Date.now() < jwksCache.expires) return jwksCache.keys;
  const response = await fetch(FIREBASE_JWKS_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Firebase signing keys unavailable");
  const data = await response.json();
  const age = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/i)?.[1] || 3600);
  jwksCache = { keys: data.keys || [], expires: Date.now() + Math.min(Math.max(age, 60), 3600) * 1000 };
  return jwksCache.keys;
}
async function verifyFirebaseToken(token, projectId) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !projectId) throw new Error("Invalid token");
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("Invalid token");
  let jwk = (await getJwks()).find(k => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) {
    jwksCache.expires = 0;
    jwk = (await getJwks()).find(k => k.kid === header.kid && k.kty === "RSA");
  }
  if (!jwk) throw new Error("Unknown signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const signature = decodeB64url(parts[2]);
  const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signed);
  const now = Math.floor(Date.now() / 1000);
  if (!valid || claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}` ||
      typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      typeof claims.iat !== "number" || claims.iat > now + 60) throw new Error("Invalid Firebase token");
  return { uid: claims.sub };
}
function validateMessages(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) return null;
  const out = [];
  for (const item of value) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") return null;
    const content = item.content.trim();
    if (!content || content.length > MAX_CHARS || (out.length && out[out.length - 1].role === item.role)) return null;
    out.push({ role: item.role, content });
  }
  if (out[0].role !== "user" || out[out.length - 1].role !== "user") return null;
  return out;
}
function rateAllowed(uid, env) {
  const now = Date.now();
  const limit = Math.max(1, Number(env.RATE_LIMIT_REQUESTS) || 20);
  const windowMs = Math.max(60000, Number(env.RATE_LIMIT_WINDOW_MS) || 600000);
  const current = rateBuckets.get(uid);
  if (!current || current.reset <= now) {
    rateBuckets.set(uid, { count: 1, reset: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
function streamNvidia(upstream) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let closed = false;
  return new ReadableStream({
    async start(controller) {
      const send = obj => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const parseLine = line => {
        if (!line.startsWith("data:")) return;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") return;
        try {
          const packet = JSON.parse(raw);
          const delta = packet.choices?.[0]?.delta;
          if (typeof delta?.content === "string" && delta.content) send({ content: delta.content });
        } catch { /* ignore provider keepalive/non-JSON lines */ }
      };
      try {
        const reader = upstream.body.getReader();
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          lines.forEach(parseLine);
        }
        buffer += decoder.decode();
        if (buffer) parseLine(buffer);
        send({ done: true });
      } catch {
        send({ error: "Поток ответа прервался. Попробуйте ещё раз." });
      } finally {
        controller.close();
      }
    },
    cancel() { closed = true; }
  });
}
async function handleChat(request, env) {
  if (!env.NVIDIA_API_KEY) return json({ error: "Добавьте NVIDIA_API_KEY в Cloudflare → Settings → Variables and Secrets." }, 503);
  if (!env.FIREBASE_PROJECT_ID) return json({ error: "Добавьте FIREBASE_PROJECT_ID в настройки Cloudflare." }, 503);
  const bearer = request.headers.get("authorization") || "";
  const token = bearer.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Войдите через Google, чтобы начать чат." }, 401);
  let user;
  try { user = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID); }
  catch { return json({ error: "Не удалось проверить вход. Войдите в аккаунт ещё раз." }, 401); }
  if (!rateAllowed(user.uid, env)) return json({ error: "Слишком много запросов. Попробуйте немного позже." }, 429);
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "Слишком большой запрос." }, 413);
    body = JSON.parse(text);
  } catch { return json({ error: "Некорректный JSON." }, 400); }
  const messages = validateMessages(body.messages);
  if (!messages) return json({ error: "Проверьте формат сообщения и попробуйте ещё раз." }, 400);
  let upstream;
  try {
    upstream = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        accept: "text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 16384,
        chat_template_kwargs: { enable_thinking: true },
        stream: true
      }),
      signal: request.signal
    });
  } catch {
    return json({ error: "Не удалось подключиться к NVIDIA. Проверьте настройки ключа." }, 502);
  }
  if (!upstream.ok) {
    const status = upstream.status;
    let detail = "";
    try { detail = (await upstream.text()).slice(0, 500); } catch {}
    console.error("NVIDIA API error", status, detail);
    return json({ error: status === 401 ? "NVIDIA отклонила API-ключ." : "NVIDIA временно не смогла ответить. Попробуйте позже." }, status === 429 ? 429 : 502);
  }
  return new Response(streamNvidia(upstream), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff"
    }
  });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "access-control-allow-origin": url.origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-max-age": "86400"
    }});
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, name: "Ghost AI", model: MODEL, nvidiaConfigured: Boolean(env.NVIDIA_API_KEY), firebaseConfigured: Boolean(env.FIREBASE_PROJECT_ID) });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "API route not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
