/**
 * YouTube Upload API Server
 *
 * Handles large video uploads to YouTube by:
 * 1. Downloading from a source URL using streams (memory-efficient)
 * 2. Streaming directly to YouTube's resumable upload endpoint
 * 3. Running uploads asynchronously with job tracking
 */

const express = require('express');
const { pipeline } = require('stream');
const { promisify } = require('util');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const pipelineAsync = promisify(pipeline);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory job store (use Redis/database in production for persistence)
const jobs = new Map();

// Parse JSON bodies (for metadata - actual video is streamed from URL)
app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /job/:id - Poll upload job status
 */
app.get('/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found', jobId: req.params.id });
  }
  res.json(job);
});

/**
 * POST /upload - Initiate YouTube video upload
 *
 * Body:
 *   - videoUrl: URL to download the video from
 *   - uploadUrl: YouTube resumable upload URL (from setup node's json.headers.location)
 *   - oauthToken: YouTube OAuth 2.0 access token
 *   - videoMetadata: Optional snippet/status metadata (for logging)
 *   - contentLength: Optional - if known, avoids HEAD request
 *   - contentType: Optional - defaults to 'video/webm'
 *   - sync: Optional - if true, wait for upload to complete before responding
 */
app.post('/upload', async (req, res) => {
  const { videoUrl, uploadUrl, oauthToken, videoMetadata, contentLength, contentType = 'video/webm', sync = false } = req.body;

  if (!videoUrl || !uploadUrl || !oauthToken) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['videoUrl', 'uploadUrl', 'oauthToken'],
    });
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const job = {
    id: jobId,
    status: 'pending',
    createdAt: new Date().toISOString(),
    videoUrl,
    videoMetadata: videoMetadata || null,
    result: null,
    error: null,
  };

  jobs.set(jobId, job);

  const runUpload = async () => {
    job.status = 'downloading';

    try {
      // Resolve content length: use provided value, or fetch via HEAD
      let resolvedContentLength = contentLength;
      if (resolvedContentLength == null) {
        resolvedContentLength = await getContentLength(videoUrl);
      }

      job.status = 'uploading';

      const result = await streamVideoToYouTube({
        videoUrl,
        uploadUrl,
        oauthToken,
        contentType,
        contentLength: resolvedContentLength,
      });

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.result = result;
    } catch (err) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      job.error = {
        message: err.message,
        code: err.code,
      };
      console.error(`[${jobId}] Upload failed:`, err);
    }
  };

  if (sync) {
    // Synchronous mode: wait for upload, then respond
    runUpload()
      .then(() => {
        if (job.status === 'completed') {
          res.status(201).json(job);
        } else {
          res.status(500).json(job);
        }
      })
      .catch((err) => {
        job.status = 'failed';
        job.error = { message: err.message };
        res.status(500).json(job);
      });
  } else {
    // Asynchronous mode: respond immediately with job ID
    res.status(202).json({
      jobId,
      status: 'accepted',
      message: 'Upload started. Poll GET /job/:id for status.',
      pollUrl: `/job/${jobId}`,
    });

    runUpload().catch((err) => {
      console.error(`[${jobId}] Background upload error:`, err);
    });
  }
});

/**
 * Fetch Content-Length from source URL via HEAD request.
 * YouTube's resumable upload expects Content-Length for the PUT.
 */
async function getContentLength(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(url, { method: 'HEAD' }, (res) => {
      const len = res.headers['content-length'];
      if (len != null) {
        resolve(parseInt(len, 10));
      } else {
        reject(new Error('Source URL does not provide Content-Length. Pass contentLength in the request body.'));
      }
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('HEAD request timeout'));
    });
    req.end();
  });
}

/**
 * Stream video from source URL to YouTube resumable upload URL.
 * Uses Node.js streams to avoid loading the entire file into memory.
 */
async function streamVideoToYouTube({ videoUrl, uploadUrl, oauthToken, contentType, contentLength }) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await attemptStreamUpload({ videoUrl, uploadUrl, oauthToken, contentType, contentLength });
      return result;
    } catch (err) {
      lastError = err;
      const isRetryable = err.statusCode >= 500 || err.statusCode === 308 || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT';
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.warn(`Upload attempt ${attempt} failed, retrying in ${delay}ms:`, err.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * Single attempt: download from videoUrl and PUT to uploadUrl.
 */
async function attemptStreamUpload({ videoUrl, uploadUrl, oauthToken, contentType, contentLength }) {
  return new Promise((resolve, reject) => {
    const parsedSource = new URL(videoUrl);
    const httpModule = parsedSource.protocol === 'https:' ? https : http;

    // Initiate download stream
    const getReq = httpModule.get(videoUrl, (getRes) => {
      if (getRes.statusCode >= 400) {
        reject(new Error(`Failed to download video: HTTP ${getRes.statusCode}`));
        return;
      }

      const uploadOptions = {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${oauthToken}`,
          'Content-Type': contentType,
          'Content-Length': contentLength,
        },
      };

      const uploadParsed = new URL(uploadUrl);
      const uploadModule = uploadParsed.protocol === 'https:' ? https : http;

      const putReq = uploadModule.request(uploadUrl, uploadOptions, (putRes) => {
        let body = '';
        putRes.on('data', (chunk) => { body += chunk; });
        putRes.on('end', () => {
          if (putRes.statusCode === 201) {
            let videoId = null;
            try {
              const json = JSON.parse(body);
              videoId = json.id || null;
            } catch (_) {}

            resolve({
              statusCode: 201,
              videoId,
              rawResponse: body.length > 0 ? body : undefined,
            });
          } else if (putRes.statusCode === 308) {
            // Resume incomplete - for full-file upload we don't resume chunks, retry whole upload
            const err = new Error('Upload incomplete (308), will retry');
            err.statusCode = 308;
            reject(err);
          } else {
            const err = new Error(`YouTube upload failed: HTTP ${putRes.statusCode} - ${body}`);
            err.statusCode = putRes.statusCode;
            err.body = body;
            reject(err);
          }
        });
      });

      putReq.on('error', (err) => {
        reject(err);
      });

      // Pipe download stream directly to upload (no buffering)
      pipelineAsync(getRes, putReq).catch(reject);
    });

    getReq.on('error', (err) => {
      reject(err);
    });

    getReq.setTimeout(60000, () => {
      getReq.destroy(new Error('Download timeout'));
    });
  });
}

// Clean up old jobs periodically (keep last 100)
setInterval(() => {
  if (jobs.size > 100) {
    const entries = [...jobs.entries()].sort((a, b) => new Date(a[1].createdAt) - new Date(b[1].createdAt));
    const toDelete = entries.slice(0, entries.length - 100);
    toDelete.forEach(([id]) => jobs.delete(id));
  }
}, 60000);

app.listen(PORT, () => {
  console.log(`YouTube Upload API listening on port ${PORT}`);
  console.log(`Health: GET /health`);
  console.log(`Upload: POST /upload`);
  console.log(`Status: GET /job/:id`);
});
