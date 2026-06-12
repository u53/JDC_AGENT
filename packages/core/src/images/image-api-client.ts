import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

export type OutputFormat = 'png' | 'jpeg' | 'webp';

export type ImageApiResult =
  | { type: 'base64'; base64: string }
  | { type: 'remote_url'; url: string; downloadError?: string };

export interface BuildImageRequestInput {
  prompt: string;
  size: string;
  quality: string;
  model: string;
  outputFormat: OutputFormat;
  compression: number;
  imageDataUrls?: string[];
}

export interface BuiltImageRequest {
  url: string;
  payload: Record<string, any>;
}

interface ImageApiResponse {
  data?: Array<Record<string, unknown>>;
}

export class ImageApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  buildRequest(input: BuildImageRequestInput): BuiltImageRequest {
    const imageDataUrls = input.imageDataUrls ?? [];
    const endpoint = imageDataUrls.length > 0 ? 'edits' : 'generations';
    const payload: Record<string, any> = {
      model: input.model,
      prompt: input.prompt,
      quality: input.quality,
      output_format: input.outputFormat,
    };

    if (input.size !== 'auto') {
      payload.size = input.size;
    }

    if (input.outputFormat === 'jpeg' || input.outputFormat === 'webp') {
      payload.output_compression = input.compression;
    }

    if (imageDataUrls.length > 0) {
      payload.images = imageDataUrls.map((imageUrl) => ({ image_url: imageUrl }));
    }

    return {
      url: `${this.baseUrl.replace(/\/$/, '')}/v1/images/${endpoint}`,
      payload,
    };
  }

  async generate(input: BuildImageRequestInput): Promise<ImageApiResult | null> {
    const request = this.buildRequest(input);
    let response: ImageHttpResponse;
    try {
      response = await postJson(request.url, this.apiKey, request.payload, 600_000);
    } catch (error) {
      throw new Error(describeImageApiError(error));
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`HTTP ${response.statusCode}: ${response.body.slice(0, 200)}`);
    }

    const data = JSON.parse(response.body) as ImageApiResponse;
    return resolveImageApiResult(data);
  }
}

interface ImageHttpResponse {
  statusCode: number;
  body: string;
}

function postJson(url: string, apiKey: string, payload: Record<string, any>, timeoutMs: number): Promise<ImageHttpResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = httpsRequest(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`request timeout after ${Math.round(timeoutMs / 1000)}s`));
    });
    request.on('error', reject);
    request.end(body);
  });
}

export async function resolveImageApiResult(
  payload: unknown,
  downloadBinaryFn: (url: string) => Promise<Buffer> = downloadBinary,
): Promise<ImageApiResult | null> {
  const result = extractImageApiResult(payload);
  if (!result) {
    return null;
  }

  if (result.type === 'base64') {
    return result;
  }

  try {
    const raw = await downloadBinaryFn(result.url);
    return { type: 'base64', base64: raw.toString('base64') };
  } catch (error) {
    return {
      ...result,
      downloadError: describeImageApiError(error),
    };
  }
}

export function extractImageApiResult(payload: unknown): ImageApiResult | null {
  if (payload === null || payload === undefined) {
    return null;
  }

  if (typeof payload === 'string') {
    return extractImageValue(payload);
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const result = extractImageApiResult(item);
      if (result) {
        return result;
      }
    }
    return null;
  }

  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>;

    for (const key of ['b64_json', 'b64', 'base64', 'image_base64']) {
      const result = extractImageValue(record[key]);
      if (result) {
        return result;
      }
    }

    for (const key of ['data', 'result', 'images', 'output']) {
      const result = extractImageApiResult(record[key]);
      if (result) {
        return result;
      }
    }

    for (const key of ['url', 'image_url']) {
      const result = extractImageValue(record[key], true);
      if (result) {
        return result;
      }
    }

    for (const value of Object.values(record)) {
      const result = extractImageApiResult(value);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

function extractImageValue(value: unknown, preferUrl = false): ImageApiResult | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (preferUrl && isHttpUrl(trimmed)) {
    return { type: 'remote_url', url: trimmed };
  }

  const base64 = normalizeBase64Value(trimmed);
  if (base64) {
    return { type: 'base64', base64 };
  }

  if (isHttpUrl(trimmed)) {
    return { type: 'remote_url', url: trimmed };
  }

  return null;
}

function normalizeBase64Value(value: string) {
  let candidate = value.trim();
  if (candidate.startsWith('data:') && candidate.includes('base64,')) {
    candidate = candidate.split('base64,', 2)[1];
  }

  const compact = candidate.replace(/\s+/g, '');
  if (!compact || compact.length % 4 !== 0) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return null;
  }

  return compact;
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function downloadBinary(url: string, timeoutMs = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const requestFactory = parsed.protocol === 'http:' ? httpRequest : httpsRequest;
    const request = requestFactory(
      parsed,
      {
        method: 'GET',
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`HTTP ${statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`request timeout after ${Math.round(timeoutMs / 1000)}s`));
    });
    request.on('error', reject);
    request.end();
  });
}

export function describeImageApiError(error: unknown) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const errorCode = (error as Error & { code?: string }).code;
  if (errorCode) {
    return `${error.message} (${errorCode})`;
  }

  const cause = (error as Error & { cause?: unknown }).cause;
  if (!cause || !(cause instanceof Error)) {
    return error.message;
  }

  const causeCode = (cause as Error & { code?: string }).code;
  const causeLabel = causeCode ? `${cause.name || 'Cause'} ${causeCode}` : cause.name || 'Cause';
  return `${error.message} (${causeLabel}: ${cause.message})`;
}
