import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createMqttClient } from "./mqttClient.js";
import { readMeterSnapshot } from "./modbus/pm5340Client.js";
import { snapshotToTelemetryFields } from "./utils/registerConverters.js";
import { createOutageEngine } from "./outageEngine.js";
import { createTelemetryPublisher } from "./publishers/telemetryPublisher.js";

function startDevicePoller(device, config, logger, mqttApi, outageEngine, publisher) {
  const { pollIntervalMs, modbusTimeoutMs, logMeterReadings } = config;

  async function tick() {
    let snapshot;
    try {
      snapshot = await readMeterSnapshot({
        host: device.host,
        port: device.port,
        unitId: device.unitId,
        timeoutMs: modbusTimeoutMs,
      });
    } catch (err) {
      logger.error(
        {
          err,
          deviceCode: device.deviceCode,
          site: device.site,
          event: "modbus_poll_failed",
        },
        err instanceof Error ? err.message : String(err),
      );
      try {
        await publisher.publishStatus(device, "comm_fault", {
          error: err instanceof Error ? err.message : String(err),
        });
      } catch (pubErr) {
        logger.error(
          {
            err: pubErr,
            deviceCode: device.deviceCode,
            event: "status_publish_failed",
          },
          pubErr instanceof Error ? pubErr.message : String(pubErr),
        );
      }
      return;
    }

    let fields;
    try {
      fields = snapshotToTelemetryFields(snapshot);
    } catch (err) {
      logger.error(
        {
          err,
          deviceCode: device.deviceCode,
          site: device.site,
          event: "register_decode_failed",
        },
        err instanceof Error ? err.message : String(err),
      );
      try {
        await publisher.publishStatus(device, "comm_fault", {
          error: err instanceof Error ? err.message : String(err),
        });
      } catch (pubErr) {
        logger.error(
          { err: pubErr, deviceCode: device.deviceCode, event: "status_publish_failed" },
          pubErr instanceof Error ? pubErr.message : String(pubErr),
        );
      }
      return;
    }

    const phaseV = fields.phaseVoltageV;
    const now = Date.now();
    const outageEvt = outageEngine.update(device, phaseV, now);

    if (logMeterReadings) {
      logger.info(
        {
          event: "meter_readings",
          deviceCode: device.deviceCode,
          site: device.site,
          readings: fields,
        },
        "decoded Modbus telemetry",
      );
    }

    try {
      await publisher.publishTelemetry(device, fields);
      await publisher.publishStatus(device, "online");
      if (outageEvt) {
        await publisher.publishOutage(device, outageEvt);
      }
    } catch (pubErr) {
      logger.error(
        {
          err: pubErr,
          deviceCode: device.deviceCode,
          site: device.site,
          event: "mqtt_publish_failed",
        },
        pubErr instanceof Error ? pubErr.message : String(pubErr),
      );
    }
  }

  let locked = false;
  const handle = setInterval(() => {
    if (locked) {
      logger.debug({ deviceCode: device.deviceCode, event: "poll_skipped_overlap" }, "previous poll still running");
      return;
    }
    locked = true;
    tick()
      .catch((e) => {
        logger.error(
          { err: e, deviceCode: device.deviceCode, event: "poll_tick_unexpected" },
          e instanceof Error ? e.message : String(e),
        );
      })
      .finally(() => {
        locked = false;
      });
  }, pollIntervalMs);

  setImmediate(() => {
    locked = true;
    tick()
      .catch((e) => {
        logger.error(
          { err: e, deviceCode: device.deviceCode, event: "initial_poll_unexpected" },
          e instanceof Error ? e.message : String(e),
        );
      })
      .finally(() => {
        locked = false;
      });
  });

  return handle;
}

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

  const handles = config.devices.map((device) =>
    startDevicePoller(device, config, logger, mqttApi, outageEngine, publisher),
  );

  const shutdown = async (signal) => {
    logger.info({ event: "shutdown", signal }, "stopping");
    for (const h of handles) clearInterval(h);
    await mqttApi.end();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("uncaughtException", (err) => {
  const log = createLogger(process.env.LOG_LEVEL?.trim() || "error");
  log.fatal({ err, event: "uncaught_exception" }, err.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const log = createLogger(process.env.LOG_LEVEL?.trim() || "error");
  log.fatal({ err: reason, event: "unhandled_rejection" }, String(reason));
  process.exit(1);
});

main().catch((err) => {
  const log = createLogger(process.env.LOG_LEVEL?.trim() || "error");
  log.fatal({ err, event: "main_failed" }, err instanceof Error ? err.message : String(err));
  process.exit(1);
});
