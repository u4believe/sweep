import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router, { v1Router } from "./routes";
import { logger } from "./lib/logger";
import { threatMiddleware } from "./lib/threatMonitor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

// Trust the first proxy (Cloudflare / Railway ingress) so req.ip and
// rate-limiters see the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

// ─── HTTP → HTTPS redirect ────────────────────────────────────────────────────
// In production, redirect any plain HTTP request to HTTPS.
// Works with Cloudflare and Railway which forward the original protocol in
// X-Forwarded-Proto (Express exposes it as req.protocol when trust proxy=1).
if (process.env.NODE_ENV === "production") {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.protocol !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ─── Security headers (helmet) ───────────────────────────────────────────────
// Sets: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
// Strict-Transport-Security (HSTS), Referrer-Policy, and more.
app.use(
  helmet({
    // HSTS: tell browsers to always use HTTPS for 1 year, include subdomains
    hsts: {
      maxAge: 31_536_000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
    // Allow inline scripts for Vite dev only — restrict in prod
    contentSecurityPolicy: false, // API server; CSP belongs on the frontend
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow Vite frontend to fetch
  }),
);

// ─── CORS ────────────────────────────────────────────────────────────────────
// In production set ALLOWED_ORIGINS env var; in dev (unset) allow all.
const allowedOrigins: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server, mobile)
      if (!origin) return callback(null, true);
      // In dev (no ALLOWED_ORIGINS set) allow all
      if (allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    credentials: true,
  }),
);

// ─── Request logging ─────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0], // strip query strings from logs
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ─── IP threat monitoring ─────────────────────────────────────────────────────
// Tracks 401/403/429/404-probe responses per IP and progressively blocks
// repeat offenders (1 min → 15 min → 2 h → 24 h).
app.use(threatMiddleware);

// ─── Body parsing ─────────────────────────────────────────────────────────────
// The `verify` callback captures the raw body buffer on every request.
// Webhook signature validators read req.rawBody to verify HMAC integrity before the parsed JSON is used.
app.use(
  express.json({
    limit: "64kb",
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api", router);
app.use("/v1",  v1Router);

// ─── Serve frontend static files ─────────────────────────────────────────────
// Serves the built usdc-send app. All non-API routes fall through to index.html
// so that client-side routing works.
const frontendDist = path.resolve(__dirname, "../../usdc-send/dist/public");
app.use(express.static(frontendDist));
app.get("/{*path}", (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  const status = err.status ?? err.statusCode ?? 500;
  const message =
    process.env.NODE_ENV === "production" ? "Internal server error" : (err.message ?? "Internal server error");
  res.status(status).json({ error: "Internal server error", message });
});

export default app;
