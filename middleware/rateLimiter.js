const rateLimit = require("express-rate-limit");

/**
 * Login rate limiter — 5 attempts per 15 minutes per IP.
 * After the 5th failure the user sees a clear message instead of an error loop.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true, // Return rate-limit info in `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    message:
      "Too many login attempts from this IP. Please wait 15 minutes before trying again.",
  },
  skipSuccessfulRequests: true, // Only count failed requests toward the limit
});

/**
 * Register rate limiter — 10 new accounts per hour per IP.
 * Prevents bulk account creation / enumeration attacks.
 */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      "Too many registration attempts from this IP. Please try again in an hour.",
  },
});

/**
 * General API limiter — 200 requests per 15 minutes per IP.
 * A broad backstop against crawlers and denial-of-service attempts.
 */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please slow down." },
});

module.exports = { loginLimiter, registerLimiter, apiLimiter };
