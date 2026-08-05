import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fromB64 = (s) => Uint8Array.from(Buffer.from(s, "base64"));

async function decrypt(blob, password) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(blob.salt), iterations: blob.iterations, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}

describe("encrypt.mjs", () => {
  it("roundtrips with the right password and fails with the wrong one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "enc-"));
    const inFile = join(dir, "secrets.json"), outFile = join(dir, "secrets.enc.json");
    writeFileSync(inFile, JSON.stringify({ database_url: "postgres://x", trigger_url: "https://t", trigger_token: "tok" }));
    execSync(`node scripts/encrypt.mjs ${inFile} ${outFile}`, { env: { ...process.env, TRACKER_PASSWORD: "hunter22" } });
    const blob = JSON.parse(readFileSync(outFile, "utf8"));
    expect(blob.iterations).toBe(600000);
    expect(await decrypt(blob, "hunter22")).toMatchObject({ database_url: "postgres://x" });
    await expect(decrypt(blob, "wrong")).rejects.toThrow();
  });
});
