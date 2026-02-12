# YouTube Upload API

A Node.js Express server that handles large video uploads to YouTube by streaming files directly from a source URL to YouTube's resumable upload endpoint. Built for use with n8n workflows and deployable to Railway.

## Features

- **Streaming transfers**: Downloads from a URL and uploads to YouTube using Node.js streams—no full-file buffering in memory
- **Async job tracking**: Returns immediately with a job ID; poll for status to avoid timeouts on large uploads
- **Retry logic**: Automatic retries on 5xx errors, 308 Resume Incomplete, and connection failures
- **Sync mode**: Optional `sync: true` to wait for completion before responding (use with care for large files)

## Quick Start

```bash
npm install
npm start
```

The server runs on `http://localhost:3000` (or `PORT` env var).

## API Endpoints

| Method | Path                  | Description                                |
|--------|-----------------------|--------------------------------------------|
| GET    | `/health`             | Health check                               |
| GET    | `/auth/youtube`       | Start OAuth flow (visit in browser once)   |
| GET    | `/auth/youtube/callback` | OAuth callback (handled automatically) |
| GET    | `/auth/status`        | Check if YouTube is connected              |
| POST   | `/upload`             | Start a YouTube video upload               |
| GET    | `/job/:id`            | Get upload job status                      |

### POST /upload

**Request body (JSON):**

| Field          | Type   | Required | Description                                                                 |
|----------------|--------|----------|-----------------------------------------------------------------------------|
| `videoUrl`     | string | Yes      | URL to download the video from (must support HEAD for Content-Length)       |
| `uploadUrl`    | string | No*      | YouTube resumable upload URL (omit if using in-app OAuth)                   |
| `videoMetadata`| object | No*      | Required when `uploadUrl` omitted: `{snippet:{title,...}, status:{privacyStatus}}` |
| `oauthToken`   | string | No*      | YouTube OAuth 2.0 access token (or use `Authorization: Bearer` header)      |
| `clientId`     | string | No*      | Google OAuth2 client ID (use with clientSecret + refreshToken)              |
| `clientSecret` | string | No*      | Google OAuth2 client secret                                                 |
| `refreshToken` | string | No*      | OAuth2 refresh token                                                        |

*Auth: Use in-app OAuth (visit `/auth/youtube` once), OR `Authorization: Bearer`, OR body `oauthToken`, OR (`clientId`+`clientSecret`+`refreshToken`).
| `contentLength`| number | No       | File size in bytes; if omitted, a HEAD request fetches it                   |
| `contentType`  | string | No       | MIME type (default: `video/webm`)                                           |
| `sync`         | boolean| No       | If `true`, wait for upload to finish before responding (default: `false`)   |

**Async response (202 Accepted):**

```json
{
  "jobId": "job_1709123456789_abc123",
  "status": "accepted",
  "message": "Upload started. Poll GET /job/:id for status.",
  "pollUrl": "/job/job_1709123456789_abc123"
}
```

**Sync response (201 Created):** Full job object including `result.videoId` when complete.

**Job object (GET /job/:id):**

```json
{
  "id": "job_1709123456789_abc123",
  "status": "completed",
  "result": {
    "statusCode": 201,
    "videoId": "dQw4w9WgXcQ"
  }
}
```

## n8n Integration

**Easiest:** Set `BASE_URL`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` in env, add redirect URI to Google Console, visit `{BASE_URL}/auth/youtube` once, then n8n only needs:

```json
{ "videoUrl": "{{ $json.videoUrl }}", "videoMetadata": { "snippet": { "title": "My Video" }, "status": { "privacyStatus": "private" } } }
```

See [docs/N8N-WORKFLOW.md](docs/N8N-WORKFLOW.md) for full setup and other auth options (Authorization header, refresh token).

### Example n8n Expression for uploadUrl

If your setup node returns the Location header in `$json.headers.location`:

```
{{ $json.headers.location }}
```

Or from a previous node:

```
{{ $('YouTube Setup').item.json.headers.location }}
```

## Deployment to Railway

### Prerequisites

- [Railway account](https://railway.app)
- GitHub repo (optional; you can deploy from CLI)

### Deploy from GitHub

1. Push this project to a GitHub repository.
2. In [Railway Dashboard](https://railway.app/dashboard), create a new project.
3. Click **Deploy from GitHub** and select your repo.
4. Railway will detect the Node.js app and use `npm start` from `package.json`.
5. Add a public domain (Settings → Networking → Generate Domain).
6. Copy the generated URL (e.g. `https://youtube-upload-api-production-xxxx.up.railway.app`).

### Deploy with Railway CLI

```bash
npm i -g @railway/cli
railway login
railway init
railway up
railway domain
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Set by Railway automatically |
| `BASE_URL` | Your public URL (e.g. `https://your-app.railway.app`) — required for in-app OAuth |
| `YOUTUBE_CLIENT_ID` | Google OAuth Client ID — for in-app OAuth |
| `YOUTUBE_CLIENT_SECRET` | Google OAuth Client Secret — for in-app OAuth |

With in-app OAuth, credentials are stored on the server after you visit `/auth/youtube` once.

## Environment Configuration

Copy `.env.example` to `.env` for local development:

```bash
cp .env.example .env
```

See `.env.example` for available options.

## Requirements

- **Node.js** ≥ 18
- **videoUrl** must:
  - Be publicly accessible (or reachable from the server)
  - Support HEAD requests that return `Content-Length`
  - Return the actual video stream (no redirect chains that break streaming)

If the source does not expose `Content-Length`, pass `contentLength` in the request body.

## License

MIT
