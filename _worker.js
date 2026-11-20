const MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const SERPER_URL = "https://google.serper.dev/search";
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MAX_BODY = 128 * 1024;
const MAX_MESSAGES = 24;
const MAX_CHARS = 12000;
const DEFAULT_FIREBASE_PROJECT_ID = "toypsig-2953f";
let jwksCache = { keys: null, expires: 0 };
const rateBuckets = new Map();

function getNvidiaApiKey(env) {
  const value = env?.NVIDIA_API_KEY ?? env?.NVIDIA ?? "";
  return typeof value === "string" ? value.trim() : "";
}
function getSerperApiKey(env) {
  const value = env?.SERPER_API_KEY ?? "";
  return typeof value === "string" ? value.trim() : "";
}
function getFirebaseProjectId(env) {
  const configured = typeof env?.FIREBASE_PROJECT_ID === "string" ? env.FIREBASE_PROJECT_ID.trim() : "";
  return configured || DEFAULT_FIREBASE_PROJECT_ID;
}
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
  const payload = decodePart(parts[1]);
  if (header.alg !== "RS256") throw new Error("Unsupported token algorithm");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Invalid issuer");
  if (payload.aud !== projectId) throw new Error("Invalid audience");
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("Invalid subject");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now() - 30000) throw new Error("Token expired");
  const keys = await getJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("Signing key not found");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeB64url(parts[2]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!valid) throw new Error("Invalid signature");
  return { uid: payload.sub, email: payload.email || null };
}
function rateAllowed(uid, env) {
  const limit = Number(env?.RATE_LIMIT_PER_MIN || 20);
  const now = Date.now();
  const bucket = rateBuckets.get(uid) || { count: 0, reset: now + 60000 };
  if (now > bucket.reset) {
    bucket.count = 0;
    bucket.reset = now + 60000;
  }
  bucket.count += 1;
  rateBuckets.set(uid, bucket);
  return bucket.count <= limit;
}
function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return null;
  let total = 0;
  const clean = [];
  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant" && message.role !== "system")) return null;
    const content = String(message.content || "").trim();
    if (!content) continue;
    total += content.length;
    if (total > MAX_CHARS) return null;
    clean.push({ role: message.role, content: content.slice(0, 8000) });
  }
  return clean.length ? clean : null;
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

/** Heuristic: only search when the question needs live/public web info. */
function shouldSearch(text, forceSearch) {
  if (forceSearch) return true;
  const q = String(text || "").toLowerCase();
  if (!q || q.length < 4) return false;
  // Skip pure greetings / simple chat
  if (/^(hi|hello|hey|привет|здравствуй|как дела|who are you|что ты|ты кто)\b/.test(q) && q.length < 40) return false;
  const hints = [
    "найди", "поищи", "загугли", "search", "google", "look up", "find me",
    "новости", "news", "latest", "актуальн", "сейчас", "сегодня", "today", "this week",
    "цена", "price", "курс", "version", "релиз", "release", "update",
    "источник", "sources", "сайт", "website", "url", "http",
    "who won", "когда вышел", "что нового", "current"
  ];
  if (hints.some((h) => q.includes(h))) return true;
  if (/\b(20(2[4-9]|3[0-9]))\b/.test(q) && /(version|release|news|цена|price|курс)/.test(q)) return true;
  return false;
}

function buildSearchQueries(text) {
  const q = String(text || "").trim().slice(0, 200);
  const queries = [q];
  // Light second query for refinement on long questions
  if (q.length > 80) {
    const short = q.replace(/[?!.]+/g, " ").split(/\s+/).slice(0, 12).join(" ");
    if (short && short !== q) queries.push(short);
  }
  return queries.slice(0, 2);
}

