import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createMqttClient } from "./mqttClient.js";
import { createOutageEngine } from "./outageEngine.js";
import { createTelemetryPublisher } from "./publishers/telemetryPublisher.js";
import { createDeviceRegistry } from "./deviceRegistry.js";
import { startDeviceWatcher } from "./deviceWatcher.js";
import { fetchMetersFromSupabase } from "./supabaseDevices.js";

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
  const registry = createDeviceRegistry({ config, logger, outageEngine, publisher });

  // Initial load — fail fast if Supabase is unreachable, matching prior behaviour.
  try {
    const initial = await fetchMetersFromSupabase(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      config.supabase.table,
    );
    registry.reconcile(initial);
  } catch (err) {
    logger.fatal(
      { err, event: "initial_devices_load_failed" },
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }

  const stopWatcher = startDeviceWatcher({
    registry,
    logger,
    supabase: config.supabase,
    reloadIntervalMs: config.deviceReloadIntervalMs,
    realtime: config.deviceRealtime,
  });

  logger.info(
    {
      event: "gateway_started",
      deviceCount: registry.size(),
      pollIntervalMs: config.pollIntervalMs,
      mqttUrl: config.mqttUrl,
      mqttAuth: Boolean(config.mqttUsername),
      reloadIntervalMs: config.deviceReloadIntervalMs,
      realtime: config.deviceRealtime,
    },
    "logical gateway running",
  );

  const shutdown = async (signal) => {
    logger.info({ event: "shutdown", signal }, "stopping");
    await stopWatcher();
    registry.stopAll();
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
