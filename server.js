const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

// ── Startup safety check ────────────────────────────────────────────────────
// Refuse to start if critical secrets are missing so we never accidentally
// run with weak defaults in production.
if (!process.env.JWT_SECRET) {
  console.error("❌ FATAL: JWT_SECRET environment variable is not set. Refusing to start.");
  process.exit(1);
}

const app = express();

// ── Trust reverse proxy (Render, Cloudflare, Vercel, AWS ALB) ────────────────
// Essential for rate-limiting by client IP instead of proxy internal IP.
app.set("trust proxy", 1);

const { apiLimiter } = require("./middleware/rateLimiter");

// Ensure uploads folder exists dynamically
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ── Security headers (Helmet) ────────────────────────────────────────────────
// Configured to allow Google OAuth popups and separate Vercel frontend deployment
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);

// ── CORS — locked to configured frontend origin(s) ───────────────────────────
// ALLOWED_ORIGIN can be a single URL or a comma-separated list, e.g.:
//   https://sap-frontend-lake.vercel.app,http://localhost:5173
// Falls back to known frontend origins and dynamically allows localhost & Vercel previews.
const rawOrigins = process.env.ALLOWED_ORIGIN
  || "https://sap-frontend-lake.vercel.app,http://localhost:5173,http://localhost:5174,http://localhost:3000,http://127.0.0.1:5173";
const ALLOWED_ORIGINS = new Set(rawOrigins.split(",").map((o) => o.trim()));

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow same-origin / server-to-server calls (no Origin header)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.has(origin)) return callback(null, true);
      // Allow localhost or 127.0.0.1 on any port for local development
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // Allow Vercel preview deployments for this project
      if (/^https:\/\/sap-frontend(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin '${origin}' is not allowed`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// ── Body size cap — prevents DoS via giant JSON payloads ─────────────────────
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

// ── Broad API rate limiter (200 req / 15 min per IP) ─────────────────────────
app.use("/api", apiLimiter);

// Serve static uploaded files
app.use("/uploads", express.static(uploadsDir));

// Connect to MongoDB with high-concurrency connection pool
const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/sap-db";
mongoose
  .connect(mongoURI, {
    maxPoolSize: 50,
    minPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => console.log("✅ MongoDB connected successfully with high-concurrency connection pool!"))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// API Routes — more-specific paths MUST be mounted before broader ones.
// e.g. /api/admin/sap-structure must come before /api/admin so Express
// doesn't hand the request to the admin router and get a 404.
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/points", require("./routes/pointsRoutes"));
app.use("/api/admin/sap-structure", require("./routes/sapStructureRoutes"));
app.use("/api/admin", require("./routes/admin"));

// Check if reportRoutes exists before mounting
if (fs.existsSync(path.join(__dirname, "routes", "reportRoutes.js"))) {
  app.use("/api/report", require("./routes/reportRoutes"));
}

// Health check endpoint
app.get("/", (req, res) => {
  res.send("SAP Backend API is running smoothly!");
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches any error passed via next(err). Never leaks stack traces to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[Unhandled error]", err);
  res.status(err.status || 500).json({ message: "An unexpected error occurred." });
});

// Start Server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
