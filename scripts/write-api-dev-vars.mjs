import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, ".env");
const targetPath = resolve(root, "apps/api/.dev.vars");

const allowedKeys = [
  "DATABASE_URL",
  "INTERNAL_SERVICE_TOKEN",
  "CLERK_SECRET_KEY",
  "LOCAL_MODEL_BASE_URL",
  "LOCAL_MODEL_NAME",
  "NEXT_PUBLIC_CONVEX_URL",
];

const source = readFileSync(sourcePath, "utf8");
const values = new Map();

for (const line of source.split(/\r?\n/u)) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
  const separator = trimmed.indexOf("=");
  if (separator === -1) continue;
  values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
}

const body = allowedKeys
  .map((key) => {
    const value = values.get(key);
    return value ? `${key}=${value}` : null;
  })
  .filter((line) => line !== null)
  .join("\n");

mkdirSync(dirname(targetPath), { recursive: true });
writeFileSync(targetPath, `${body}\n`, "utf8");
console.log(targetPath);
