#!/usr/bin/env node
import { hashPassword } from "../api/_lib/auth.mjs";

const password = process.argv[2] ?? process.env.TRACKER_PASSWORD;
if (!password) {
  console.error("usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}
if (password.length < 12) {
  console.error("password must be at least 12 characters");
  process.exit(1);
}
console.log(hashPassword(password));
