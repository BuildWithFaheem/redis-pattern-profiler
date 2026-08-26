import Redis from "ioredis";

export interface ScanOptions {
  prefix?: string;
  sampleRate?: number;
  count?: number;
}

export async function* scan(client: Redis, opts: ScanOptions = {}): AsyncGenerator<string[]> {
  const { prefix, sampleRate = 1.0, count = 200 } = opts;
  const match = prefix ? `${prefix}*` : "*";
  let cursor = "0";

  do {
    const [next, keys] = await client.scan(cursor, "MATCH", match, "COUNT", count);
    cursor = next;

    const sampled = sampleRate >= 1
      ? keys
      : keys.filter(() => Math.random() < sampleRate);

    if (sampled.length > 0) yield sampled;
  } while (cursor !== "0");
}
