# Architecture

## Overview

The tool is a single-pass streaming pipeline: scan keys → measure memory → aggregate by pattern → render output. Each stage is a separate module with no shared state; data flows forward only.

```
cli.ts
  │
  ├─ scanner.ts   — async generator, yields string[] batches
  ├─ profiler.ts  — consumes batches, pipelines MEMORY USAGE + TTL per batch
  │    └─ pattern.ts  — stateless key → pattern normalisation
  └─ reporter.ts  — sorts, slices, formats table or JSON
```

## Modules

### `redis.ts`

Thin factory around `ioredis`. Creates a client from a URL string. Kept separate so tests can substitute a fake client without touching business logic.

### `scanner.ts` — `scan(client, opts): AsyncGenerator<string[]>`

Wraps the Redis `SCAN` cursor loop in an async generator. Each iteration issues one `SCAN` command and yields the returned key batch. Probabilistic sampling (`sampleRate < 1`) is applied per batch by dropping individual keys with `Math.random()`. The generator terminates when the cursor returns to `"0"`.

Using a generator keeps memory flat: only one batch lives in memory at a time regardless of keyspace size.

### `pattern.ts` — `keyToPattern(key): string`

Normalises a raw Redis key to a representative pattern using three regex passes applied in priority order:

1. UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) → `{id}`
2. Hex string ≥ 8 chars → `{hex}`
3. Decimal integer → `{n}`

The priority order matters: a UUID would otherwise partially match the hex rule. The result is a stable string used as the map key in the profiler.

### `profiler.ts` — `profile(client, batches): Promise<ProfileResult>`

Iterates the scanner's async generator. For each batch it builds an ioredis pipeline with one `MEMORY USAGE key SAMPLES 0` and one `TTL key` per key, then fires the pipeline in a single round trip. `SAMPLES 0` skips deep-sampling inside Redis for speed; the default Redis sampling is conservative enough that `SAMPLES 0` gives exact results for simple value types and a close approximation for aggregates.

Results accumulate in a `Map<pattern, {totalBytes, count, keysWithTTL}>`. The map grows only as large as the number of distinct patterns, not the number of keys.

### `reporter.ts` — `report(result, opts)`

Sorts the pattern map by `totalBytes` or `count`, slices to `top` entries, and renders either a `cli-table3` terminal table or a JSON array to stdout. TTL coverage is expressed as a percentage of keys in the pattern that have a positive TTL, giving a quick signal for patterns that should expire but don't.

## Data flow

```
SCAN cursor loop
  └─ yields batch (string[])
       └─ pipeline: MEMORY USAGE + TTL per key
            └─ pattern.keyToPattern(key)
                 └─ Map<pattern, PatternStats>
                      └─ sort → slice → table | JSON
```

## Performance characteristics

- **Network round trips**: O(keyspace / batchSize) SCAN calls + one pipeline per batch. Default batch size is 200 keys, so a 1 M-key space takes ~5 000 SCAN calls plus ~5 000 pipelines, each pipeline carrying 400 commands (200 × MEMORY USAGE + 200 × TTL).
- **Memory**: O(distinct patterns), which is typically orders of magnitude smaller than the keyspace.
- **Sampling**: `--sample-rate 0.1` drops 90% of keys client-side after each SCAN, reducing pipeline calls proportionally. SCAN itself still traverses the full keyspace; the saving is in MEMORY USAGE calls, not in SCAN round trips.
