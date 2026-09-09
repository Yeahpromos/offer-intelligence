// Category identity must survive filtering and metric/rank changes.
const NETWORK_COLORS: Readonly<Record<string, string>> = {
  levanta: "#3478ed", wayward: "#228552", archer: "#b87512",
  pbamazon: "#dc4148", amazon: "#8359ce"
};
const MARKET_COLORS: Readonly<Record<string, string>> = {
  "amazon.com": "#3478ed", "amazon.co.uk": "#228552", "amazon.de": "#b87512",
  "amazon.fr": "#dc4148", "amazon.ca": "#8359ce", "amazon.it": "#b84983",
  "amazon.es": "#197e92", "amazon.com.au": "#bf6635", "amazon.co.jp": "#6366c1"
};
const EXTRA_COLORS = ["#3478ed", "#228552", "#b87512", "#dc4148", "#8359ce", "#197e92", "#b84983"];

export function publisherOverviewColor(type: "market" | "network", key: string): string {
  const normalized = key.trim().toLowerCase();
  const known = (type === "network" ? NETWORK_COLORS : MARKET_COLORS)[normalized];
  if (known) return known;
  let hash = 0;
  for (const character of `${type}:${normalized}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return EXTRA_COLORS[hash % EXTRA_COLORS.length]!;
}

// Filled annular sectors give each slice its own hit area, including a full ring.
export function publisherDonutPath(start: number, fraction: number): string {
  const point = (radius: number, turn: number) => {
    const angle = turn * Math.PI * 2 - Math.PI / 2;
    return `${(50 + radius * Math.cos(angle)).toFixed(5)} ${(50 + radius * Math.sin(angle)).toFixed(5)}`;
  };
  if (fraction <= 0) return "";
  if (fraction >= 1 - 1e-8) {
    return `M ${point(45, start)} A 45 45 0 1 1 ${point(45, start + .5)} A 45 45 0 1 1 ${point(45, start + 1)} L ${point(31, start + 1)} A 31 31 0 1 0 ${point(31, start + .5)} A 31 31 0 1 0 ${point(31, start)} Z`;
  }
  const large = fraction > .5 ? 1 : 0;
  return `M ${point(45, start)} A 45 45 0 ${large} 1 ${point(45, start + fraction)} L ${point(31, start + fraction)} A 31 31 0 ${large} 0 ${point(31, start)} Z`;
}
