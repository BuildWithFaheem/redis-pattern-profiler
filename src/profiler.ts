import Redis from "ioredis";
import { keyToPattern } from "./pattern";

export interface PatternStats {
  totalBytes: number;
  count: number;
  keysWithTTL: number;
}

export type ProfileResult = Map<string, PatternStats>;

export async function profile(
  client: Redis,
  batches: AsyncIterable<string[]>
): Promise<ProfileResult> {
  const result: ProfileResult = new Map();

  for await (const keys of batches) {
    const pipeline = client.pipeline();
    for (const key of keys) {
      pipeline.memory("USAGE", key, "SAMPLES", 0);
      pipeline.ttl(key);
    }

    const responses = await pipeline.exec();
    if (!responses) continue;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const [memErr, memBytes] = responses[i * 2];
      const [ttlErr, ttlVal] = responses[i * 2 + 1];

      const bytes = memErr || memBytes == null ? 0 : (memBytes as number);
      const hasTTL = !ttlErr && typeof ttlVal === "number" && ttlVal > 0;

      const pattern = keyToPattern(key);
      const existing = result.get(pattern) ?? { totalBytes: 0, count: 0, keysWithTTL: 0 };
      result.set(pattern, {
        totalBytes: existing.totalBytes + bytes,
        count: existing.count + 1,
        keysWithTTL: existing.keysWithTTL + (hasTTL ? 1 : 0),
      });
    }
  }

  return result;
}
