"use strict";
// E2E test: spins up Redis in Docker, seeds keys, exercises the real CLI.
const { execSync, spawnSync } = require("child_process");
const path = require("path");
const Redis = require("ioredis");

const PORT = 6380;
const REDIS_URL = `redis://localhost:${PORT}`;
const CLI = path.resolve(__dirname, "../dist/cli.js");

let containerId = "";
let failed = false;

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  failed = true;
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

async function seed() {
  const r = new Redis(REDIS_URL);
  const pipe = r.pipeline();
  for (let i = 0; i < 20; i++) {
    pipe.set(`user:${i}`, "x".repeat(100));
    pipe.expire(`user:${i}`, 3600);
  }
  for (let i = 0; i < 20; i++) {
    pipe.set(`session:${i}`, "x".repeat(80));
  }
  for (let i = 0; i < 10; i++) {
    pipe.set(`cache:${i}`, "x".repeat(60));
    pipe.expire(`cache:${i}`, 600);
  }
  await pipe.exec();
  await r.quit();
}

function runCLI(args, opts = {}) {
  return spawnSync("node", [CLI, ...(opts.noUrl ? [] : [REDIS_URL]), ...args], {
    encoding: "utf8",
    timeout: opts.timeout ?? 15000,
  });
}

async function testGoldenPath() {
  const table = runCLI([]);
  assert(table.status === 0, `CLI exited ${table.status}: ${table.stderr}`);
  const out = table.stdout;
  const patterns = ["user:{n}", "session:{n}", "cache:{n}"];
  for (const p of patterns) {
    assert(out.includes(p), `table missing pattern '${p}'\n${out}`);
  }
  assert(/\d+(\.\d+)?\s?[KMGT]?B\b/.test(out), `no byte values in table output\n${out}`);
  assert(out.includes("%"), `no TTL% column in output\n${out}`);
  if (!failed) console.log("PASS: table output");
}

