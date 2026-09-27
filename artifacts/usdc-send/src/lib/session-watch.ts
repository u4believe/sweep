import { API_BASE } from "@/lib/api";

// When the server ends this device's session (the password was changed or reset
// somewhere else), drop the token and go to the login page. Watches every API
// response, so it catches the dashboard's background polling too.

let leaving = false;

export function watchForEndedSession() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await realFetch(input, init);
    if (res.status === 401 && !leaving && isOurApi(input) && localStorage.getItem("token")) {
      const body = await res.clone().json().catch(() => null);
      if (body?.code === "SESSION_ENDED") signOut("password");
      else if (body?.code === "SESSION_EXPIRED") signOut("expired");
    }
    return res;
  };
}

function isOurApi(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = API_BASE ? url.replace(API_BASE, "") : url.replace(window.location.origin, "");
  return path.startsWith("/api/");
}

function signOut(reason: "password" | "expired") {
  leaving = true;
  localStorage.removeItem("token");
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  window.location.replace(`${base}/login?signedOut=${reason}`);
}
