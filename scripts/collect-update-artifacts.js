const fs = require("node:fs");
const path = require("node:path");

const edition = process.env.FURRBOX_EDITION === "AdminEdition" ? "AdminEdition" : "Standard";
const channel = edition === "AdminEdition" ? "admin" : "standard";
const releaseDir = path.join(__dirname, "..", "release");
const updatesDir = path.join(releaseDir, "updates", channel);
const setupName = `FurrBox_${edition}_Setup.exe`;
const files = [
  setupName,
  `${setupName}.blockmap`,
  "latest.yml"
];

fs.mkdirSync(updatesDir, { recursive: true });

for (const file of files) {
  const source = path.join(releaseDir, file);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing update artifact: ${source}`);
  }
  fs.copyFileSync(source, path.join(updatesDir, file));
}

console.log(`Collected ${edition} update artifacts in ${updatesDir}`);
