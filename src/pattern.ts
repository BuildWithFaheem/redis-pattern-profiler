// Order matters: UUID first (most specific), then hex ≥8 chars, then pure numeric
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b[0-9a-f]{8,}\b/gi;
const NUM_RE = /\b\d+\b/g;

export function keyToPattern(key: string): string {
  return key
    .replace(UUID_RE, "{id}")
    .replace(HEX_RE, "{hex}")
    .replace(NUM_RE, "{n}");
}
