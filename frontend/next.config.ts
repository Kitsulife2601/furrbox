import type { NextConfig } from "next";

const isStaticExport = process.env.NEXT_STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.FURRBOX_SERVER_URL || "http://localhost:4000"
  },
  output: isStaticExport ? "export" : undefined,
  assetPrefix: isStaticExport ? "./" : undefined,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
