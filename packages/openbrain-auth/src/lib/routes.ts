const DEFAULT_NEXT_PATH = "/oauth/consent";

export function getCurrentUrl(): URL {
  return new URL(window.location.href);
}

export function getCurrentRelativeUrl(): string {
  const url = getCurrentUrl();
  return `${url.pathname}${url.search}${url.hash}`;
}

export function normalizeNext(raw: string | null | undefined): string {
  if (!raw) {
    return DEFAULT_NEXT_PATH;
  }

  try {
    if (raw.startsWith("//") || raw.startsWith("\\")) {
      return DEFAULT_NEXT_PATH;
    }

    if (raw.startsWith("/")) {
      if (raw.includes("\\")) {
        return DEFAULT_NEXT_PATH;
      }

      return raw;
    }

    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return DEFAULT_NEXT_PATH;
    }

    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.includes("\\")) {
      return DEFAULT_NEXT_PATH;
    }

    return normalized;
  } catch {
    return DEFAULT_NEXT_PATH;
  }
}

export function getNextFromSearch(): string {
  return normalizeNext(getCurrentUrl().searchParams.get("next"));
}

export function buildLoginUrl(next: string): string {
  const login = new URL("/login", window.location.origin);
  login.searchParams.set("next", normalizeNext(next));
  return `${login.pathname}${login.search}`;
}

export function buildLoginRedirectTarget(next: string): string {
  const login = new URL("/login", window.location.origin);
  login.searchParams.set("next", normalizeNext(next));
  return login.toString();
}

export function redirectTo(path: string): void {
  window.location.assign(normalizeNext(path));
}

export function replaceUrl(path: string): void {
  window.history.replaceState({}, "", normalizeNext(path));
}

export function getAuthorizationId(): string | null {
  return getCurrentUrl().searchParams.get("authorization_id");
}
