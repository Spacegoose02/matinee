export interface Theme {
  id: string;
  name: string;
  group: "Modern" | "Retro";
  blurb: string;
  /** background, surface, accent, accent 2 — for the picker preview only; the real values live in CSS. */
  swatch: [string, string, string, string];
}

export const THEMES: Theme[] = [
  { id: "marquee", name: "Matinee Gold", group: "Modern", blurb: "Dark cinema with warm gold lights", swatch: ["#0b0d12", "#1a1d26", "#f5b942", "#ff8a4c"] },
  { id: "nord", name: "Nord", group: "Modern", blurb: "Calm arctic blues, easy on the eyes", swatch: ["#2e3440", "#3b4252", "#88c0d0", "#b48ead"] },
  { id: "neon", name: "Neon Synth", group: "Modern", blurb: "Navy night, cyan and hot pink glow", swatch: ["#090d1f", "#141b38", "#22e6ff", "#ff3d9a"] },
  { id: "daylight", name: "Daylight", group: "Modern", blurb: "Clean and bright", swatch: ["#f3f4f7", "#ffffff", "#d97706", "#2563eb"] },
  { id: "drivein", name: "Drive-In", group: "Retro", blurb: "Red velvet, gold marquee bulbs", swatch: ["#150607", "#290e10", "#f2c14e", "#e0483d"] },
  { id: "noir", name: "Film Noir", group: "Retro", blurb: "Moody, muted colour; full colour on hover", swatch: ["#0b0b0b", "#181818", "#f1f1f1", "#a8a8a8"] },
  { id: "sepia", name: "Silent Film", group: "Retro", blurb: "Warm sepia tones and a vignette", swatch: ["#1b150e", "#2b2217", "#e0b04f", "#b86a24"] },
  { id: "vhs", name: "VHS Sunset", group: "Retro", blurb: "80s video store: purple dusk, pink and orange", swatch: ["#170a2b", "#2a1148", "#ff4fa3", "#ffb347"] },
  { id: "vapor", name: "Vaporwave", group: "Retro", blurb: "Pastel neon, cyan to pink", swatch: ["#190f3a", "#2a1a5e", "#01cdfe", "#ff71ce"] },
  { id: "phosphor", name: "Phosphor", group: "Retro", blurb: "Green-screen terminal with scanlines", swatch: ["#030803", "#071407", "#33ff66", "#b6ff5c"] },
  { id: "amber", name: "Amber Terminal", group: "Retro", blurb: "Old amber monitor with scanlines", swatch: ["#090500", "#150d01", "#ffb000", "#ff7a00"] },
  { id: "cyber", name: "Cyberpunk", group: "Retro", blurb: "Yellow and magenta on black, sharp corners", swatch: ["#08080d", "#12121c", "#fcee0a", "#ff2a6d"] },
  { id: "dracula", name: "Dracula", group: "Modern", blurb: "Purple and pink on charcoal", swatch: ["#282a36", "#343746", "#bd93f9", "#ff79c6"] },
  { id: "tokyo", name: "Tokyo Night", group: "Modern", blurb: "Deep indigo with soft blue", swatch: ["#1a1b26", "#24283b", "#7aa2f7", "#bb9af7"] },
  { id: "gruvbox", name: "Gruvbox", group: "Modern", blurb: "Warm earthy browns and yellow", swatch: ["#282828", "#3c3836", "#fabd2f", "#fe8019"] },
  { id: "solarized", name: "Solarized Dark", group: "Modern", blurb: "The classic teal-on-dark scheme", swatch: ["#002b36", "#073642", "#2aa198", "#b58900"] },
  { id: "mocha", name: "Mocha", group: "Modern", blurb: "Soft pastels on a warm dark base", swatch: ["#1e1e2e", "#313244", "#cba6f7", "#f5c2e7"] },
  { id: "c64", name: "Commodore 64", group: "Retro", blurb: "Blue screen, light-blue text, 1982", swatch: ["#352879", "#43358f", "#70e4ef", "#9ae29b"] },
  { id: "gameboy", name: "Game Boy", group: "Retro", blurb: "Four shades of pea green", swatch: ["#9bbc0f", "#8bac0f", "#0f380f", "#306230"] },
  { id: "classic95", name: "Classic Desktop", group: "Retro", blurb: "Grey bevels and a navy title bar, 1995 style", swatch: ["#c0c0c0", "#d6d3ce", "#000080", "#1084d0"] },
];

const STORAGE_KEY = "marquee.theme";

export function loadTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
  } catch {
    // Storage can be blocked; fall back to the default.
  }
  return THEMES[0].id;
}

export function applyTheme(id: string) {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not persisting is fine; the choice still applies for this session.
  }
}
