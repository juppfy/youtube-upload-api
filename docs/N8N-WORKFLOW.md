# n8n Workflow Guide

This guide explains how to replace the native YouTube upload node in n8n with this API to avoid crashes on large video uploads.

---

## Easiest: In-App OAuth (Recommended)

No Playground, no tokens in n8n, no Code node. Do a one-time setup in a browser, then n8n only sends `videoUrl` and `videoMetadata`.

### 1. Deploy the API (e.g. Railway)

### 2. Set Environment Variables

| Variable | Value |
|----------|-------|
| `BASE_URL` | Your app URL, e.g. `https://youtube-upload-xxx.railway.app` |
| `YOUTUBE_CLIENT_ID` | Your Google OAuth Client ID |
| `YOUTUBE_CLIENT_SECRET` | Your Google OAuth Client Secret |

### 3. Add Redirect URI in Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Edit your OAuth 2.0 Client (Web application)
3. Under **Authorized redirect URIs**, add:
   ```
   https://your-app.railway.app/auth/youtube/callback
   ```
   (Use your real `BASE_URL` + `/auth/youtube/callback`)
4. Save

### 4. Connect YouTube (One-Time)

Open in a browser:
```
https://your-app.railway.app/auth/youtube
```

Sign in with Google and approve. The page will say "YouTube is now connected."

### 5. In n8n: HTTP Request Node

- **Method**: POST
- **URL**: `https://your-app.railway.app/upload`
- **Body** (JSON):

```json
{
  "videoUrl": "{{ $json.videoUrl }}",
  "videoMetadata": {
    "snippet": {
      "title": "My Video",
      "description": "Description here",
      "tags": ["tag1", "tag2"],
      "categoryId": "22"
    },
    "status": {
      "privacyStatus": "private"
    }
  },
  "contentType": "video/webm",
  "sync": false
}
```

No `oauthToken`, no `uploadUrl`, no `clientId`/`clientSecret`/`refreshToken`. The server uses the token you stored when you visited `/auth/youtube`.

---

## Other Auth Options

### Option A: Authorization Header (n8n OAuth2)

If your n8n HTTP Request node lets you use OAuth2 and add the token to requests to your API:

1. Set **Authentication** to **OAuth2 API** → select your YouTube/Google OAuth2 credential
2. n8n will add `Authorization: Bearer <token>` to the request
3. Our API reads the token from the header
4. You still need to pass `uploadUrl` (from a YouTube setup node) and `videoUrl` in the body

### Option B: Refresh Token in Body

