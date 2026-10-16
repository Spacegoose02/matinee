// Classify by width rather than height so letterboxed scope films (e.g. 1920x800)
// still count as 1080p.
export function resolutionLabel(width: number): string {
  if (width >= 3800) return "4K";
  if (width >= 1900) return "1080p";
  if (width >= 1260) return "720p";
  return "SD";
}
