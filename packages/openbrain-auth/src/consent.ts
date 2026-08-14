import { byId, setBusy, setNotice } from "./lib/dom";
import { buildLoginUrl, getAuthorizationId, getCurrentRelativeUrl, redirectTo } from "./lib/routes";
import { getActiveUser, getSupabaseBrowserClient } from "./lib/supabase";

type AuthorizationDetails = {
  client_name?: string;
  redirect_uri?: string;
  scopes?: string[];
  redirect_url?: string;
  client?: {
    client_name?: string;
    redirect_uris?: string[];
  };
};

type AuthorizationResponse = {
  redirect_url?: string;
};

const message = byId<HTMLElement>("consent-message");
const loadingPanel = byId<HTMLElement>("loading-panel");
const consentPanel = byId<HTMLElement>("consent-panel");
const clientName = byId<HTMLElement>("client-name");
const redirectUri = byId<HTMLElement>("redirect-uri");
const authorizationIdField = byId<HTMLElement>("authorization-id");
const signedInEmail = byId<HTMLElement>("signed-in-email");
const scopeList = byId<HTMLUListElement>("scope-list");
const approveButton = byId<HTMLButtonElement>("approve-button");
const denyButton = byId<HTMLButtonElement>("deny-button");

const authorizationId = getAuthorizationId();
const supabase = getSupabaseBrowserClient();

function showError(text: string): void {
  loadingPanel.hidden = true;
  consentPanel.hidden = true;
  setNotice(message, text, "error");
}

function extractDetails(payload: unknown): AuthorizationDetails {
  const record = (payload ?? {}) as Record<string, unknown>;
  const inner = record.authorization && typeof record.authorization === "object"
    ? record.authorization as Record<string, unknown>
    : record;

  const client = inner.client && typeof inner.client === "object"
    ? inner.client as Record<string, unknown>
    : undefined;

  const scopes = inner.scopes && Array.isArray(inner.scopes)
    ? inner.scopes.filter((value): value is string => typeof value === "string")
    : typeof inner.scope === "string"
    ? inner.scope.split(/\s+/).filter(Boolean)
    : inner.requested_scopes && Array.isArray(inner.requested_scopes)
    ? inner.requested_scopes.filter((value): value is string => typeof value === "string")
    : [];

  const redirectUris = client?.redirect_uris && Array.isArray(client.redirect_uris)
    ? client.redirect_uris.filter((value): value is string => typeof value === "string")
    : [];

  return {
    client_name: typeof inner.client_name === "string" ? inner.client_name : undefined,
    redirect_uri: typeof inner.redirect_uri === "string" ? inner.redirect_uri : undefined,
    redirect_url: typeof inner.redirect_url === "string" ? inner.redirect_url : undefined,
    scopes,
    client: {
      client_name: typeof client?.client_name === "string" ? client.client_name : undefined,
      redirect_uris: redirectUris,
    },
  };
}

function extractRedirect(payload: unknown): string | null {
  const record = (payload ?? {}) as Record<string, unknown>;
  if (typeof record.redirect_url === "string") {
    return record.redirect_url;
  }

  const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null;
  if (nested && typeof nested.redirect_url === "string") {
    return nested.redirect_url;
  }

  return null;
}

function renderDetails(details: AuthorizationDetails, email: string | null): void {
  const scopes = details.scopes && details.scopes.length > 0 ? details.scopes : ["openid"];
  const resolvedClientName = details.client?.client_name ?? details.client_name ?? "Unknown application";
  const resolvedRedirectUri = details.redirect_uri ?? details.client?.redirect_uris?.[0] ?? "Unavailable";

  clientName.textContent = resolvedClientName;
  redirectUri.textContent = resolvedRedirectUri;
  authorizationIdField.textContent = authorizationId ?? "Unavailable";
  signedInEmail.textContent = email ?? "Signed in user";
  scopeList.replaceChildren(...scopes.map((scope) => {
    const item = document.createElement("li");
    item.textContent = scope;
    return item;
  }));

  loadingPanel.hidden = true;
  consentPanel.hidden = false;
}

async function requireUser(): Promise<string | null> {
  const user = await getActiveUser();
  if (!user) {
    redirectTo(buildLoginUrl(getCurrentRelativeUrl()));
    return null;
  }

  return user.email ?? null;
}

async function handleDecision(decision: "approve" | "deny"): Promise<void> {
  if (!authorizationId) {
    showError("Missing authorization_id in the consent URL.");
    return;
  }

  clearButtons(true);
  setNotice(message, decision === "approve" ? "Approving access..." : "Denying access...");

  try {
    const response = decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });

    if (response.error) {
      throw response.error;
    }

    const redirectTarget = extractRedirect(response.data as AuthorizationResponse | undefined);
    if (!redirectTarget) {
      throw new Error("Supabase did not return a redirect target.");
    }

    window.location.assign(redirectTarget);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unable to complete the authorization request.";
    showError(errorMessage);
  } finally {
    clearButtons(false);
  }
}

function clearButtons(isBusy: boolean): void {
  setBusy(approveButton, isBusy, "Approve access", "Approving...");
  denyButton.disabled = isBusy;
}

approveButton.addEventListener("click", () => {
  void handleDecision("approve");
});

denyButton.addEventListener("click", () => {
  void handleDecision("deny");
});

async function init(): Promise<void> {
  if (!authorizationId) {
    showError("Missing authorization_id in the consent URL.");
    return;
  }

  try {
    const email = await requireUser();
    if (email === null) {
      return;
    }

    const response = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    if (response.error) {
      throw response.error;
    }

    const details = extractDetails(response.data);
    if (details.redirect_url) {
      window.location.assign(details.redirect_url);
      return;
    }

    renderDetails(details, email);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unable to load the authorization request.";
    showError(errorMessage);
  }
}

void init();
