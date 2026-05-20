import express, { Request, Response } from 'express';
import { createClient } from 'redis';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { exec } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const RUNNER_TAG = process.env.RUNNER_TAG || 'latest';
const SANDBOX_DIR = process.env.SANDBOX_DIR || '/tmp/sandbox';
const HOST_SANDBOX_DIR = process.env.HOST_SANDBOX_DIR || '/tmp/sandbox';

app.use(express.json());
app.use(express.static('public')); // Serve the web playground

// Initialize Redis client
const redisClient = createClient({ url: REDIS_URL });
let redisReady = false;

redisClient.on('error', (err) => {
  console.warn('[-] Redis Client Error:', err.message || err);
  redisReady = false;
});

redisClient.on('connect', () => {
  console.log('[+] Redis Client Connecting...');
});

redisClient.on('ready', () => {
  console.log('[+] Redis Client Ready');
  redisReady = true;
});

// Connect to Redis (non-blocking)
redisClient.connect().catch((err) => {
  console.warn('[-] Failed to connect to Redis. Execution caching will be disabled.', err.message || err);
});

// Ensure temp directory exists
if (!fs.existsSync(SANDBOX_DIR)) {
  fs.mkdirSync(SANDBOX_DIR, { recursive: true });
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
  durationMs: number;
  cached: boolean;
}

app.post('/execute', async (req: Request, res: Response) => {
  const { language, code } = req.body;

  if (!language || typeof code !== 'string') {
    return res.status(400).json({ error: 'Invalid payload: language and code are required.' });
  }

  const lang = language.toLowerCase();
  let fileExt = '';
  let runnerImage = '';
  let runnerCmd = '';

  if (lang === 'python' || lang === 'py') {
    fileExt = 'py';
    runnerImage = `python-runner:${RUNNER_TAG}`;
    runnerCmd = 'python3';
  } else if (lang === 'javascript' || lang === 'js' || lang === 'nodejs') {
    fileExt = 'js';
    runnerImage = `node-runner:${RUNNER_TAG}`;
    runnerCmd = 'node';
  } else {
    return res.status(400).json({ error: 'Unsupported language. Supported: python, javascript' });
  }

  // Create hash for caching
  const cacheKey = `exec:${crypto.createHash('sha256').update(`${lang}:${code}`).digest('hex')}`;

  // Check Redis Cache
  if (redisReady) {
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const result = JSON.parse(cachedData) as ExecutionResult;
        result.cached = true;
        return res.json(result);
      }
    } catch (err) {
      console.error('[-] Redis get error:', err);
    }
  }

  // Create temporary code file
  const fileId = crypto.randomUUID();
  const fileName = `sandbox_${fileId}.${fileExt}`;
  const containerFilePath = path.join(SANDBOX_DIR, fileName);

  try {
    // Write code to temp file inside container path
    fs.writeFileSync(containerFilePath, code, 'utf-8');
  } catch (err: any) {
    console.error('[-] Failed to write temp file:', err);
    return res.status(500).json({ error: `Internal Server Error: Failed to write script file. ${err.message}` });
  }

  const startTime = process.hrtime();

  // Run in sandboxed container
  // --rm: remove container on exit
  // --memory=256m: limit memory usage
  // --cpus=0.5: limit CPU usage
  // -v: mount host temp path to container read-only
  const dockerCmd = `docker run --rm --memory=256m --cpus=0.5 -v "${HOST_SANDBOX_DIR}:/tmp/sandbox:ro" "${runnerImage}" "${runnerCmd}" "/tmp/sandbox/${fileName}"`;

  exec(dockerCmd, { timeout: 10000 }, async (error, stdout, stderr) => {
    // Calculate elapsed time
    const diff = process.hrtime(startTime);
    const durationMs = Math.round((diff[0] * 1e9 + diff[1]) / 1e6);

    // Delete temp file asynchronously
    fs.unlink(containerFilePath, (unlinkErr) => {
      if (unlinkErr) console.warn('[-] Failed to delete temp file:', containerFilePath, unlinkErr);
    });

    let exitCode: number | null = 0;
    let errMessage = '';

    if (error) {
      exitCode = error.code !== undefined ? error.code : 1;
      if (error.killed) {
        errMessage = 'Execution timed out (limit: 10s)';
        exitCode = 124; // standard timeout code
      } else {
        errMessage = error.message;
      }
    }

    const executionResult: ExecutionResult = {
      stdout,
      stderr: errMessage ? `${stderr}\n[Runner Error]: ${errMessage}`.trim() : stderr,
      exitCode,
      durationMs,
      cached: false
    };

    // Cache the result in Redis for 1 hour (3600 seconds)
    if (redisReady) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(executionResult), {
          EX: 3600
        });
      } catch (err) {
        console.error('[-] Redis set error:', err);
      }
    }

    return res.json(executionResult);
  });
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'UP',
    redis: redisReady ? 'connected' : 'disconnected',
    runnerTag: RUNNER_TAG
  });
});

app.listen(PORT, () => {
  console.log(`[+] API Service running on port ${PORT}`);
  console.log(`[+] Sandbox Host Path: ${HOST_SANDBOX_DIR}`);
  console.log(`[+] Sandbox Container Path: ${SANDBOX_DIR}`);
  console.log(`[+] Runner Image Tag: ${RUNNER_TAG}`);
});
