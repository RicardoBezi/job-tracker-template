export interface SecretsBlob { v: number; iterations: number; salt: string; iv: string; ciphertext: string; }
export interface Secrets {
  /** Neon (or any Postgres) connection string, reachable over HTTPS. */
  database_url: string;
  /** Optional: your Claude routine's page URL. Shows the "Run a scan now" button. */
  routine_url?: string;
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function decryptSecrets(blob: SecretsBlob, password: string): Promise<Secrets> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(blob.salt), iterations: blob.iterations, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.ciphertext));
  return JSON.parse(new TextDecoder().decode(plain));
}
