// Creates the Prisma client and, on first start, the SQLite tables, so a fresh
// checkout works with a plain `npm run dev`. The schema is only pushed while the
// database file does not exist yet: the server adds extra tables at runtime
// (ChatSettings, AccountSetupInvite, ...) that `prisma db push` would drop.
import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
fs.mkdirSync(storageDir, { recursive: true });

const databaseUrl = process.env.DATABASE_URL || `file:${path.join(storageDir, "furrbox.db")}`;
const databaseFile = path.resolve("prisma", databaseUrl.replace(/^file:/, ""));
const env = { ...process.env, DATABASE_URL: databaseUrl };

const steps = [["prisma", "generate"]];
if (!fs.existsSync(databaseFile)) steps.push(["prisma", "db", "push", "--skip-generate"]);

for (const args of steps) {
  const result = spawnSync("npx", args, { stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`FurrBox database setup failed: npx ${args.join(" ")}`);
    process.exit(result.status ?? 1);
  }
}
