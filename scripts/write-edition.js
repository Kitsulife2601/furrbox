const fs = require("node:fs");
const path = require("node:path");

const edition = process.env.FURRBOX_EDITION === "AdminEdition" ? "AdminEdition" : "Standard";
const updateChannel = edition === "AdminEdition" ? "admin" : "standard";
const serverUrl = (process.env.FURRBOX_SERVER_URL || "http://localhost:4000").replace(/\/+$/, "");
const defaultBaseUrl = `${serverUrl}/updates`;
const baseUrl = (process.env.FURRBOX_UPDATE_BASE_URL || defaultBaseUrl).replace(/\/+$/, "");
const updateUrl = `${baseUrl}/${updateChannel}`;

const outPath = path.join(__dirname, "..", "electron", "edition.json");
fs.writeFileSync(outPath, `${JSON.stringify({ edition, updateChannel, updateUrl }, null, 2)}\n`);
console.log(`Wrote ${edition} update metadata to ${outPath}`);
