// Builds the FurrBox web app as a standalone Node server (Nitro "node-server" preset)
// and copies it to desktop/server, which electron-builder ships as an extra resource.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(desktopDir);
const output = join(root, ".output");
const target = join(desktopDir, "server");

console.log("[furrbox] Baue Server (node-server)…");
const result = spawnSync(
  process.execPath,
  ["scripts/with-app-env.mjs", process.execPath, "node_modules/vite/bin/vite.js", "build"],
  { cwd: root, stdio: "inherit", env: { ...process.env, FURRBOX_NITRO_PRESET: "node-server" } },
);
if (result.status !== 0) process.exit(result.status ?? 1);

// The bundled PGLite loads its WASM runtime + data file from next to its chunk.
const pgliteDist = join(root, "node_modules", "@electric-sql", "pglite", "dist");
for (const file of ["pglite.wasm", "pglite.data", "initdb.wasm"]) {
  cpSync(join(pgliteDist, file), join(output, "server", "_libs", file));
}

if (existsSync(target)) rmSync(target, { recursive: true, force: true });
cpSync(output, target, { recursive: true });
console.log(`[furrbox] Server nach ${target} kopiert.`);
