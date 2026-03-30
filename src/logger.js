import pino from "pino";

export function createLogger(level = "info") {
  return pino({
    level,
    base: { service: "logical-gateway" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
