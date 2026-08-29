import Redis from "ioredis";

export function createClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: false,
    enableReadyCheck: true,
    connectTimeout: 2000,
    // ponytail: fail fast after a few attempts instead of ioredis's default infinite reconnect loop
    retryStrategy: (times) => (times >= 3 ? null : Math.min(times * 200, 1000)),
  });
  // Connection failures surface via the ping()/command promise rejection in cli.ts;
  // this listener only stops ioredis from logging "Unhandled error event" to stderr.
  client.on("error", () => {});
  return client;
}
