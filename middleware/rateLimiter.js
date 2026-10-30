const rateLimit = require("express-rate-limit");

/**
 * ── Account-based Login Limiter (Tier 1) ──────────────────────────────────
 * Prevents brute-force password guessing against a single user account.
 * Keyed by the normalized email address so that failed attempts by one student
 * will NEVER lock out other students sharing the same campus Wi-Fi or lab IP.
 * - 5 failed attempts per 15 minutes per account.
 * - Successful logins are skipped and do not count toward the limit.
 */
const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    if (req.body && req.body.email) {
      return `acc_${String(req.body.email).toLowerCase().trim()}`;
    }
    return rateLimit.ipKeyGenerator(req);
  },
  message: {
    message:
      "Too many failed login attempts for this account. Please wait 15 minutes before trying again.",
  },
});

/**
 * ── Institutional IP Flood Guard (Tier 2) ─────────────────────────────────
 * Protects against distributed botnets / automated credential stuffing.
 * Generous threshold of 500 failed attempts per 15 minutes per IP ensures that
 * entire lecture halls or computer labs sharing a single campus NAT / proxy IP
 * can log in simultaneously without hitting false-positive locks.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // High capacity for institutional campus networks
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => rateLimit.ipKeyGenerator(req),
  message: {
    message:
      "Too many login attempts from this network. Please wait 15 minutes before trying again.",
  },
});

/**
 * Composite Login Limiter middleware:
 * Enforces both per-account brute force protection AND IP flood guard.
 */
const loginLimiter = (req, res, next) => {
  loginAccountLimiter(req, res, (err) => {
    if (err) return next(err);
    loginIpLimiter(req, res, next);
  });
};

/**
 * ── Google OAuth Rate Limiter ─────────────────────────────────────────────
 * Prevents token replay / spam while allowing massive concurrent Google logins.
 */
const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => rateLimit.ipKeyGenerator(req),
  message: {
    message: "Too many Google sign-in requests. Please wait a moment.",
  },
});

/**
 * ── Register Rate Limiter ─────────────────────────────────────────────────
 * Generous limit allowing 150 new student registrations per hour per IP,
 * preventing bulk account spam while allowing classroom onboarding.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      "Too many registration attempts from this network. Please try again later.",
  },
});

/**
 * ── High-Capacity Multi-Tier API Limiter ──────────────────────────────────
 * Designed for massive concurrent users across campus networks:
 * - Authenticated users (with Bearer token) receive 2,000 requests / 15 min per user.
 * - Unauthenticated / public requests receive 5,000 requests / 15 min per IP.
 * Guarantees that hundreds of students submitting and viewing SAP points at
 * the same time will never hit rate limits.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    // Authenticated users get dedicated quota per token
    if (req.headers && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      return 2000;
    }
    // Shared unauthenticated public traffic
    return 5000;
  },
  keyGenerator: (req) => {
    if (req.headers && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      // Key by token prefix (unique per user session)
      return `auth_${req.headers.authorization.slice(7, 40)}`;
    }
    return rateLimit.ipKeyGenerator(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please slow down." },
});

module.exports = {
  loginLimiter,
  loginAccountLimiter,
  loginIpLimiter,
  googleLimiter,
  registerLimiter,
  apiLimiter,
};
