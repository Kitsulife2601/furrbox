const isAdmin = process.env.FURRBOX_EDITION === "AdminEdition";
const edition = isAdmin ? "AdminEdition" : "Standard";
const channel = isAdmin ? "admin" : "standard";
const productName = isAdmin ? "FurrBox Admin Edition" : "FurrBox Standard";
const appId = isAdmin ? "de.furrbox.desktop.admin" : "de.furrbox.desktop.standard";

module.exports = {
  appId,
  productName,
  executableName: productName,
  files: ["electron/**/*", "package.json"],
  extraResources: [
    {
      from: "frontend/out",
      to: "frontend/out"
    }
  ],
  directories: {
    output: "release"
  },
  win: {
    target: [
      {
        target: "nsis",
        arch: ["x64"]
      }
    ],
    artifactName: `FurrBox_${edition}_Setup.\${ext}`,
    publish: [
      {
        provider: "generic",
        url: `http://5.249.162.130:4000/updates/${channel}`
      }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: productName,
    uninstallDisplayName: productName
  }
};
