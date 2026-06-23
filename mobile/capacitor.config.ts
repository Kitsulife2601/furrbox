import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "de.furrbox.mobile",
  appName: "FurrBox Mobile",
  webDir: "out",
  server: {
    androidScheme: "https",
    iosScheme: "furrbox"
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#070812",
      androidSplashResourceName: "splash",
      showSpinner: false
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#070812",
      overlaysWebView: true
    }
  }
};

export default config;
