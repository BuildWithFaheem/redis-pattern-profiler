#!/usr/bin/env node
import { Command } from "commander";
import { createClient } from "./redis";
import { scan } from "./scanner";
import { profile } from "./profiler";
import { report } from "./reporter";

const program = new Command();

program
  .name("redis-pattern-profiler")
  .description("Scan Redis keyspace and aggregate MEMORY USAGE per key pattern")
  .argument("[redis-url]", "Redis URL", "redis://localhost:6379")
  .option("--prefix <string>", "scan only keys with this prefix")
  .option("--sample-rate <number>", "probabilistic sampling fraction (0-1)", "1.0")
  .option("--top <number>", "show top N patterns", "20")
  .option("--sort <bytes|count>", "sort by bytes or count", "bytes")
  .option("--json", "emit JSON output")
  .action(async (redisUrl: string, opts) => {
    const client = createClient(redisUrl);

    try {
      await client.ping();
    } catch (err) {
      process.stderr.write(`Connection error: ${(err as Error).message}\n`);
      client.disconnect();
      process.exit(1);
    }

    const sampleRate = parseFloat(opts.sampleRate);
    const batches = scan(client, {
      prefix: opts.prefix,
      sampleRate,
      count: 200,
    });

    const result = await profile(client, batches);

    report(result, {
      top: parseInt(opts.top, 10),
      sort: opts.sort as "bytes" | "count",
      json: !!opts.json,
    });

    client.disconnect();
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
});
