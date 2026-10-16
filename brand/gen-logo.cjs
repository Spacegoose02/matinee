const fs = require("fs");
// One source of truth: the manatee outline (absolute M/C/Z), facing left.
const body = [
  ["M", 18, 130], ["C", 18, 117, 27, 108, 42, 104], ["C", 52, 94, 72, 88, 96, 88], ["C", 130, 86, 166, 99, 196, 118],
  ["C", 210, 106, 224, 92, 242, 92], ["C", 254, 92, 258, 108, 248, 120], ["C", 238, 134, 216, 142, 196, 138],
  ["C", 186, 156, 164, 170, 138, 169], ["C", 146, 176, 150, 192, 142, 203], ["C", 134, 214, 118, 214, 110, 204],
  ["C", 102, 194, 100, 182, 94, 173], ["C", 70, 170, 40, 162, 26, 148], ["C", 19, 143, 17, 136, 18, 130], ["Z"],
];
const EYE = { x: 46, y: 119, r: 4 };
const TILT = (-8 * Math.PI) / 180, PIVOT = [130, 150];
const rot = ([x, y]) => {
  const dx = x - PIVOT[0], dy = y - PIVOT[1];
  return [PIVOT[0] + dx * Math.cos(TILT) - dy * Math.sin(TILT), PIVOT[1] + dx * Math.sin(TILT) + dy * Math.cos(TILT)];
};
const pts = (cmds) => cmds.flatMap(([c, ...p]) => (c === "Z" ? [] : p.reduce((a, v, i) => (i % 2 ? a : [...a, [v, p[i + 1]]]), [])));
const tilted = body.map(([c, ...p]) => (c === "Z" ? [c] : [c, ...pts([[c, ...p]]).flatMap(rot)]));
const eyeC = rot([EYE.x, EYE.y]);

// bounding box from sampled curve points
const sample = [];
let cur = [0, 0];
for (const [c, ...p] of tilted) {
  if (c === "M") cur = [p[0], p[1]];
  if (c === "C") {
    const [x1, y1, x2, y2, x3, y3] = p;
    for (let t = 0; t <= 1; t += 0.02) {
      const u = 1 - t;
      sample.push([u ** 3 * cur[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3, u ** 3 * cur[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3]);
    }
    cur = [x3, y3];
  }
}
const xs = sample.map((p) => p[0]), ys = sample.map((p) => p[1]);
const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };

const f = (n) => +n.toFixed(1);
const path = (cmds, s, dx, dy) => cmds.map(([c, ...p]) => (c === "Z" ? "Z" : c + p.map((v, i) => f(i % 2 ? v * s + dy : v * s + dx)).join(" "))).join("");
const eyePath = (cx, cy, r) => `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;

// 1. tight mark (viewBox = bounding box + 4 units)
const pad = 4, w = bb.x1 - bb.x0 + pad * 2, h = bb.y1 - bb.y0 + pad * 2;
const markD = path(tilted, 1, -(bb.x0 - pad), -(bb.y0 - pad)) + eyePath(eyeC[0] - (bb.x0 - pad), eyeC[1] - (bb.y0 - pad), EYE.r);
const viewBox = `0 0 ${f(w)} ${f(h)}`;
fs.writeFileSync("logo.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><title>Matinee</title><path fill="#f5b942" fill-rule="evenodd" d="${markD}"/></svg>\n`);
fs.writeFileSync("mark.json", JSON.stringify({ d: markD, viewBox, w: f(w), h: f(h) }));

// 2. icon tile (rounded square, brand gradient, dark manatee) on a 256 canvas, no eye at small sizes handled by the 512 version
const scale = (256 * 0.76) / w;
const dx = (256 - w * scale) / 2, dy = (256 - h * scale) / 2 + 2;
const tileD = path(tilted, scale, dx - bb.x0 * scale + pad * scale, dy - bb.y0 * scale + pad * scale)
  + eyePath(eyeC[0] * scale + dx - bb.x0 * scale + pad * scale, eyeC[1] * scale + dy - bb.y0 * scale + pad * scale, EYE.r * scale);
const tile = (eye) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><title>Matinee</title><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8c85c"/><stop offset="1" stop-color="#ff8a4c"/></linearGradient></defs><rect width="256" height="256" rx="58" fill="url(#g)"/><path fill="#1a1204" fill-rule="evenodd" d="${eye ? tileD : tileD.split("M").slice(0, 2).join("M")}"/></svg>\n`;
fs.writeFileSync("icon.svg", tile(true));
fs.writeFileSync("favicon.svg", tile(false)); // no eye: it would be under a pixel at 16 px
console.log("bbox", bb, "viewBox", viewBox);
