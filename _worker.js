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
  // Accept common / typo secret names so Cloudflare binding still works.
  const value =
    env?.SERPER_API_KEY ??
    env?.SERPER_AIP_KEY ??  // common typo: AIP instead of API
    env?.SERPER ??
    env?.SERPER_KEY ??
    env?.SERPERAPIKEY ??
    "";
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

/** Skip only pure chat; prefer search for factual/current questions. */
function shouldSearch(text, forceSearch) {
  if (forceSearch) return true;
  const q = String(text || "").trim();
  if (q.length < 3) return false;
  const lower = q.toLowerCase();

  // Clear non-search small talk
  const smallTalk = /^(hi|hello|hey|yo|привет|здравств|как дела|how are you|who are you|что ты|ты кто|thanks|спасибо|ok|ок|cool|пока|bye)\b/;
  if (smallTalk.test(lower) && q.length < 48) return false;

  // Explicit search intent
  const explicit = [
    "найди", "найти", "поищи", "поиск", "загугли", "гугл", "search", "google", "look up", "find",
    "новости", "news", "latest", "актуальн", "сейчас", "сегодня", "today", "yesterday", "this week",
    "цена", "price", "стоимость", "курс", "version", "версия", "релиз", "release", "update",
    "источник", "sources", "сайт", "website", "ссылк", "url", "http",
    "кто выиграл", "who won", "когда вышел", "что нового", "current", "сколько стоит",
    "weather", "погода", "расписан", "расписание", "score", "счёт", "результат матча"
  ];
  if (explicit.some((h) => lower.includes(h))) return true;

  // Years / versions often need live data
  if (/\b(20(2[3-9]|3[0-9]))\b/.test(q)) return true;

  // Question forms about facts (ru/en) — better to search than invent
  const factualQ = /(\?|ли\b|что такое|кто такой|кто такая|где находится|когда|сколько|какой|какая|какие|why|what is|who is|where is|when did|how much|how many)/i;
  if (factualQ.test(q) && q.length >= 12) return true;

  // Named entities + "про/about" style
  if (/\b(про|about|regarding)\b/i.test(lower) && q.length >= 16) return true;

  return false;
}

function detectLang(text) {
  return /[а-яё]/i.test(String(text || "")) ? "ru" : "en";
}

function buildSearchQueries(text) {
  const raw = String(text || "").trim().replace(/\s+/g, " ");
  const q = raw.slice(0, 220);
  const queries = [];
  if (q) queries.push(q);

  // Strip filler phrases for a cleaner second query
  let cleaned = q
    .replace(/^(пожалуйста|please|можешь|could you|can you|скажи|tell me|найди|поищи|search for|find)\s+/ig, "")
    .replace(/\b(в интернете|on the web|online|пожалуйста)\b/ig, "")
    .trim();
  if (cleaned && cleaned.toLowerCase() !== q.toLowerCase() && cleaned.length >= 4) {
    queries.push(cleaned.slice(0, 180));
  }

  // Keyword-ish third query for long Russian questions
  if (q.length > 70) {
    const stop = new Set(["это","как","что","или","для","при","the","and","for","with","that","this","from","про","мне","мне","пожалуйста"]);
    const words = q.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
    const key = words.slice(0, 10).join(" ");
    if (key && !queries.includes(key)) queries.push(key);
  }

  // unique preserve order
  const seen = new Set();
  const out = [];
  for (const item of queries) {
    const k = item.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out.slice(0, 3);
}

function mapOrganic(organic) {
  return (Array.isArray(organic) ? organic : []).map((item) => ({
    title: String(item.title || "").slice(0, 180),
    url: String(item.link || item.url || "").slice(0, 500),
    snippet: String(item.snippet || item.description || item.attributes?.Description || "").slice(0, 400),
    domain: (() => {
      try { return new URL(item.link || item.url || "").hostname.replace(/^www\./, ""); }
      catch { return ""; }
    })()
  })).filter((s) => /^https?:\/\//i.test(s.url));
}

async function serperSearch(query, apiKey, signal, lang) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });
  try {
    const body = {
      q: query,
      num: 10,
      gl: lang === "ru" ? "ru" : "us",
      hl: lang === "ru" ? "ru" : "en"
    };
    const response = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
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
      let detail = "";
      try { detail = (await response.text()).slice(0, 200); } catch {}
      const err = new Error(`Serper HTTP ${response.status} ${detail}`);
      err.code = "serper_error";
      throw err;
    }
    const data = await response.json();
    const sources = mapOrganic(data.organic);

    // Answer box / knowledge graph as synthetic high-priority snippets
    if (data.answerBox) {
      const ab = data.answerBox;
      const answer = String(ab.answer || ab.snippet || ab.title || "").slice(0, 400);
      const link = String(ab.link || ab.url || sources[0]?.url || "");
      if (answer) {
        sources.unshift({
          title: String(ab.title || "Answer box").slice(0, 180),
          url: link.startsWith("http") ? link : (sources[0]?.url || "https://www.google.com"),
          snippet: answer,
          domain: (() => { try { return new URL(link).hostname.replace(/^www\./, ""); } catch { return "answer"; } })()
        });
      }
    }
    if (data.knowledgeGraph) {
      const kg = data.knowledgeGraph;
      const desc = String(kg.description || "").slice(0, 400);
      if (desc) {
        sources.unshift({
          title: String(kg.title || "Knowledge graph").slice(0, 180),
          url: String(kg.website || kg.descriptionLink || sources[0]?.url || "https://www.google.com"),
          snippet: desc,
          domain: (() => {
            try { return new URL(kg.website || "").hostname.replace(/^www\./, ""); }
            catch { return "knowledge"; }
          })()
        });
      }
    }

    // de-dupe by url
    const seen = new Set();
    const unique = [];
    for (const s of sources) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      unique.push(s);
    }
    return unique;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function formatSearchContext(sources, query) {
  if (!sources.length) {
    return [
      "Web search was executed but returned no usable results for:",
      query,
      "Tell the user that live sources were not found. Do not invent URLs."
    ].join("\n");
  }
  const lines = sources.map((s, i) =>
    `[${i + 1}] ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet || "(no snippet)"}`
  );
  return [
    "LIVE WEB SEARCH RESULTS (Google via Serper). These are search snippets, not full pages.",
    "Base factual claims on this evidence. Cite only these real URLs. Never invent links.",
    "If snippets conflict or are thin, say so clearly.",
    "User query: " + query,
    "",
    lines.join("\n\n")
  ].join("\n");
}

