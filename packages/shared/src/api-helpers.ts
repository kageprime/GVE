export const USE_DEV_MOCKS = (import.meta as any).env?.DEV && (import.meta as any).env?.VITE_USE_API_MOCK === "1";
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL ?? "";
const WS_BASE_URL = (import.meta as any).env?.VITE_WS_BASE_URL ?? "";

function inferRuntimeApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const hostname = window.location.hostname.toLowerCase();

  if (hostname === "app.dosco.live") {
    return "https://api.dosco.live";
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "";
  }

  return "";
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const runtimeApiBaseUrl = inferRuntimeApiBaseUrl();
  const effectiveApiBaseUrl = (API_BASE_URL || runtimeApiBaseUrl).replace(/\/$/, "");

  if (!effectiveApiBaseUrl) {
    return path;
  }

  return `${effectiveApiBaseUrl}${path}`;
}

export function resolveWebSocketUrl(path = "/ws"): string {
  if (WS_BASE_URL) {
    return `${WS_BASE_URL.replace(/\/$/, "")}${path}`;
  }

  const runtimeApiBaseUrl = inferRuntimeApiBaseUrl();
  if (runtimeApiBaseUrl) {
    const apiBaseUrl = new URL(runtimeApiBaseUrl);
    const protocol = apiBaseUrl.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${apiBaseUrl.host}${path}`;
  }

  return `ws://127.0.0.1:8000${path}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

let authTokenProvider: (() => Promise<string | null | undefined>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null | undefined>) {
  authTokenProvider = provider;
}

export function clearAuthTokenProvider() {
  authTokenProvider = null;
}

async function readApiError(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { message?: string; error?: string };
      return payload.message ?? payload.error ?? fallbackMessage;
    }

    const text = await response.text();
    return text.trim() || fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  fallbackMessage: string,
  retryCount = 2
): Promise<T> {
  let lastError: unknown = null;
  const requestUrl = resolveApiUrl(url);
  const initWithCredentials: RequestInit = {
    ...init,
    credentials: init.credentials ?? "include",
  };

  if (authTokenProvider) {
    try {
      const token = await authTokenProvider();
      if (token) {
        const headers = new Headers(initWithCredentials.headers ?? {});
        headers.set("Authorization", `Bearer ${token}`);
        initWithCredentials.headers = headers;
      }
    } catch {
      // ignore token retrieval errors; let the request proceed without a token
    }
  }

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(requestUrl, initWithCredentials);

      if (response.ok) {
        return (await response.json()) as T;
      }

      const retriable = response.status >= 500 && response.status < 600 && attempt < retryCount;
      if (!retriable) {
        throw new Error(await readApiError(response, fallbackMessage));
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      lastError = error;
      if (attempt >= retryCount) {
        break;
      }

      await sleep(120 * (attempt + 1));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(fallbackMessage);
}
