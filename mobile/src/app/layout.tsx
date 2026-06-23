import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FurrBox Mobile",
  description: "Mobile companion interface for FurrBox",
  applicationName: "FurrBox Mobile",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/maskable.svg", type: "image/svg+xml" }
    ],
    apple: [{ url: "/icons/apple-touch-icon.svg", type: "image/svg+xml", sizes: "180x180" }]
  },
  appleWebApp: {
    capable: true,
    title: "FurrBox",
    statusBarStyle: "black-translucent"
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#070812"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
