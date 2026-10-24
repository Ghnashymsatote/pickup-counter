/**
 * One place where the API lives and where an error response becomes a usable
 * Error. The backend answers failures as { error, message }, so the message
 * shown on screen is the one the server wrote.
 */
export const API_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:5001";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type ErrorBody = {
  error?: string;
  message?: string;
};

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      headers:
        init?.body === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    // fetch only rejects when the request never reached the server.
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Cannot reach the counter. Check your connection and try again.",
    );
  }

  const text = await response.text();
  let body: unknown = undefined;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!response.ok) {
    const errorBody = (body ?? {}) as ErrorBody;

    throw new ApiError(
      response.status,
      errorBody.error ?? "UNKNOWN_ERROR",
      errorBody.message ?? `Request failed (HTTP ${response.status}).`,
      (body ?? {}) as Record<string, unknown>,
    );
  }

  return body as T;
}
