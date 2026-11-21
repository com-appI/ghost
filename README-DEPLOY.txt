ChatClaud — Cloudflare Pages + NVIDIA Nemotron 3 Ultra

Required secret (Cloudflare Pages → Settings → Variables and Secrets):
  NVIDIA_API_KEY=...

Optional variable:
  FIREBASE_PROJECT_ID=toypsig-2953f

Keep the NVIDIA API key only in the server-side Cloudflare secret store.
Never put it in config.js, app.js, HTML, or any file committed to GitHub.

Health:
  GET /api/health
  Expected: nvidiaConfigured: true, firebaseConfigured: true

Chat requests are sent directly to NVIDIA:
  Model: nvidia/nemotron-3-ultra-550b-a55b
  Endpoint: https://integrate.api.nvidia.com/v1/chat/completions

This build does not include a web-search provider.
Identity: ChatClaud (server-side system prompt).
