import { scan } from "./scanner";
import type Redis from "ioredis";

function makeMockRedis(pages: string[][]): Redis {
  let call = 0;
  const scanMock = jest.fn().mockImplementation(() => {
    const keys = pages[call] ?? [];
    const cursor = call < pages.length - 1 ? String(call + 1) : "0";
    call++;
    return Promise.resolve([cursor, keys]);
  });
  return { scan: scanMock } as unknown as Redis;
}

async function collect(gen: AsyncGenerator<string[]>): Promise<string[]> {
  const out: string[] = [];
  for await (const batch of gen) out.push(...batch);
  return out;
}

describe("scanner", () => {
  it("yields all keys when sample-rate=1", async () => {
    const client = makeMockRedis([["a", "b", "c"]]);
    const result = await collect(scan(client, { sampleRate: 1 }));
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("yields nothing when sample-rate=0", async () => {
    const client = makeMockRedis([["a", "b", "c"]]);
    const result = await collect(scan(client, { sampleRate: 0 }));
    expect(result).toHaveLength(0);
  });

  it("is deterministic when Math.random is stubbed", async () => {
    jest.spyOn(Math, "random").mockReturnValue(0.3);
    const client = makeMockRedis([["x", "y", "z"]]);
    // rate=0.5 → 0.3 < 0.5 → all three pass
    const result = await collect(scan(client, { sampleRate: 0.5 }));
    expect(result).toEqual(["x", "y", "z"]);
    jest.restoreAllMocks();
  });
});
