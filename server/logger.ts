export const logger = {
  info(event: string, meta: Record<string, unknown> = {}) {
    console.log(`[INFO] ${new Date().toISOString()} - ${event}`, JSON.stringify(meta));
  },
  warn(event: string, meta: Record<string, unknown> = {}) {
    console.warn(`[WARN] ${new Date().toISOString()} - ${event}`, JSON.stringify(meta));
  },
  error(event: string, meta: Record<string, unknown> = {}) {
    console.error(`[ERROR] ${new Date().toISOString()} - ${event}`, JSON.stringify(meta));
  }
};
