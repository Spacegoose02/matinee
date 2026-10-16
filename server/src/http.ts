// Small fetch wrapper shared by every service adapter.
export class ServiceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 45_000;

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);
}

/** First chunk of an error response, flattened to one line, so failures say what the server said. */
async function bodySnippet(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  // The *arrs report validation problems as [{ errorMessage }]; show those instead of raw JSON.
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const messages = list.map((e) => e?.errorMessage ?? e?.message).filter((m) => typeof m === "string");
    if (messages.length) return `: ${messages.join("; ").slice(0, 240)}`;
  } catch {
    // Not JSON: fall through to the plain-text snippet.
  }
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text ? `: ${text.slice(0, 160)}` : "";
}

export async function fetchChecked(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ServiceError(`${new URL(url).host} did not answer within ${timeoutMs / 1000}s — it may be busy (scanning?), very large, or the address is wrong`);
    }
    const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
    throw new ServiceError(`Could not reach ${new URL(url).host}: ${reason}`);
  }
  if (!res.ok) {
    throw new ServiceError(`${res.status} ${res.statusText} from ${new URL(url).host}${await bodySnippet(res)}`, res.status);
  }
  return res;
}

export async function request<T>(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<{ data: T; res: Response }> {
  const res = await fetchChecked(url, init, timeoutMs);
  const text = await res.text();
  try {
    return { data: (text ? JSON.parse(text) : null) as T, res };
  } catch {
    throw new ServiceError(
      `${new URL(url).host} answered, but not with JSON — is the URL pointing at the right app and port? (${text.slice(0, 60).replace(/\s+/g, " ")})`,
    );
  }
}

export async function getJson<T>(url: string, headers: Record<string, string> = {}, timeoutMs?: number): Promise<T> {
  return (await request<T>(url, { headers: { Accept: "application/json", ...headers } }, timeoutMs)).data;
}

export async function putJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return (
    await request<T>(url, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    })
  ).data;
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}, timeoutMs?: number): Promise<T> {
  return (
    await request<T>(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }, timeoutMs)
  ).data;
}
