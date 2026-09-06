import redisDriver from 'unstorage/drivers/redis';

/**
 * Mounts the 'kv' storage namespace (tenant configs, webhook dedup — see
 * server/utils/tenant.ts, server/utils/webhook-handler.ts) at container
 * start.
 *
 * This deliberately does not live in nuxt.config.ts. `nitro.storage` is
 * serialized into .output/server when the image is built, so a mount
 * decided there reads the *build* container's environment — which has no
 * NUXT_STORAGE_* set — and bakes `memory` in permanently. The runtime env
 * var would then still override `runtimeConfig.storage.driver`, so the app
 * reports 'redis' while every write goes to an in-process Map that the next
 * restart discards. Mounting here reads the environment the server actually
 * runs in, and keeps the connection string out of the image so one built
 * artifact can be promoted across environments.
 *
 * Misconfiguration fails the process rather than falling back to memory: a
 * silent fallback in production is indistinguishable from a working
 * deployment right up until a restart wipes every onboarded tenant.
 */
export default defineNitroPlugin(() => {
  const driver = process.env.NUXT_STORAGE_DRIVER || 'memory';

  // nitro.storage already mounts 'kv' as memory, so there is nothing to do.
  if (driver === 'memory') return;

  if (driver !== 'redis') {
    throw new Error(
      `Unknown NUXT_STORAGE_DRIVER: "${driver}". Expected "memory" or "redis".`,
    );
  }

  const url = process.env.NUXT_STORAGE_REDIS_URL;
  if (!url) {
    throw new Error(
      'NUXT_STORAGE_DRIVER=redis but NUXT_STORAGE_REDIS_URL is not set. ' +
        'Refusing to silently fall back to in-memory storage in this mode — ' +
        'set the URL or unset NUXT_STORAGE_DRIVER.',
    );
  }

  // `base` is the Redis key prefix, unrelated to the 'kv' mount point.
  useStorage().mount('kv', redisDriver({ url, base: 'kv' }));
});
