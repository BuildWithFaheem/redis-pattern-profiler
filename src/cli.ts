#!/usr/bin/env node
import { readFileSync } from "fs";
import { join } from "path";
import { Command } from "commander";
import { createClient } from "./redis";
import { scan } from "./scanner";
import { profile } from "./profiler";
import { report } from "./reporter";

const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"));

const program = new Command();

program
  .name("redis-pattern-profiler")
  .description("Scan Redis keyspace and aggregate MEMORY USAGE per key pattern")
  .version(pkg.version)
  .argument("[redis-url]", "Redis URL", "redis://localhost:6379")
  .option("--prefix <string>", "scan only keys with this prefix")
  .option("--sample-rate <number>", "probabilistic sampling fraction (0-1)", "1.0")
  .option("--top <number>", "show top N patterns", "20")
  .option("--sort <bytes|count>", "sort by bytes or count", "bytes")
  .option("--json", "emit JSON output")
  .action(async (redisUrl: string, opts) => {
    const sampleRate = parseFloat(opts.sampleRate);
    if (Number.isNaN(sampleRate) || sampleRate < 0 || sampleRate > 1) {
      process.stderr.write(`Invalid --sample-rate '${opts.sampleRate}': must be a number between 0 and 1\n`);
      process.exitCode = 1;
      return;
    }

    const top = parseInt(opts.top, 10);
    if (Number.isNaN(top) || top < 1) {
      process.stderr.write(`Invalid --top '${opts.top}': must be a positive integer\n`);
      process.exitCode = 1;
      return;
    }

    if (opts.sort !== "bytes" && opts.sort !== "count") {
      process.stderr.write(`Invalid --sort '${opts.sort}': must be 'bytes' or 'count'\n`);
      process.exitCode = 1;
      return;
    }

    const client = createClient(redisUrl);

    try {
      await client.ping();
    } catch (err) {
      process.stderr.write(`Connection error: ${(err as Error).message}\n`);
      client.disconnect();
      process.exitCode = 1;
      return;
    }

    const batches = scan(client, {
      prefix: opts.prefix,
      sampleRate,
      count: 200,
    });

    const result = await profile(client, batches);

    report(result, {
      top,
      sort: opts.sort as "bytes" | "count",
      json: !!opts.json,
    });

    client.disconnect();
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exitCode = 1;
});
