#!/usr/bin/env node
/**
 * Renders the PWA / home-screen icons into public/icons from the EA mark.
 * Needs Playwright with Chromium (dev only):  node scripts/generate-icons.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const out = path.resolve(import.meta.dirname, "../public/icons");

// rounded: transparent corners (browsers/desktop); full: edge-to-edge square
// (iOS masks it itself); maskable: glyph kept inside the 80% safe zone.
const svg = (variant) => {
  const rx = variant === "rounded" ? 14 : 0;
  const scale = variant === "maskable" ? 0.72 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
    <rect width="64" height="64" rx="${rx}" fill="#0A0A0A"/>
    <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
      <text x="32" y="43" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="900" font-size="30" letter-spacing="-2">
        <tspan fill="#FFFFFF">E</tspan><tspan fill="#B6F23A">A</tspan>
      </text>
    </g>
  </svg>`;
};

const targets = [
  ["icon-192.png", 192, "rounded"],
  ["icon-512.png", 512, "rounded"],
  ["maskable-192.png", 192, "maskable"],
  ["maskable-512.png", 512, "maskable"],
  ["apple-touch-icon.png", 180, "full"],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, variant] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(variant)}</body></html>`);
  await page.screenshot({ path: path.join(out, file), omitBackground: variant === "rounded", clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`wrote public/icons/${file}`);
}
await browser.close();
