import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Fieldnotes",
        short_name: "Fieldnotes",
        theme_color: "#1f6f5c",
        icons: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
