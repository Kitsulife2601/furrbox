import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        furrCyan: "#00f0ff",
        furrPink: "#ff007f",
        furrViolet: "#8b5cf6",
        furrNight: "#070812"
      },
      boxShadow: {
        neonCyan: "0 0 24px rgba(0,240,255,0.26)",
        neonPink: "0 0 24px rgba(255,0,127,0.24)",
        panel: "0 18px 60px rgba(0,0,0,0.45)"
      }
    }
  },
  plugins: []
};

export default config;
