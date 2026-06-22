import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Segoe UI Variable", "Segoe UI", "Inter", "system-ui", "sans-serif"]
      },
      boxShadow: {
        glass: "0 24px 80px rgba(15, 23, 42, 0.24)",
        window: "0 22px 70px rgba(2, 6, 23, 0.34)"
      },
      keyframes: {
        "window-in": {
          "0%": { opacity: "0", transform: "translateY(18px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        "task-pop": {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" }
        }
      },
      animation: {
        "window-in": "window-in 260ms cubic-bezier(.2,.8,.2,1) both",
        "task-pop": "task-pop 220ms ease-out both"
      }
    }
  },
  plugins: []
};

export default config;
