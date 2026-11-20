ChatClaud — Cloudflare Pages + Tavily Search

Secrets (Production → Environment variables → Redeploy):
  NVIDIA_API_KEY=...
  TAVILY_API_KEY=tvly-...
  FIREBASE_PROJECT_ID=... (optional override)

Health:
  GET /api/health
  Expect: "tavilyConfigured": true

Search statuses (real only):
  Searching the web…  — Tavily Search
  Reading sources…    — Tavily Extract on top URLs

Identity: ChatClaud (system prompt on server)
UI: no third-party model names shown to users
