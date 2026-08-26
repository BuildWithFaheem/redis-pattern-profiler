# redis-pattern-profiler

A zero-config CLI for backend engineers who need to understand where Redis memory is actually going. It scans your keyspace, groups keys by inferred pattern (collapsing IDs, UUIDs, and numeric segments), runs `MEMORY USAGE` on each key, and prints a ranked table showing which patterns dominate your memory budget — without requiring a GUI or a manual `SCAN` loop.

> Status: early. The API may change before 1.0.

## Install

```bash
npm install -g redis-pattern-profiler
# or run without installing:
npx redis-pattern-profiler
```

## Quick start

```bash
# Profile a local Redis instance
npx redis-pattern-profiler

# Output (example):
# ┌──────────────────────────┬────────────┬───────┬──────┐
# │ Pattern                  │ Total Size │ Keys  │ TTL% │
# ├──────────────────────────┼────────────┼───────┼──────┤
# │ session:{id}             │ 48.3MB     │ 12847 │ 100% │
# │ cache:jobs:{n}:result    │ 31.1MB     │  4210 │  82% │
# │ user:{n}:profile         │ 12.6MB     │  8923 │   0% │
# │ ratelimit:{n}            │  1.2MB     │  9201 │ 100% │
# └──────────────────────────┴────────────┴───────┴──────┘
```

## Why this exists

Redis exposes `MEMORY USAGE` per key, but there is no built-in way to aggregate that cost by key pattern. When memory grows unexpectedly you end up writing ad-hoc `SCAN` loops, piping output through `awk`, or opening a GUI tool just to answer "which key family is responsible?" This tool answers that question in one command, directly in your terminal, without touching your application code or requiring any configuration.

## Usage

```bash
# Remote instance
npx redis-pattern-profiler redis://my-cache.internal:6379

# Scan only session keys (useful for large keyspaces)
npx redis-pattern-profiler --prefix session:

# Sample 10% of keys for a fast estimate on large keyspaces
npx redis-pattern-profiler --sample-rate 0.1

# Show top 5 patterns sorted by key count
npx redis-pattern-profiler --top 5 --sort count

# Emit JSON for piping into jq or alerting scripts
npx redis-pattern-profiler --json | jq '.[] | select(.totalBytes > 10000000)'

# Combine options
npx redis-pattern-profiler redis://prod:6379 --prefix cache: --sample-rate 0.1 --top 10 --json
```

### Options

| Flag | Default | Description |
|---|---|---|
| `[redis-url]` | `redis://localhost:6379` | Redis connection URL |
| `--prefix <string>` | *(none)* | Restrict scan to keys with this prefix |
| `--sample-rate <0-1>` | `1.0` | Fraction of keys to sample; `0.1` is useful for keyspaces with millions of keys |
| `--top <n>` | `20` | Number of patterns to display |
| `--sort bytes\|count` | `bytes` | Sort column |
| `--json` | *(off)* | Emit JSON array instead of a table |

### JSON output shape

```json
[
  {
    "pattern": "session:{id}",
    "totalBytes": 50659328,
    "count": 12847,
    "ttlPct": 100
  }
]
```

## How it works

The tool runs a Redis `SCAN` loop against your keyspace, optionally filtering by prefix and probabilistically dropping keys to meet a configured sample rate. Each batch of scanned keys is sent through an ioredis pipeline that issues `MEMORY USAGE` and `TTL` in a single round trip per batch. The raw key name is normalised to a pattern by replacing UUIDs, long hex strings, and numeric segments with `{id}`, `{hex}`, and `{n}` respectively — so `session:3fa8…-uuid` and `session:9b21…-uuid` both map to `session:{id}`. Pattern statistics (total bytes, key count, keys with a positive TTL) are accumulated in memory and then sorted and formatted by the reporter, which can render either a terminal table or a JSON array.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © [Syed Muhammad Faheem](https://github.com/SyedMuhammadFaheem)
