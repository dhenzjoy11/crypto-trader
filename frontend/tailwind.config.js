/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#0b0b14",
          secondary: "#13131f",
          card: "#1a1a2e",
          border: "#2a2a42",
        },
        green: {
          crypto: "#00c853",
          dim: "#1a3a27",
        },
        red: {
          crypto: "#ff1744",
          dim: "#3a1a1a",
        },
        yellow: {
          crypto: "#ffd600",
        },
        blue: {
          crypto: "#2979ff",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
