/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || process.env.FURRBOX_SERVER_URL || "http://localhost:4000"
  },
  output: "export",
  images: {
    unoptimized: true
  }
};

export default nextConfig;
