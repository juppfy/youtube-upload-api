# Deployment Guide

## Railway

### One-Click Deploy

1. Fork or push this repo to GitHub.
2. Go to [railway.app](https://railway.app) and sign in.
3. **New Project** → **Deploy from GitHub** → select the repo.
4. Railway will auto-detect the start script from `package.json`.
5. In **Settings** → **Networking** → **Generate Domain** to get a public URL.
6. Use that URL as the base for your n8n HTTP Request node (e.g. `https://your-app.up.railway.app/upload`).

### Environment Variables on Railway

- `PORT` is set by Railway; do not override unless required.
- No YouTube-related secrets need to be stored on the server; tokens are sent per request from n8n.

### Build and Start Command

Railway uses:

- **Build**: `npm install` (default)
- **Start**: `npm start` → `node src/index.js`

No extra config is needed if you keep the default `package.json` scripts.

---

## Other Platforms

### Render

- **Build Command**: `npm install`
- **Start Command**: `npm start`
- Add a Web Service and connect your repo. Render sets `PORT` automatically.

### Fly.io

```bash
fly launch
fly deploy
```

Ensure the app listens on `process.env.PORT` (default: 3000). Fly sets `PORT`.

### Vercel / Netlify

This is a long-running Node server, not a serverless function. Use Railway, Render, or Fly.io instead.

---

## Health Check

After deployment, verify the API is up:

```bash
curl https://your-app.railway.app/health
```

Expected response:

```json
{"status":"ok","timestamp":"2025-02-12T..."}
```