async function testJsonOutput() {
  const jsonRun = runCLI(["--json"]);
  assert(jsonRun.status === 0, `--json exited ${jsonRun.status}: ${jsonRun.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(jsonRun.stdout);
  } catch (e) {
    fail(`--json output is not valid JSON: ${jsonRun.stdout}`);
    return;
  }
  assert(Array.isArray(parsed), "JSON output is not an array");
  assert(parsed.length === 3, `expected 3 entries, got ${parsed.length}`);
  const patterns = ["user:{n}", "session:{n}", "cache:{n}"];
  const keys = parsed.map((e) => e.pattern);
  for (const p of patterns) {
    assert(keys.includes(p), `JSON missing pattern '${p}': ${JSON.stringify(keys)}`);
  }
  for (const entry of parsed) {
    assert(entry.totalBytes > 0, `pattern '${entry.pattern}' has 0 bytes`);
    assert(typeof entry.ttlPct === "number", `pattern '${entry.pattern}' missing ttlPct`);
  }
  const user = parsed.find((e) => e.pattern === "user:{n}");
  const session = parsed.find((e) => e.pattern === "session:{n}");
  const cache = parsed.find((e) => e.pattern === "cache:{n}");
  assert(user && user.ttlPct === 100, `user ttlPct should be 100, got ${user?.ttlPct}`);
  assert(session && session.ttlPct === 0, `session ttlPct should be 0, got ${session?.ttlPct}`);
  assert(cache && cache.ttlPct === 100, `cache ttlPct should be 100, got ${cache?.ttlPct}`);
  // stdout must be pure JSON when piping into jq — no table borders, no stray logs
  assert(!jsonRun.stdout.includes("┌"), "--json stdout leaked table formatting");
  if (!failed) console.log("PASS: --json output");
}

async function testPrefixFilter() {
  const run = runCLI(["--prefix", "session:", "--json"]);
  assert(run.status === 0, `--prefix exited ${run.status}: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  assert(parsed.length === 1, `--prefix session: should yield 1 pattern, got ${parsed.length}`);
  assert(parsed[0].pattern === "session:{n}", `--prefix filtered to wrong pattern: ${parsed[0]?.pattern}`);
  if (!failed) console.log("PASS: --prefix filter");
}

async function testTopAndSort() {
  const byCount = runCLI(["--top", "1", "--sort", "count", "--json"]);
  assert(byCount.status === 0, `--top/--sort exited ${byCount.status}: ${byCount.stderr}`);
  const parsed = JSON.parse(byCount.stdout);
  assert(parsed.length === 1, `--top 1 should yield 1 entry, got ${parsed.length}`);
  // user and session both have 20 keys, cache has 10 — top-by-count must not be cache
  assert(parsed[0].pattern !== "cache:{n}", `--sort count picked lowest-count pattern: ${parsed[0].pattern}`);
  if (!failed) console.log("PASS: --top and --sort");
}

async function testSampleRateZero() {
  const run = runCLI(["--sample-rate", "0", "--json"]);
  assert(run.status === 0, `--sample-rate 0 exited ${run.status}: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  assert(parsed.length === 0, `--sample-rate 0 should yield no patterns, got ${JSON.stringify(parsed)}`);
  if (!failed) console.log("PASS: --sample-rate 0 (boundary)");
}

async function testSampleRateOne() {
  const run = runCLI(["--sample-rate", "1", "--json"]);
  assert(run.status === 0, `--sample-rate 1 exited ${run.status}: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  const total = parsed.reduce((sum, e) => sum + e.count, 0);
  assert(total === 50, `--sample-rate 1 should see all 50 keys, got ${total}`);
  if (!failed) console.log("PASS: --sample-rate 1 (boundary)");
}

async function testInvalidFlagsRejected() {
  const cases = [
    { args: ["--sample-rate", "abc"], label: "non-numeric --sample-rate" },
    { args: ["--sample-rate", "-1"], label: "negative --sample-rate" },
    { args: ["--sample-rate", "1.5"], label: "out-of-range --sample-rate" },
    { args: ["--top", "abc"], label: "non-numeric --top" },
    { args: ["--top", "0"], label: "zero --top" },
    { args: ["--top", "5abc"], label: "--top with trailing garbage" },
    { args: ["--sample-rate", "0.5xyz"], label: "--sample-rate with trailing garbage" },
    { args: ["--sort", "banana"], label: "invalid --sort" },
  ];
  for (const c of cases) {
    const run = runCLI(c.args);
    assert(run.status !== 0, `${c.label} should exit non-zero, got ${run.status}`);
    assert(run.stdout === "", `${c.label} should not print a (misleadingly empty) table to stdout: ${run.stdout}`);
    assert(run.stderr.length > 0, `${c.label} should explain the error on stderr`);
  }
  if (!failed) console.log("PASS: invalid flag values are rejected, not silently swallowed");
}

async function testUnreachableHostFailsFast() {
  const start = Date.now();
  const result = spawnSync("node", [CLI, "redis://127.0.0.1:19999"], { encoding: "utf8", timeout: 8000 });
  const elapsed = Date.now() - start;
  assert(result.status !== 0, `unreachable host should exit non-zero, got ${result.status}`);
  assert(result.signal === null, `unreachable host should not be killed by timeout (signal=${result.signal}); CLI likely hung`);
  assert(elapsed < 8000, `unreachable host took too long to fail (${elapsed}ms) — looks like an infinite retry loop`);
  assert(/connection error/i.test(result.stderr), `expected a clean connection error message, got: ${result.stderr}`);
  if (!failed) console.log(`PASS: unreachable host fails fast and cleanly (${elapsed}ms)`);
}

async function testEmptyKeyspace() {
  const r = new Redis(REDIS_URL);
  await r.flushall();
  await r.quit();

  const table = runCLI([]);
  assert(table.status === 0, `empty keyspace table run exited ${table.status}: ${table.stderr}`);
  assert(!failed, "empty keyspace table run should not crash");

  const jsonRun = runCLI(["--json"]);
  assert(jsonRun.status === 0, `empty keyspace --json exited ${jsonRun.status}: ${jsonRun.stderr}`);
  const parsed = JSON.parse(jsonRun.stdout);
  assert(Array.isArray(parsed) && parsed.length === 0, `empty keyspace should yield [], got ${jsonRun.stdout}`);
  if (!failed) console.log("PASS: empty keyspace handled cleanly");

  // reseed for subsequent tests
  await seed();
}

async function testPagination() {
  const r = new Redis(REDIS_URL);
  await r.flushall();
  const pipe = r.pipeline();
  const N = 500; // forces multiple SCAN batches at COUNT 200
  for (let i = 0; i < N; i++) {
    pipe.set(`bulk:${i}`, "x");
  }
  await pipe.exec();
  await r.quit();

  const run = runCLI(["--json"]);
  assert(run.status === 0, `pagination run exited ${run.status}: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  const bulk = parsed.find((e) => e.pattern === "bulk:{n}");
  assert(bulk && bulk.count === N, `expected ${N} keys across SCAN batches, got ${bulk?.count}`);
  if (!failed) console.log("PASS: SCAN pagination across multiple batches");

  await seed();
}

async function testHelpAndVersion() {
  const help = runCLI(["--help"], { noUrl: true });
  assert(help.status === 0, `--help exited ${help.status}`);
  assert(/Usage:/.test(help.stdout), `--help should print usage: ${help.stdout}`);

  const version = runCLI(["--version"], { noUrl: true });
  assert(version.status === 0, `--version exited ${version.status}: ${version.stderr}`);
  assert(/^\d+\.\d+\.\d+/.test(version.stdout.trim()), `--version should print a semver, got: ${version.stdout}`);
  if (!failed) console.log("PASS: --help and --version");
}

async function main() {
  containerId = execSync(
    `docker run -d -p ${PORT}:6379 redis:7-alpine`,
    { encoding: "utf8" }
  ).trim();
  console.log(`Redis container: ${containerId.slice(0, 12)}`);

  // Wait for Redis to be ready (ponytail: busy-wait cap 5s, upgrade to healthcheck if flaky)
  for (let i = 0; i < 50; i++) {
    try {
      execSync(`docker exec ${containerId} redis-cli ping`, { stdio: "pipe" });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  await seed();

  await testGoldenPath();
  await testJsonOutput();
  await testPrefixFilter();
  await testTopAndSort();
  await testSampleRateZero();
  await testSampleRateOne();
  await testInvalidFlagsRejected();
  await testUnreachableHostFailsFast();
  await testEmptyKeyspace();
  await testPagination();
  await testHelpAndVersion();
}

main()
  .catch((err) => {
    console.error("E2E error:", err);
    failed = true;
  })
  .finally(() => {
    if (containerId) {
      try {
        execSync(`docker stop ${containerId} && docker rm ${containerId}`, { stdio: "pipe" });
        console.log("Redis container stopped");
      } catch {}
    }
    process.exit(failed ? 1 : 0);
  });
