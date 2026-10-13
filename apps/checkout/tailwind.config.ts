import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        fem: {
          50:  "#fff0f0",
          100: "#ffe0e0",
          200: "#ffcac8",
          300: "#ffa69e",
          400: "#ff7f75",
          500: "#fc5245",
          600: "#e83d30",
          700: "#c42d22",
          800: "#a22820",
          900: "#852622",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.04)",
        "card-hover": "0 4px 12px 0 rgba(252,82,69,0.12)",
        input: "0 0 0 3px rgba(255,166,158,0.25)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
    },
  },
  plugins: [],
};

export default config;
