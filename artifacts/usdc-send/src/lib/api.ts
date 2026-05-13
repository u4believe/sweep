// Base URL for all API fetch calls.
// In production this is the Railway server URL (set via VITE_API_URL).
// In development it's empty string so calls go to the same origin (Vite proxy).
export const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");