/** Tiny area chart of recent samples; scales to its own peak. */
export function Sparkline({ values, width = 180, height = 44 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg className="sparkline" width={width} height={height} />;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 8)).toFixed(1)}`);
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,${height} ${pts.join(" ")} ${width},${height}`} className="spark-fill" />
      <polyline points={pts.join(" ")} className="spark-line" fill="none" />
    </svg>
  );
}
