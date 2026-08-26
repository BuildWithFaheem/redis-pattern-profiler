# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CLI entrypoint (`redis-pattern-profiler`) with `[redis-url]`, `--prefix`, `--sample-rate`, `--top`, `--sort`, and `--json` options.
- Streaming keyspace scanner using the Redis `SCAN` cursor loop with probabilistic key sampling.
- Pattern normalisation: collapses UUIDs → `{id}`, long hex strings → `{hex}`, and integers → `{n}` so keys with dynamic segments are grouped.
- Memory profiler that pipelines `MEMORY USAGE` and `TTL` per batch for efficient round-trip usage.
- Reporter that renders a ranked terminal table (via `cli-table3`) or a JSON array, sortable by total bytes or key count, with TTL coverage percentage per pattern.
- Unit tests for pattern extraction, profiler aggregation, and scanner sampling logic.
- End-to-end test harness that spins up a real Redis connection and validates the full pipeline.
