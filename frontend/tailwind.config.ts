import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./store/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        panel: "#10151c",
        shell: "#0a0d12",
        line: "#1f2937",
        positive: "#14b86a",
        negative: "#ef4444",
        caution: "#f59e0b",
        accent: "#38bdf8"
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(148, 163, 184, 0.08), 0 12px 28px rgba(0, 0, 0, 0.28)"
      }
    }
  },
  plugins: []
};

export default config;
