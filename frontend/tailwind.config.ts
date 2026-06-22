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
        window: "0 0 0 1px rgba(0,240,255,0.12), 0 22px 70px rgba(2, 6, 23, 0.62), 0 0 45px rgba(139,92,246,0.22)",
        "neon-menu": "0 0 15px rgba(168,85,247,0.4), 0 18px 70px rgba(2,6,23,0.58), 0 0 38px rgba(34,211,238,0.16)"
      },
      colors: {
        neon: {
          cyan: "#00f0ff",
          pink: "#ff007f",
          purple: "#8b5cf6",
          void: "#0a0b10"
        }
      },
      keyframes: {
        "window-in": {
          "0%": { opacity: "0", transform: "translateY(18px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        "task-pop": {
          "0%": { transform: "translateY(8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" }
        },
        "neon-menu": {
          "0%": { opacity: "0", transform: "translateY(5px) scale(0.985)", filter: "blur(4px)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)", filter: "blur(0)" }
        },
        "neon-submenu": {
          "0%": { opacity: "0", transform: "translateX(-7px) scale(0.985)" },
          "100%": { opacity: "1", transform: "translateX(0) scale(1)" }
        },
        "neon-pop": {
          "0%": { opacity: "0", transform: "translate(-50%, -48%) scale(0.96)" },
          "100%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" }
        },
        "wallpaper-fade": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" }
        }
      },
      animation: {
        "window-in": "window-in 260ms cubic-bezier(.2,.8,.2,1) both",
        "task-pop": "task-pop 220ms ease-out both",
        "neon-menu": "neon-menu 130ms cubic-bezier(.2,.8,.2,1) both",
        "neon-submenu": "neon-submenu 150ms cubic-bezier(.2,.8,.2,1) both",
        "neon-pop": "neon-pop 180ms cubic-bezier(.2,.8,.2,1) both",
        "wallpaper-fade": "wallpaper-fade 420ms ease-out both"
      }
    }
  },
  plugins: []
};

export default config;
