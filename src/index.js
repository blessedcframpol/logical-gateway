import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createMqttClient } from "./mqttClient.js";
import { startDeviceSession } from "./devicePoller.js";
import { createOutageEngine } from "./outageEngine.js";
import { createTelemetryPublisher } from "./publishers/telemetryPublisher.js";

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    const boot = createLogger(process.env.LOG_LEVEL?.trim() || "error");
    boot.fatal({ err, event: "config_error" }, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);

  const mqttApi = createMqttClient({
    url: config.mqttUrl,
    logger,
    username: config.mqttUsername,
    password: config.mqttPassword,
  });
  try {
    await mqttApi.waitForConnection(30_000);
  } catch (err) {
    logger.fatal({ err, event: "mqtt_initial_connect_failed" }, err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const outageEngine = createOutageEngine({
    confirmMs: config.outageConfirmMs,
    voltageThresholdV: config.outageVoltageThresholdV,
  });
  const publisher = createTelemetryPublisher(mqttApi);

  logger.info(
    {
      event: "gateway_started",
      deviceCount: config.devices.length,
      pollIntervalMs: config.pollIntervalMs,
      mqttUrl: config.mqttUrl,
      mqttAuth: Boolean(config.mqttUsername),
    },
    "logical gateway running",
  );

  const stopSessions = config.devices.map((device) =>
    startDeviceSession({
      device,
      config,
      logger,
      outageEngine,
      publisher,
    }),
  );

  const shutdown = async (signal) => {
    logger.info({ event: "shutdown", signal }, "stopping");
    for (const stop of stopSessions) stop();
    await mqttApi.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * Device Modbus/MQTT paths must never take down the whole gateway. Log unexpected faults for ops.
 * Intentionally no process.exit — MQTT keeps reconnecting; device loops self-heal.
 */
process.on("uncaughtException", (err) => {
  const log = createLogger(process.env.LOG_LEVEL?.trim() || "error");
  log.error({ err, event: "uncaught_exception" }, err?.message || String(err));
});

process.on("unhandledRejection", (reason) => {
  const log = createLogger(process.env.LOG_LEVEL?.trim() || "error");
  const msg = reason instanceof Error ? reason.message : String(reason);
  log.error({ err: reason, event: "unhandled_rejection" }, msg);
});

main().catch((err) => {
  const log = createLogger(process.env.LOG_LEVEL?.trim() || "error");
  log.fatal({ err, event: "main_failed" }, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