async function serperSearch(query, apiKey, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({ q: query, num: 6 }),
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      const err = new Error("Serper authentication failed");
      err.code = "serper_auth";
      throw err;
    }
    if (response.status === 429) {
      const err = new Error("Serper rate limited");
      err.code = "serper_busy";
      throw err;
    }
    if (!response.ok) {
      const err = new Error(`Serper HTTP ${response.status}`);
      err.code = "serper_error";
      throw err;
    }
    const data = await response.json();
    const organic = Array.isArray(data.organic) ? data.organic : [];
    return organic.map((item) => ({
      title: String(item.title || "").slice(0, 160),
      url: String(item.link || item.url || "").slice(0, 500),
      snippet: String(item.snippet || item.description || "").slice(0, 320),
      domain: (() => {
        try { return new URL(item.link || item.url || "").hostname.replace(/^www\./, ""); }
        catch { return ""; }
      })()
    })).filter((s) => s.url.startsWith("http"));
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function formatSearchContext(sources) {
  if (!sources.length) {
    return "Web search returned no results. Answer from general knowledge and say that live sources were not found.";
  }
  const lines = sources.map((s, i) =>
    `[${i + 1}] ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`
  );
  return [
    "Web search evidence from Google via Serper (snippets only — not full page text).",
    "Use only these URLs when citing sources. Do not invent links.",
    "If the snippets are incomplete, say the answer is based on search snippets.",
    "",
    lines.join("\n\n")
  ].join("\n");
}

function streamChat(request, messages, env, options = {}) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const aborter = new AbortController();
  let cancelled = false;
  let upstreamReader = null;
  const abortFromRequest = () => aborter.abort();
  request.signal.addEventListener("abort", abortFromRequest, { once: true });

  const nvidiaApiKey = getNvidiaApiKey(env);
  const serperApiKey = getSerperApiKey(env);
  const forceSearch = !!options.forceSearch;

  return new ReadableStream({
    async start(controller) {
      const send = (packet) => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(packet)}\n\n`));
      };
      const sendError = (code, message, retryAfterSec) => {
        const packet = { type: "error", code, message };
        if (retryAfterSec) packet.retryAfterSec = retryAfterSec;
        send(packet);
      };

      try {
        send({ type: "status", stage: "thinking", label: "Thinking…" });

        const userText = lastUserText(messages);
        const wantSearch = shouldSearch(userText, forceSearch);
        let sources = [];
        let modelMessages = messages.slice();

        if (wantSearch) {
          if (!serperApiKey) {
            sendError("config", "Search is not configured. Set SERPER_API_KEY in Cloudflare secrets.");
            return;
          }
          send({ type: "status", stage: "search", label: "Checking the site…" });
          const queries = buildSearchQueries(userText);
          try {
            for (const query of queries) {
              if (aborter.signal.aborted) break;
              const batch = await serperSearch(query, serperApiKey, aborter.signal);
              for (const item of batch) {
                if (!sources.some((s) => s.url === item.url)) sources.push(item);
              }
              if (sources.length >= 6) break;
            }
          } catch (error) {
            if (aborter.signal.aborted) return;
            if (error?.code === "serper_auth") {
              sendError("serper_auth", "Search API key was rejected. Check SERPER_API_KEY.");
              return;
            }
            if (error?.code === "serper_busy") {
              sendError("busy", "Search is busy right now. Please wait and try again in 2.5 minutes.", 150);
              return;
            }
            sendError("serper_error", "Search failed. Please try again.");
            return;
          }

          send({ type: "status", stage: "resources", label: "Checking resources…" });
          if (sources.length) {
            send({
              type: "sources",
              items: sources.slice(0, 8).map((s) => ({
                title: s.title,
                url: s.url,
                snippet: s.snippet,
                domain: s.domain
              }))
            });
          }

          modelMessages = messages.concat({
            role: "system",
            content: formatSearchContext(sources.slice(0, 8))
          });
        }

        send({ type: "status", stage: "answer", label: "Formulating the answer…" });

        const upstream = await fetch(NVIDIA_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${nvidiaApiKey}`,
            accept: "text/event-stream",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: MODEL,
            messages: modelMessages,
            temperature: 1,
            top_p: 0.95,
            max_tokens: 16384,
            chat_template_kwargs: { enable_thinking: true },
            stream: true
          }),
          signal: aborter.signal
        });

        if (!upstream.ok) {
          let detail = "";
          try { detail = (await upstream.text()).slice(0, 500); } catch {}
          console.error("NVIDIA API error", upstream.status, detail);
          if (upstream.status === 429 || upstream.status === 503) {
            sendError("busy", "Server is full right now. Please wait and try again in 2.5 minutes.", 150);
          } else if (upstream.status === 401) {
            sendError("upstream_auth", "NVIDIA rejected the API key. Check the Cloudflare secret.");
          } else {
            sendError("upstream_error", "NVIDIA could not complete the request. Please try again later.");
          }
          return;
        }
        if (!upstream.body) {
          sendError("empty_stream", "NVIDIA returned an empty response stream.");
          return;
        }

        upstreamReader = upstream.body.getReader();
        let buffer = "";
        let reasoningReported = false;
        let providerFinished = false;
        const parseLine = (line) => {
          if (!line.startsWith("data:")) return;
          const raw = line.slice(5).trim();
          if (!raw) return;
          if (raw === "[DONE]") { providerFinished = true; return; }
          try {
            const packet = JSON.parse(raw);
            const delta = packet.choices?.[0]?.delta;
            const hasReasoning = (typeof delta?.reasoning_content === "string" && delta.reasoning_content) ||
              (typeof delta?.reasoning === "string" && delta.reasoning);
            if (hasReasoning && !reasoningReported) {
              reasoningReported = true;
              send({ type: "status", stage: "reasoning", label: "Reasoning…" });
            }
            if (typeof delta?.content === "string" && delta.content) {
              send({ type: "token", text: delta.content });
            }
          } catch {
            // ignore keepalive
          }
        };

        while (!cancelled) {
          const { value, done } = await upstreamReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            parseLine(line);
            if (providerFinished) break;
          }
          if (providerFinished) break;
        }
        buffer += decoder.decode();
        if (buffer && !providerFinished) parseLine(buffer);
        if (!cancelled && !aborter.signal.aborted) send({ type: "done" });
      } catch (error) {
        if (!cancelled && !aborter.signal.aborted) {
          console.error("Chat stream failed", error?.message || error);
          sendError("stream_error", "The response stream was interrupted. Please try again.");
        }
      } finally {
        request.signal.removeEventListener("abort", abortFromRequest);
        try { upstreamReader?.releaseLock(); } catch {}
        if (!cancelled) controller.close();
      }
    },
    async cancel() {
      cancelled = true;
      aborter.abort();
      try { await upstreamReader?.cancel(); } catch {}
      request.signal.removeEventListener("abort", abortFromRequest);
    }
  });
}

