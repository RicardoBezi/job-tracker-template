import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "gcn_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const attempts = new Map();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashPassword(password, salt = randomBytes(16).toString("base64url")) {
  const digest = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${digest}`;
}

export function verifyPassword(password) {
  const [scheme, salt, expected] = required("AUTH_PASSWORD_HASH").split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("base64url");
  return safeEqual(actual, expected);
}

function clientKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? req.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
}

export function checkLoginRate(req) {
  const key = clientKey(req);
  const now = Date.now();
  if (attempts.size > 1000) {
    for (const [attemptKey, value] of attempts) if (value.resetAt <= now) attempts.delete(attemptKey);
    if (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
  }
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true, key };
  }
  return { allowed: current.count < LOGIN_LIMIT, key, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}

export function recordLoginFailure(key) {
  const current = attempts.get(key) ?? { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
  current.count++;
  attempts.set(key, current);
}

export function clearLoginFailures(key) {
  attempts.delete(key);
}

function sign(value) {
  const secret = required("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSessionCookie() {
  const payload = Buffer.from(JSON.stringify({
    sub: "owner",
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function cookies(header = "") {
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part.trim(), ""] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([key]) => key));
}

export function hasValidSession(req) {
  const token = cookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value.sub === "owner" && Number(value.exp) > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function hasValidScannerToken(req) {
  const expected = process.env.SCANNER_TOKEN;
  const header = req.headers.authorization ?? "";
  if (!expected || expected.length < 32 || !header.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), expected);
}

export function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  try { return new URL(origin).origin === `${proto}://${host}`; } catch { return false; }
}
