import { profile } from "./profiler";
import type Redis from "ioredis";

function makeMockClient(responses: Array<[null | Error, number | null]>[]): Redis {
  let callIdx = 0;
  const pipeline = {
    memory: jest.fn().mockReturnThis(),
    ttl: jest.fn().mockReturnThis(),
    exec: jest.fn().mockImplementation(() => {
      const resp = responses[callIdx++];
      return Promise.resolve(resp);
    }),
  };
  return { pipeline: jest.fn().mockReturnValue(pipeline) } as unknown as Redis;
}

async function* fromBatch(batches: string[][]): AsyncIterable<string[]> {
  for (const b of batches) yield b;
}

describe("profiler", () => {
  it("sums totalBytes correctly across batched pipeline results", async () => {
    // Two batches: ["k1","k2"] and ["k3"]
    // pipeline responses per batch: [memUsage, ttl] pairs
    const client = makeMockClient([
      // batch 1: k1=100bytes no-TTL, k2=200bytes with-TTL
      [[null, 100], [null, -1], [null, 200], [null, 60]],
      // batch 2: k3=300bytes no-TTL (different pattern prefix)
      [[null, 300], [null, -1]],
    ]);

    const result = await profile(client, fromBatch([["user:1", "user:2"], ["user:3"]]));

    // All three collapse to the same pattern "user:{n}"
    const stats = result.get("user:{n}");
    expect(stats).toBeDefined();
    expect(stats!.totalBytes).toBe(600);
    expect(stats!.count).toBe(3);
  });

  it("computes TTL coverage ratio correctly", async () => {
    const client = makeMockClient([
      // 3 keys: first has TTL>0, others don't
      [[null, 50], [null, 120], [null, 50], [null, -1], [null, 50], [null, -1]],
    ]);

    const result = await profile(client, fromBatch([["cache:a1b2c3d4", "cache:b2c3d4e5", "cache:c3d4e5f6"]]));
    const stats = result.get("cache:{hex}");
    expect(stats).toBeDefined();
    expect(stats!.keysWithTTL).toBe(1);
    expect(stats!.count).toBe(3);
    // 1/3 ≈ 33.3% coverage
    expect(stats!.keysWithTTL / stats!.count).toBeCloseTo(1 / 3);
  });
});
