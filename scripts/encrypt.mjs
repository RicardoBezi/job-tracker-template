#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [, , inFile, outFile] = process.argv;
const password = process.env.TRACKER_PASSWORD;
if (!inFile || !outFile || !password) {
  console.error("usage: TRACKER_PASSWORD=... node scripts/encrypt.mjs <secrets.json> <out.enc.json>");
  process.exit(1);
}
const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const iterations = 600000;
const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, km, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(readFileSync(inFile, "utf8")));
const b64 = (b) => Buffer.from(b).toString("base64");
writeFileSync(outFile, JSON.stringify({ v: 1, iterations, salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext) }, null, 2) + "\n");
console.log(`wrote ${outFile}`);
