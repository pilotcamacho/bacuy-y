/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // GratitudeMemory: each new entry fades in, rising slightly (motion-safe only)
      keyframes: { "memory-in": { from: { opacity: "0", transform: "translateY(3px)" }, to: { opacity: "1", transform: "none" } } },
      animation: { "memory-in": "memory-in 450ms ease-out" },
    },
  },
  plugins: [],
};