function injectSearchEvidence(messages, sources, query) {
  const evidence = formatSearchContext(sources, query);
  // Prefer injecting into the last user message so the model always sees evidence next to the question.
  const cloned = messages.map((m) => ({ role: m.role, content: m.content }));
  for (let i = cloned.length - 1; i >= 0; i--) {
    if (cloned[i].role === "user") {
      cloned[i] = {
        role: "user",
        content: cloned[i].content + "\n\n---\n" + evidence
      };
      return cloned;
    }
  }
  return cloned.concat({ role: "user", content: evidence });
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
        let usedSearch = false;

        if (wantSearch) {
          if (!serperApiKey) {
            sendError("config", "Search is not configured. Set SERPER_API_KEY in Cloudflare secrets.");
            return;
          }
          // Status only when Serper is actually about to run
          send({ type: "status", stage: "search", label: "Checking the site…" });
          usedSearch = true;
          const lang = detectLang(userText);
          const queries = buildSearchQueries(userText);
          try {
            for (const query of queries) {
              if (aborter.signal.aborted) break;
              const batch = await serperSearch(query, serperApiKey, aborter.signal, lang);
              for (const item of batch) {
                if (!sources.some((s) => s.url === item.url)) sources.push(item);
              }
              // Enough high-quality hits
              if (sources.length >= 8) break;
            }
            // If still empty, one broader fallback query
            if (!sources.length && queries[0]) {
              const fallback = queries[0].split(/\s+/).slice(0, 6).join(" ");
              if (fallback) {
                const batch = await serperSearch(fallback, serperApiKey, aborter.signal, lang);
                for (const item of batch) {
                  if (!sources.some((s) => s.url === item.url)) sources.push(item);
                }
              }
            }
          } catch (error) {
            if (aborter.signal.aborted) return;
            console.error("Serper failed", error?.code || error?.message || error);
            if (error?.code === "serper_auth") {
              sendError("serper_auth", "Search API key was rejected. Check SERPER_API_KEY.");
              return;
            }
            if (error?.code === "serper_busy") {
              sendError("busy", "Search is busy right now. Please wait and try again in 2.5 minutes.", 150);
              return;
            }
            if (error?.name === "AbortError") {
              sendError("serper_error", "Search timed out. Please try again.");
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
          } else {
            // Honest empty result — still continue to model with explicit note
            send({
              type: "status",
              stage: "resources",
              label: "No live sources found…"
            });
          }

          modelMessages = injectSearchEvidence(messages, sources.slice(0, 8), userText);
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
            // Slightly lower temperature when answering from search evidence
            temperature: usedSearch ? 0.6 : 1,
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
      const serperBindings = Object.keys(env || {}).filter((name) =>
        /serper/i.test(name)
      );
      return json({
        ok: true,
        name: "Ghost AI",
        model: MODEL,
        nvidiaConfigured: Boolean(getNvidiaApiKey(env)),
        serperConfigured: Boolean(getSerperApiKey(env)),
        serperBindings,
        firebaseConfigured: Boolean(getFirebaseProjectId(env))
      });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname.startsWith("/api/")) return json({ error: "API route not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
