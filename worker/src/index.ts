import { AwsClient } from 'aws4fetch';
import { RemoteTriggerRoom, type RemoteTriggerAction } from './remoteTrigger';

export { RemoteTriggerRoom };

export interface Env {
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  APP_SHARED_TOKEN: string;
  REMOTE_TRIGGER: DurableObjectNamespace<RemoteTriggerRoom>;
}

const PRESIGNED_URL_EXPIRY_SECONDS = 300;
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const FILENAME_PATTERN = /^[A-Za-z0-9_-]+\.jpg$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isAuthorized(request: Request, env: Env): boolean {
  return request.headers.get('Authorization') === `Bearer ${env.APP_SHARED_TOKEN}`;
}

function getR2Client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
}

function bucketEndpoint(env: Env): string {
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`;
}

async function handleCheckSku(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? '';
  const sku = url.searchParams.get('sku') ?? '';

  if (!SEGMENT_PATTERN.test(date) || !SEGMENT_PATTERN.test(sku)) {
    return jsonResponse({ error: 'Missing or invalid date/sku' }, 400);
  }

  const prefix = `${date}/${sku}/`;
  const client = getR2Client(env);
  const listUrl = `${bucketEndpoint(env)}?list-type=2&prefix=${encodeURIComponent(prefix)}`;

  const response = await client.fetch(listUrl, { method: 'GET' });
  if (!response.ok) {
    const detail = await response.text();
    return jsonResponse({ error: 'Failed to list existing files', detail }, 502);
  }

  const xml = await response.text();
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => match[1]);

  const numberPattern = new RegExp(`^${sku}_(\\d+)\\.jpg$`, 'i');
  let maxNumber = 0;
  for (const key of keys) {
    const filename = key.slice(prefix.length);
    const match = filename.match(numberPattern);
    if (match) {
      maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
    }
  }

  return jsonResponse({ count: keys.length, nextNumber: maxNumber + 1 });
}

async function handlePresignUpload(request: Request, env: Env): Promise<Response> {
  let body: { date?: string; sku?: string; filenames?: string[] };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const date = body.date ?? '';
  const sku = body.sku ?? '';
  const filenames = Array.isArray(body.filenames) ? body.filenames : [];

  if (!SEGMENT_PATTERN.test(date) || !SEGMENT_PATTERN.test(sku) || filenames.length === 0) {
    return jsonResponse({ error: 'Missing or invalid date, sku, or filenames' }, 400);
  }

  for (const filename of filenames) {
    if (typeof filename !== 'string' || !FILENAME_PATTERN.test(filename)) {
      return jsonResponse({ error: `Invalid filename: ${filename}` }, 400);
    }
  }

  const client = getR2Client(env);
  const uploadUrls: Record<string, string> = {};

  for (const filename of filenames) {
    const key = `${date}/${sku}/${filename}`;
    const objectUrl = `${bucketEndpoint(env)}/${key}?X-Amz-Expires=${PRESIGNED_URL_EXPIRY_SECONDS}`;
    const signedRequest = await client.sign(objectUrl, {
      method: 'PUT',
      aws: { signQuery: true },
    });
    uploadUrls[filename] = signedRequest.url;
  }

  return jsonResponse({ uploadUrls });
}

function remoteTriggerStub(env: Env) {
  return env.REMOTE_TRIGGER.getByName('default');
}

async function handleRemoteTriggerSocket(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get('token') !== env.APP_SHARED_TOKEN) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  return remoteTriggerStub(env).fetch(request);
}

async function handleRemoteTriggerPost(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ action?: string }>().catch(() => null);
  if (body?.action !== 'capture' && body?.action !== 'done') {
    return jsonResponse({ error: 'action must be "capture" or "done"' }, 400);
  }

  await remoteTriggerStub(env).broadcast(body.action as RemoteTriggerAction);
  return jsonResponse({ ok: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Auth is checked per-route below: the WebSocket upgrade can't carry a
    // custom Authorization header from React Native, so it's authorized via
    // a query param instead, inside handleRemoteTriggerSocket.
    if (request.method === 'GET' && url.pathname === '/remote-trigger/ws') {
      return handleRemoteTriggerSocket(request, env);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (request.method === 'GET' && url.pathname === '/check-sku') {
      return handleCheckSku(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/presign-upload') {
      return handlePresignUpload(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/remote-trigger') {
      return handleRemoteTriggerPost(request, env);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
