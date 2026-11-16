// Renders public/icon.svg to the PNG icons of the web app manifest (run: node scripts/icons.mjs).
// "maskable" icons are full-bleed with the drawing inside the 80 % safe zone.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("public/icon.svg", "utf8");
const inner = svg.replace(/<rect[^>]*\/>/, "").replace(/^<svg[^>]*>|<\/svg>\s*$/g, "");
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#4f46e5"/><g transform="translate(51.2 51.2) scale(.8)">${inner}</g></svg>`;

const out = [
  ["public/pwa-192x192.png", 192, svg, true],
  ["public/pwa-512x512.png", 512, svg, true],
  ["public/maskable-icon-512x512.png", 512, maskable, false],
  ["public/apple-touch-icon-180x180.png", 180, maskable, false],
];

const browser = await chromium.launch();
for (const [file, size, source, transparent] of out) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}" width="${size}" height="${size}" style="display:block">`);
  await page.screenshot({ path: file, omitBackground: transparent });
  await page.close();
  console.log(file);
}
await browser.close();
