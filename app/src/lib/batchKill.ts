// Returns the most frequent non-empty name; ties broken by first-to-reach-peak.
export function mostCommonName(names: string[]): string | null {
  const valid = names.filter((n) => n.length > 0);
  if (valid.length === 0) return null;
  const freq: Record<string, number> = {};
  let best = '';
  for (const n of valid) {
    freq[n] = (freq[n] || 0) + 1;
    if (freq[n] > (freq[best] || 0)) best = n;
  }
  return best || null;
}
