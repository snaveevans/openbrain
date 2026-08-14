import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { byId, clearNotice, setBusy, setNotice } from "./lib/dom";
import { buildLoginRedirectTarget, getNextFromSearch, redirectTo } from "./lib/routes";
import { getActiveSession, getSupabaseBrowserClient } from "./lib/supabase";

const message = byId<HTMLElement>("auth-message");
const sessionPanel = byId<HTMLElement>("session-panel");
const sessionCopy = byId<HTMLElement>("session-copy");
const continueLink = byId<HTMLAnchorElement>("continue-link");
const signOutButton = byId<HTMLButtonElement>("sign-out-button");
const form = byId<HTMLFormElement>("login-form");
const emailInput = byId<HTMLInputElement>("email");
const submitButton = byId<HTMLButtonElement>("submit-button");

const nextPath = getNextFromSearch();
const supabase = getSupabaseBrowserClient();

function showSignedIn(email: string | null): void {
  sessionPanel.hidden = false;
  form.hidden = true;
  continueLink.href = nextPath;
  sessionCopy.textContent = email
    ? `Signed in as ${email}. Continue back to the authorization request.`
    : "Your session is active. Continue back to the authorization request.";
}

function showSignedOut(): void {
  sessionPanel.hidden = true;
  form.hidden = false;
  continueLink.href = nextPath;
}

async function refreshState(): Promise<void> {
  const session = await getActiveSession();
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const hashError = hashParams.get("error_description") ?? hashParams.get("error");

  if (hashError) {
    setNotice(message, hashError, "error");
  } else {
    clearNotice(message);
  }

  if (!session) {
    showSignedOut();
    return;
  }

  window.history.replaceState({}, "", window.location.pathname + window.location.search);
  showSignedIn(session.user.email ?? null);
  if (nextPath !== "/login") {
    redirectTo(nextPath);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotice(message);
  setBusy(submitButton, true, "Send magic link", "Sending link...");

  try {
    const email = emailInput.value.trim();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: buildLoginRedirectTarget(nextPath),
        shouldCreateUser: false,
      },
    });

    if (error) {
      throw error;
    }

    setNotice(message, `Magic link sent to ${email}. Open it in this browser to continue.`, "success");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unable to send magic link.";
    setNotice(message, errorMessage, "error");
  } finally {
    setBusy(submitButton, false, "Send magic link", "Sending link...");
  }
});

signOutButton.addEventListener("click", async () => {
  clearNotice(message);
  signOutButton.disabled = true;

  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw error;
    }

    showSignedOut();
    setNotice(message, "Signed out. You can request a new magic link below.", "success");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unable to sign out.";
    setNotice(message, errorMessage, "error");
  } finally {
    signOutButton.disabled = false;
  }
});

supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
  if (event === "SIGNED_IN" && session) {
    showSignedIn(session.user.email ?? null);
    redirectTo(nextPath);
  }

  if (event === "SIGNED_OUT") {
    showSignedOut();
  }
});

void refreshState();
