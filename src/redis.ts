import Redis from "ioredis";

export function createClient(url: string): Redis {
  return new Redis(url, { lazyConnect: false, enableReadyCheck: true });
}
