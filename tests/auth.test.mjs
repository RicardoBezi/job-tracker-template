import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionCookie,
  createSessionCookie,
  hashPassword,
  hasValidScannerToken,
  hasValidSession,
  isSameOrigin,
  verifyPassword,
} from "../api/_lib/auth.mjs";
import apiHandler from "../api/[...path].mjs";

beforeEach(() => {
  process.env.AUTH_PASSWORD_HASH = hashPassword("golden-road-password");
  process.env.SESSION_SECRET = "test-session-secret-with-at-least-32-chars";
  process.env.SCANNER_TOKEN = "test-scanner-token-at-least-32-characters";
});

describe("hosted authentication", () => {
  it("hashes and verifies the owner password", () => {
    expect(verifyPassword("golden-road-password")).toBe(true);
    expect(verifyPassword("wrong-password")).toBe(false);
  });

  it("creates a signed, secure session cookie", () => {
    const cookie = createSessionCookie();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(hasValidSession({ headers: { cookie } })).toBe(true);
    expect(hasValidSession({ headers: { cookie: cookie.replace("gcn_session=e", "gcn_session=x") } })).toBe(false);
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("keeps scanner and browser authentication separate", () => {
    expect(hasValidScannerToken({ headers: { authorization: "Bearer test-scanner-token-at-least-32-characters" } })).toBe(true);
    expect(hasValidScannerToken({ headers: { authorization: "Bearer wrong" } })).toBe(false);
  });

  it("accepts only same-origin browser mutations", () => {
    const request = { headers: { origin: "https://gcn.example", host: "gcn.example", "x-forwarded-proto": "https" } };
    expect(isSameOrigin(request)).toBe(true);
    expect(isSameOrigin({ ...request, headers: { ...request.headers, origin: "https://evil.example" } })).toBe(false);
  });

  it("serves login and session through the web-standard function handler", async () => {
    const loginResponse = await apiHandler.fetch(new Request("https://gcn.example/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://gcn.example" },
      body: JSON.stringify({ password: "golden-road-password" }),
    }));
    expect(loginResponse.status).toBe(200);
    const cookie = loginResponse.headers.get("set-cookie");
    expect(cookie).toContain("gcn_session=");

    const sessionResponse = await apiHandler.fetch(new Request("https://gcn.example/api/auth/session", {
      headers: { Cookie: cookie },
    }));
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual({ authenticated: true });
  });
});
