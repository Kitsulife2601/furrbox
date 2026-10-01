// Writes release-notes.md for the desktop release from the matching entry in
// src/lib/furr/updates.json (same text users see under FurrSettings → Updates).
// Usage: node .github/scripts/release-notes.mjs v2.0.7
import { readFileSync, writeFileSync } from "node:fs";

const version = String(process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "").replace(/^v/, "");
const updates = JSON.parse(readFileSync("src/lib/furr/updates.json", "utf8"));
const entry = updates.find((u) => u.version === version);
writeFileSync("release-notes.md", entry ? entry.items.map((item) => `- ${item}`).join("\n") : "");
console.log(entry ? `Release-Notizen für ${version}: ${entry.title}` : `Kein Eintrag für ${version} – GitHub erzeugt die Notizen.`);
