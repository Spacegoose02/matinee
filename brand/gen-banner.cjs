// Generates the README banner (banner.svg) and the GitHub social preview (social-preview.svg and .png).
// Run from this folder:  node gen-banner.cjs
// The PNG needs Microsoft Edge or Chrome installed (set BROWSER to its path); without one only the SVGs are written.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const logo = fs.readFileSync(path.join(__dirname, "logo.svg"), "utf8").match(/<path[^>]*\/>/)[0].replace('fill="#f5b942"', 'fill="url(#gold)"');
const FONT = "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

function svg({ w, h, tagline, chips }) {
  const bulbs = (y) => Array.from({ length: Math.floor(w / 40) }, (_, i) => `<circle cx="${20 + i * 40}" cy="${y}" r="5" fill="url(#gold)" opacity="${i % 2 ? 0.35 : 0.9}"/>`).join("");
  const logoScale = h > 400 ? 1.3 : 1.05;
  const logoW = 238.4 * logoScale;
  const logoH = 142.7 * logoScale;
  const cy = h / 2 + (h > 400 ? -30 : 0);
  const logoX = 90;
  const textX = logoX + logoW + 50;
  const titleSize = h > 400 ? 124 : 96;
  const chipRow = chips
    ? chips.map((c, i) => {
        const x = textX + i * 192;
        return `<rect x="${x}" y="${cy + 120}" rx="20" width="180" height="40" fill="#ffffff" fill-opacity="0.07" stroke="#f5b942" stroke-opacity="0.5"/><text x="${x + 90}" y="${cy + 147}" text-anchor="middle" font-family="${FONT}" font-size="20" fill="#eceef3">${c}</text>`;
      }).join("")
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Matinee: ${tagline}">
  <title>Matinee</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a0c11"/><stop offset="1" stop-color="#1a1d2a"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8c85c"/><stop offset="1" stop-color="#ff8a4c"/></linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.5" r="0.7"><stop offset="0" stop-color="#f5b942" stop-opacity="0.22"/><stop offset="1" stop-color="#f5b942" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  ${bulbs(16)}
  ${bulbs(h - 16)}
  <g transform="translate(${logoX} ${cy - logoH / 2}) scale(${logoScale})">${logo}</g>
  <text x="${textX}" y="${cy + titleSize * 0.18}" font-family="${FONT}" font-size="${titleSize}" font-weight="800" letter-spacing="-2" fill="#eceef3">Matinee</text>
  <text x="${textX + 4}" y="${cy + titleSize * 0.18 + 52}" font-family="${FONT}" font-size="${h > 400 ? 36 : 30}" fill="#aab1c2">${tagline}</text>
  ${chipRow}
</svg>
`;
}

const tagline = "One home for your media stack";
fs.writeFileSync(path.join(__dirname, "banner.svg"), svg({ w: 1280, h: 320, tagline }));
const social = svg({ w: 1280, h: 640, tagline, chips: ["Radarr · Sonarr", "Plex · Jellyfin", "Downloads", "Trailers"] });
fs.writeFileSync(path.join(__dirname, "social-preview.svg"), social);

const browser = process.env.BROWSER || ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
if (browser) {
  const html = path.join(__dirname, ".social-preview.html");
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#0a0c11}</style>${social}`);
  execFileSync(browser, ["--headless", "--disable-gpu", "--hide-scrollbars", `--screenshot=${path.join(__dirname, "social-preview.png")}`, "--window-size=1280,640", "file:///" + html.replace(/\\/g, "/")], { stdio: "ignore" });
  fs.unlinkSync(html);
  console.log("wrote banner.svg, social-preview.svg, social-preview.png");
} else {
  console.log("wrote banner.svg and social-preview.svg (no browser found for the PNG)");
}
