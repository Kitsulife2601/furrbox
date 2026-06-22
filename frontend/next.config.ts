import type { NextConfig } from "next";

const isStaticExport = process.env.NEXT_STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: isStaticExport ? "export" : undefined,
  assetPrefix: isStaticExport ? "./" : undefined,
  images: {
    unoptimized: true
  }
};

export default nextConfig;
