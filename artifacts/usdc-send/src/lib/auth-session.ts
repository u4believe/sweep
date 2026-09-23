import type { QueryClient } from "@tanstack/react-query";

// Where a pending "Google sign-in → authenticator code" challenge waits while the
// user is sent to the login page to enter their code.
export const TWO_FACTOR_CHALLENGE_KEY = "sweep.2faChallenge";

/** Stores the session token and leaves the auth page (honouring ?next=). */
export function finishSignIn(token: string, queryClient: QueryClient) {
  localStorage.setItem("token", token);
  try { sessionStorage.removeItem(TWO_FACTOR_CHALLENGE_KEY); } catch { /* storage unavailable */ }
  queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.href = next?.startsWith("/") && !next.startsWith("//") ? base + next : base || "/";
}
