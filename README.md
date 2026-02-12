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

| Method | Path        | Description                    |
|--------|-------------|--------------------------------|
| GET    | `/health`   | Health check                   |
| POST   | `/upload`   | Start a YouTube video upload   |
| GET    | `/job/:id`  | Get upload job status          |

### POST /upload

**Request body (JSON):**

| Field          | Type   | Required | Description                                                                 |
|----------------|--------|----------|-----------------------------------------------------------------------------|
| `videoUrl`     | string | Yes      | URL to download the video from (must support HEAD for Content-Length)       |
| `uploadUrl`    | string | Yes      | YouTube resumable upload URL (from setup node's `json.headers.location`)    |
| `oauthToken`   | string | Yes      | YouTube OAuth 2.0 access token                                              |
| `videoMetadata`| object | No       | Snippet/status metadata (for logging/reference)                             |
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

### Workflow Setup

1. **YouTube OAuth + Setup node**  
   Use YouTube nodes to authenticate and create a resumable upload session. Capture:
   - `uploadUrl` from `json.headers.location`
   - `oauthToken` from your OAuth credentials

2. **HTTP Request node** (instead of the built-in YouTube upload node)
   - **Method**: POST
   - **URL**: `https://your-app.railway.app/upload` (or your deployed URL)
   - **Body Content Type**: JSON
   - **Body**:
   ```json
   {
     "videoUrl": "{{ $json.videoUrl }}",
     "uploadUrl": "{{ $json.uploadUrl }}",
     "oauthToken": "{{ $json.oauthToken }}",
     "contentType": "video/webm",
     "sync": false
   }
   ```

3. **Poll for completion** (if async):
   - Use a **Wait** node (e.g. 30s), then an **HTTP Request** to `GET /job/{{ $json.jobId }}`
   - Loop until `status === 'completed'` or `status === 'failed'`

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

Railway sets `PORT` automatically. If needed, add:

| Variable | Description        |
|----------|--------------------|
| `PORT`   | Server port (Railway provides this) |

No YouTube credentials are stored on the server; they are passed per request from n8n.

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
