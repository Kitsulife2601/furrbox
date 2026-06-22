const fs = require("node:fs");
const path = require("node:path");

const edition = process.env.FURRBOX_EDITION === "AdminEdition" ? "AdminEdition" : "Standard";
const updateChannel = edition === "AdminEdition" ? "admin" : "standard";
const defaultBaseUrl = "http://5.249.162.130:4000/updates";
const baseUrl = (process.env.FURRBOX_UPDATE_BASE_URL || defaultBaseUrl).replace(/\/+$/, "");
const updateUrl = `${baseUrl}/${updateChannel}`;

const outPath = path.join(__dirname, "..", "electron", "edition.json");
fs.writeFileSync(outPath, `${JSON.stringify({ edition, updateChannel, updateUrl }, null, 2)}\n`);
console.log(`Wrote ${edition} update metadata to ${outPath}`);
