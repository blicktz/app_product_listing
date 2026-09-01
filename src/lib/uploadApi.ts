const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL;
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN;

async function callWorker<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!WORKER_URL || !APP_TOKEN) {
    throw new Error('Missing EXPO_PUBLIC_WORKER_URL or EXPO_PUBLIC_APP_TOKEN configuration.');
  }

  const response = await fetch(`${WORKER_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${APP_TOKEN}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${detail}`);
  }

  return response.json();
}

export type CheckSkuResult = {
  count: number;
  nextNumber: number;
};

export function checkSku(date: string, sku: string): Promise<CheckSkuResult> {
  const params = new URLSearchParams({ date, sku });
  return callWorker<CheckSkuResult>(`/check-sku?${params.toString()}`);
}

export function getRemoteTriggerSocketUrl(): string {
  if (!WORKER_URL || !APP_TOKEN) {
    throw new Error('Missing EXPO_PUBLIC_WORKER_URL or EXPO_PUBLIC_APP_TOKEN configuration.');
  }
  const wsUrl = WORKER_URL.replace(/^http/, 'ws');
  return `${wsUrl}/remote-trigger/ws?token=${encodeURIComponent(APP_TOKEN)}`;
}

export type PresignUploadResult = {
  uploadUrls: Record<string, string>;
};

export function presignUpload(
  date: string,
  sku: string,
  filenames: string[]
): Promise<PresignUploadResult> {
  return callWorker<PresignUploadResult>('/presign-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, sku, filenames }),
  });
}
