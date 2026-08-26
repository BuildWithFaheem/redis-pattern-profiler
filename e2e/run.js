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

function runCLI(args) {
  return spawnSync("node", [CLI, REDIS_URL, ...args], { encoding: "utf8" });
}

async function main() {
  // Start Redis
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

  // Test 1: table output
  const table = runCLI([]);
  assert(table.status === 0, `CLI exited ${table.status}: ${table.stderr}`);
  const out = table.stdout;
  const patterns = ["user:{n}", "session:{n}", "cache:{n}"];
  for (const p of patterns) {
    assert(out.includes(p), `table missing pattern '${p}'\n${out}`);
  }
  // Each pattern row must have a nonzero byte value (e.g. "512B" or "3.2KB")
  assert(/\d+(\.\d+)?\s?[KMGT]?B\b/.test(out), `no byte values in table output\n${out}`);
  // TTL% column exists (user and cache have TTL, session does not)
  assert(out.includes("%"), `no TTL% column in output\n${out}`);
  if (!failed) console.log("PASS: table output");

  // Test 2: --json output
  const jsonRun = runCLI(["--json"]);
  assert(jsonRun.status === 0, `--json exited ${jsonRun.status}: ${jsonRun.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(jsonRun.stdout);
  } catch (e) {
    fail(`--json output is not valid JSON: ${jsonRun.stdout}`);
  }
  if (parsed) {
    assert(Array.isArray(parsed), "JSON output is not an array");
    assert(parsed.length === 3, `expected 3 entries, got ${parsed.length}`);
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
    if (!failed) console.log("PASS: --json output");
  }
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
