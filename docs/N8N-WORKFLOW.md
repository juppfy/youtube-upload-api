# n8n Workflow Guide

This guide explains how to replace the native YouTube upload node in n8n with this API to avoid crashes on large video uploads.

## Why Use This API?

The built-in YouTube node in n8n may crash or timeout when:
- Uploading large video files
- Handling long-running transfers
- Processing streams

This API runs on a dedicated server (e.g. Railway) and uses Node.js streams to handle large files without loading them fully into memory.

## Workflow Structure

### 1. Get Video URL

Your video might come from:
- A storage bucket (S3, GCS, etc.) – use a signed/public URL
- A previous node that generated or hosted the video
- An external CDN or file host

Ensure the URL is **directly downloadable** and returns `Content-Length` in responses (most hosts do).

### 2. YouTube OAuth + Resumable Setup

Use n8n’s **YouTube** node to:

1. **Authenticate** with OAuth2 (YouTube Data API v3).
2. **Create resumable session**: Use a custom HTTP Request or a setup step that:
   - Sends `POST` to `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`
   - Headers: `Authorization: Bearer {{ $json.accessToken }}`, `Content-Type: application/json`
   - Body: your video metadata (snippet, status)
   - Reads `Location` from the response headers → this is your `uploadUrl`

If you use a different node structure, ensure you end up with:
- `uploadUrl` (resumable session URL from `Location` header)
- `oauthToken` (valid access token)

### 3. Call the Upload API

Add an **HTTP Request** node:

- **Method**: POST
- **URL**: `https://YOUR-APP.railway.app/upload`
- **Authentication**: **None** — do not use OAuth here. The YouTube token goes in the JSON body as `oauthToken`.
- **Headers**: `Content-Type: application/json` (usually set automatically when you choose JSON body)
- **Body Content Type**: JSON
- **Specify Body**: Using JSON
- **JSON**:
```json
{
  "videoUrl": "{{ $json.videoUrl }}",
  "uploadUrl": "{{ $('YouTube Setup').item.json.headers.location }}",
  "oauthToken": "{{ $('YouTube OAuth').item.json.accessToken }}",
  "contentType": "video/webm",
  "sync": false
}
```

Adjust node names (`YouTube Setup`, `YouTube OAuth`) to match your workflow.

**Where does `oauthToken` come from?** Use an expression that returns the YouTube access token, e.g.:
- `{{ $('YouTube OAuth').item.json.accessToken }}` — from a YouTube OAuth node
- `{{ $credentials.youtubeOAuth2.oauthTokenData.access_token }}` — from n8n credential (name may vary)

### 4. Async: Poll for Completion

If `sync` is `false` (recommended for large files):

1. The API returns `jobId` immediately.
2. Add a **Wait** node (e.g. 60 seconds).
3. Add an **HTTP Request** node: `GET https://YOUR-APP.railway.app/job/{{ $json.jobId }}`
4. Add an **IF** node: `{{ $json.status }}` equals `completed`
   - **True** → use `$json.result.videoId`
   - **False** → loop back to the Wait node (or add more logic for `failed`)

### 5. Sync Mode (Smaller Files Only)

For smaller videos you can use `sync: true` and get the result in one request:

```json
{
  "videoUrl": "...",
  "uploadUrl": "...",
  "oauthToken": "...",
  "sync": true
}
```

The node will block until the upload finishes. Avoid for very large files to prevent n8n timeouts.

## Example Expression Reference

| Data | Expression |
|------|------------|
| Resumable URL from setup | `{{ $json.headers.location }}` |
| OAuth token | `{{ $credentials.youtubeOAuth2.accessToken }}` or from previous node |
| Video URL from previous step | `{{ $('Get Video URL').item.json.url }}` |
| Job status URL | `https://YOUR-APP.railway.app/job/{{ $json.jobId }}` |

## Error Handling

- **400**: Missing `videoUrl`, `uploadUrl`, or `oauthToken` – check your expressions.
- **500**: Upload failed – inspect `GET /job/:id` for `error.message`.
- **Source no Content-Length**: Pass `contentLength` in the body if you know the file size.

## Content Types

Supported `contentType` values include:
- `video/webm`
- `video/mp4`
- `video/quicktime`
- Any valid video MIME type

Use the correct type for your video format.