async function handleChat(request, env) {
  const nvidiaApiKey = getNvidiaApiKey(env);
  const firebaseProjectId = getFirebaseProjectId(env);
  if (!nvidiaApiKey) return json({ type: "error", code: "config", error: "NVIDIA_API_KEY is not configured." }, 500);

  const bearer = request.headers.get("authorization") || "";
  const token = bearer.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ type: "error", code: "unauthorized", error: "Sign in to start chatting." }, 401);
  let user;
  try { user = await verifyFirebaseToken(token, firebaseProjectId); }
  catch { return json({ type: "error", code: "unauthorized", error: "Could not verify sign-in. Please sign in again." }, 401); }

  if (!rateAllowed(user.uid, env)) {
    return json({
      type: "error", code: "busy",
      message: "Server is full right now. Please wait and try again in 2.5 minutes.",
      retryAfterSec: 150
    }, 429);
  }

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ type: "error", code: "too_large", error: "Request is too large." }, 413);
    body = JSON.parse(text);
  } catch { return json({ type: "error", code: "bad_json", error: "Invalid JSON." }, 400); }

  const messages = validateMessages(body.messages);
  if (!messages) return json({ type: "error", code: "invalid_messages", error: "Invalid message format." }, 400);

  const forceSearch = !!(body.forceSearch || body.search === true);

  return new Response(streamChat(request, messages, env, { forceSearch }), {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no"
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
      return json({
        ok: true,
        name: "Ghost AI",
        model: MODEL,
        nvidiaConfigured: Boolean(getNvidiaApiKey(env)),
        serperConfigured: Boolean(getSerperApiKey(env)),
        firebaseConfigured: Boolean(getFirebaseProjectId(env))
      });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "API route not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