Pass `clientId`, `clientSecret`, `refreshToken` in the JSON body. Get the refresh token from [OAuth Playground](https://developers.google.com/oauthplayground/) (add redirect URI `https://developers.google.com/oauthplayground` to your Google OAuth client).

---

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

---

## Alternative: Use Refresh Token (Recommended if Code Node Fails)

If `getCredentials` in the Code node doesn't work, use **clientId, clientSecret, and refreshToken** instead of `oauthToken`. The API will exchange the refresh token for an access token.

### Step 1: Get Your Refresh Token (One-Time)

1. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the gear icon (⚙️) → check **Use your own OAuth credentials**.
3. Enter your **Client ID** and **Client Secret** (same ones you use in n8n).
4. In the left panel, find **YouTube Data API v3** → expand it → select `https://www.googleapis.com/auth/youtube.upload` (and optionally `youtube` if you need other scopes).
5. Click **Authorize APIs** and sign in with your Google account.
6. Click **Exchange authorization code for tokens**.
7. Copy the **Refresh token** — you will use this in n8n. It does not expire unless you revoke it.

### Step 2: Store in n8n

Create **3 credentials** in n8n (or store the values in your workflow):

- **YouTube Client ID** (Generic Credential or use expressions)
- **YouTube Client Secret**
- **YouTube Refresh Token** (the one from the playground)

Or use a single credential with multiple fields if n8n supports it.

### Step 3: Use in HTTP Request Body

In your HTTP Request node that calls our API, use this JSON body instead:

```json
{
  "videoUrl": "{{ $json.videoUrl }}",
  "uploadUrl": "{{ $json.headers.location }}",
  "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "refreshToken": "YOUR_REFRESH_TOKEN_FROM_PLAYGROUND",
  "contentType": "video/webm",
  "sync": false
}
```

To use n8n credentials, reference them if your credential type supports it, or store the values in n8n's **Credentials** → create a "Generic Credential Type" with custom fields and reference those.

**Security:** Prefer storing secrets in n8n environment variables (Settings → Variables) and reference them: `{{ $env.YOUTUBE_CLIENT_ID }}`, `{{ $env.YOUTUBE_CLIENT_SECRET }}`, `{{ $env.YOUTUBE_REFRESH_TOKEN }}`. Or use a credential type that exposes these fields.

---

### Getting the Access Token (Code Node – Use if Refresh Token Method Not Preferred)

Your Client ID + Client Secret setup is OAuth2. When you click "Sign in", n8n stores the **access token** (and refresh token) inside the credential — but you can't reference it directly in expressions.

**Solution: Add a Code node** that reads the credential and outputs the token. Place it **before** your HTTP Request node that calls our API.

1. Add a **Code** node.
2. In the Code node, set **Mode** to "Run Once for All Items" (or "Run Once for Each Item" if you need it per-item).
3. In **Credentials** (if the Code node has a credentials dropdown), select your YouTube OAuth2 credential. If there is no dropdown, the credential must be used elsewhere in the workflow (e.g. by a YouTube node or HTTP Request node).
4. Paste this code (replace `'youTubeOAuth2Api'` with your credential type if different — check under **Credentials** → your YouTube credential → the type shown at the top):

```javascript
// Get the YouTube OAuth2 credential. The type is usually youTubeOAuth2Api or googleYouTubeOAuth2Api
const credTypes = ['youTubeOAuth2Api', 'googleYouTubeOAuth2Api', 'youtubeOAuth2'];
let creds = null;
let accessToken = null;

for (const type of credTypes) {
  try {
    creds = await this.getCredentials(type);
    if (creds) {
      accessToken = creds.oauthTokenData?.access_token ?? creds.access_token ?? creds.accessToken;
      if (accessToken) break;
    }
  } catch (e) {
    continue;
  }
}

if (!accessToken) {
  throw new Error('Could not get YouTube access token. Ensure a YouTube OAuth2 credential exists and is used in this workflow (e.g. by a YouTube node or HTTP Request with OAuth2).');
}

const items = $input.all();
if (items.length === 0) {
  return [{ json: { youtubeAccessToken: accessToken } }];
}
return items.map(item => ({
  json: {
    ...item.json,
    youtubeAccessToken: accessToken
  }
}));
```

5. In your HTTP Request body, use:
   ```json
   "oauthToken": "{{ $json.youtubeAccessToken }}"
   ```

**Tip:** The Code node can only read credentials that exist in the workflow. Add a YouTube node (e.g. "Get Channel" or your resumable-session HTTP Request) earlier in the workflow so the credential is loaded. Connect that node's output to the Code node so data (videoUrl, uploadUrl, etc.) flows through. The Code node will add `youtubeAccessToken` to each item.

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
| OAuth token | `{{ $json.youtubeAccessToken }}` (from Code node above — expressions like `$credentials...` do not work) |
| Video URL from previous step | `{{ $('Get Video URL').item.json.url }}` |
| Job status URL | `https://YOUR-APP.railway.app/job/{{ $json.jobId }}` |

## Error Handling

- **400**: Missing `videoUrl`, `uploadUrl`, or auth (provide `oauthToken` OR `clientId`+`clientSecret`+`refreshToken`).
- **500**: Upload failed – inspect `GET /job/:id` for `error.message`.
- **Source no Content-Length**: Pass `contentLength` in the body if you know the file size.

## Content Types

Supported `contentType` values include:
- `video/webm`
- `video/mp4`
- `video/quicktime`
- Any valid video MIME type

Use the correct type for your video format.
