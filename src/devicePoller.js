/**
 * Per-device Modbus polling with explicit lifecycle, fixed retry delay after failures,
 * and single-flight reads. Survives long meter/network outages without crashing.
 */

import { readMeterSnapshot } from "./modbus/pm5340Client.js";
import { READ_BLOCKS } from "./modbus/pm5340Map.js";
import { snapshotToTelemetryFields } from "./utils/registerConverters.js";

/** @typedef {'idle' | 'connecting' | 'online' | 'offline' | 'retrying'} DeviceLifecycleState */

/** Ceiling for one full snapshot (connect + all blocks); avoids a stuck library call freezing the poller. */
function pollHardCapMs(modbusTimeoutMs) {
  return modbusTimeoutMs * (READ_BLOCKS.length + 3) + 15_000;
}

const OFFLINE_ERRNO = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
]);

/**
 * @param {unknown} err
 * @returns {'offline' | 'comm_fault'}
 */
/** Compact snapshot for logs (avoid huge JSON every poll unless LOG_METER_READINGS). */
function readingsSummary(fields) {
  if (!fields || typeof fields !== "object") return {};
  const v = fields.phaseVoltageV;
  return {
    vLnA: v?.a,
    vLnB: v?.b,
    vLnC: v?.c,
    hz: fields.frequencyHz,
    kw: fields.totalActivePowerKw,
    kvar: fields.totalReactivePowerKvar,
    kva: fields.totalApparentPowerKva,
    pf: fields.powerFactorTotal,
    kwh: fields.totalEnergyKwh,
  };
}

export function classifyDeviceError(err) {
  const e = err && typeof err === "object" ? /** @type {Record<string, unknown>} */ (err) : {};
  const code = e.code || e.errno;
  const modbusCode = e.modbusCode;
  const msg = err instanceof Error ? err.message : String(err ?? "");

  if (typeof modbusCode === "number") {
    return "comm_fault";
  }
  if (OFFLINE_ERRNO.has(String(code))) {
    return "offline";
  }
  if (
    /ECONNRESET|socket hang up|EPIPE|ETIMEDOUT|timed out|hang up|broken pipe|Port Not Open|ECONNREFUSED/i.test(
      msg,
    )
  ) {
    return "offline";
  }
  if (/Modbus exception|Illegal data|Gateway path/i.test(msg)) {
    return "comm_fault";
  }
  return "offline";
}

/**
 * @param {object} params
 * @param {object} params.device
 * @param {object} params.config
 * @param {import('pino').Logger} params.logger
 * @param {ReturnType<import('./outageEngine.js').createOutageEngine>} params.outageEngine
 * @param {ReturnType<import('./publishers/telemetryPublisher.js').createTelemetryPublisher>} params.publisher
 */
export function startDeviceSession({ device, config, logger, outageEngine, publisher }) {
  const { pollIntervalMs, modbusTimeoutMs, modbusRetryMs, logMeterReadings } = config;

  /** @type {DeviceLifecycleState} */
  let lifecycle = "idle";
  let inFlight = false;
  /** @type {'online' | 'offline' | 'comm_fault' | null} */
  let lastPublishedLinkState = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  let clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  function setLifecycle(next) {
    if (lifecycle !== next) {
      logger.info(
        { event: "device_lifecycle", deviceCode: device.deviceCode, site: device.site, from: lifecycle, to: next },
        `device ${device.deviceCode}: ${lifecycle} -> ${next}`,
      );
    }
    lifecycle = next;
  }

  /**
   * Publish MQTT link state only on transitions (online/offline/comm_fault).
   * @param {'online' | 'offline' | 'comm_fault'} state
   * @param {object} [extra]
   */
  async function publishLinkTransition(state, extra = {}) {
    if (lastPublishedLinkState === state) {
      return;
    }
    try {
      await publisher.publishStatus(device, state, extra);
      lastPublishedLinkState = state;
      logger.info(
        { event: "mqtt_device_status", deviceCode: device.deviceCode, site: device.site, state },
        `published status ${state}`,
      );
    } catch (pubErr) {
      logger.error(
        {
          err: pubErr,
          deviceCode: device.deviceCode,
          event: "mqtt_status_publish_failed",
        },
        pubErr instanceof Error ? pubErr.message : String(pubErr),
      );
    }
  }

  async function runOnePollCycle() {
    if (inFlight) {
      logger.debug({ deviceCode: device.deviceCode, event: "poll_skipped_in_flight" }, "poll skipped: previous read running");
      scheduleNext(pollIntervalMs);
      return;
    }

    inFlight = true;
    try {
      // Steady-state polls stay "online" during the read; only show "connecting" after a fault recovery.
      if (lifecycle !== "online") {
        setLifecycle("connecting");
      }

      let snapshot;
      try {
        if (lifecycle !== "online") {
          logger.info(
            {
              event: "modbus_retry_attempt",
              deviceCode: device.deviceCode,
              site: device.site,
              host: device.host,
              port: device.port,
              unitId: device.unitId,
            },
            `retrying Modbus TCP connection to ${device.host}:${device.port} (unit ${device.unitId})`,
          );
        } else {
          logger.debug(
            { event: "modbus_read_start", deviceCode: device.deviceCode, site: device.site, host: device.host },
            "starting scheduled Modbus read",
          );
        }
        const cap = pollHardCapMs(modbusTimeoutMs);
        snapshot = await Promise.race([
          readMeterSnapshot({
            host: device.host,
            port: device.port,
            unitId: device.unitId,
            timeoutMs: modbusTimeoutMs,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Modbus poll exceeded hard cap (${cap}ms)`)), cap),
          ),
        ]);
      } catch (err) {
        const kind = classifyDeviceError(err);
        setLifecycle(kind === "offline" ? "offline" : "retrying");

        const wait = modbusRetryMs;

        const detail = err instanceof Error ? err.message : String(err);
        if (kind === "offline") {
          logger.warn(
            {
              err,
              event: "device_offline",
              deviceCode: device.deviceCode,
              site: device.site,
              kind,
              nextRetryMs: wait,
            },
            `device ${device.deviceCode}: link lost (${detail}) — will retry connection in ${wait}ms`,
          );
        } else {
          logger.warn(
            {
              err,
              event: "device_comm_fault",
              deviceCode: device.deviceCode,
              site: device.site,
              kind,
              nextRetryMs: wait,
            },
            `device ${device.deviceCode}: Modbus/comm fault (${detail}) — will retry in ${wait}ms`,
          );
        }

        const errnoVal = err instanceof Error && "code" in err ? String(/** @type {{ code?: string }} */ (err).code) : undefined;
        await publishLinkTransition(kind === "offline" ? "offline" : "comm_fault", {
          error: detail,
          ...(errnoVal ? { errno: errnoVal } : {}),
        });

        logger.info(
          {
            event: "device_retry_scheduled",
            deviceCode: device.deviceCode,
            site: device.site,
            delayMs: wait,
            modbusRetryMs,
          },
          `device ${device.deviceCode}: next connection attempt in ${wait}ms`,
        );
        scheduleNext(wait);
        return;
      }

      let fields;
      try {
        fields = snapshotToTelemetryFields(snapshot);
      } catch (err) {
        setLifecycle("retrying");
        const wait = modbusRetryMs;
        const detail = err instanceof Error ? err.message : String(err);

        logger.warn(
          {
            err,
            event: "register_decode_failed",
            deviceCode: device.deviceCode,
            site: device.site,
            nextRetryMs: wait,
          },
          `device ${device.deviceCode}: register decode failed (${detail}) — will retry in ${wait}ms`,
        );

        await publishLinkTransition("comm_fault", {
          error: detail,
        });

        logger.info(
          {
            event: "device_retry_scheduled",
            deviceCode: device.deviceCode,
            site: device.site,
            delayMs: wait,
            reason: "decode_error",
          },
          `device ${device.deviceCode}: next connection attempt in ${wait}ms`,
        );
        scheduleNext(wait);
        return;
      }

      setLifecycle("online");

      const phaseV = fields.phaseVoltageV;
      const now = Date.now();
      const outageEvt = outageEngine.update(device, phaseV, now);

      const wasDown =
        lastPublishedLinkState === "offline" || lastPublishedLinkState === "comm_fault";
      const summary = readingsSummary(fields);

      if (wasDown) {
        logger.info(
          {
            event: "device_reconnected",
            deviceCode: device.deviceCode,
            site: device.site,
            readingsSummary: summary,
          },
          `device ${device.deviceCode}: reconnected — live data resumed (VLN V, kW, Hz in readingsSummary)`,
        );
      }

      logger.debug(
        {
          event: "modbus_read_ok",
          deviceCode: device.deviceCode,
          site: device.site,
          recovered: wasDown,
        },
        "Modbus read OK",
      );

      if (logMeterReadings) {
        logger.info(
          {
            event: "meter_readings",
            deviceCode: device.deviceCode,
            site: device.site,
            readings: fields,
          },
          `device ${device.deviceCode}: full decoded telemetry`,
        );
      } else {
        logger.info(
          {
            event: "meter_live_snapshot",
            deviceCode: device.deviceCode,
            site: device.site,
            readingsSummary: summary,
          },
          `device ${device.deviceCode}: live readings`,
        );
      }

      try {
        await publisher.publishTelemetry(device, fields);
        await publishLinkTransition("online", {});
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

      scheduleNext(pollIntervalMs);
    } finally {
      inFlight = false;
    }
  }

  /**
   * Single timer per device — no overlapping schedules.
   * @param {number} delayMs
   */
  function scheduleNext(delayMs) {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void runOnePollCycle().catch((e) => {
        logger.error(
          { err: e, deviceCode: device.deviceCode, event: "poll_cycle_fatal", site: device.site },
          e instanceof Error ? e.message : String(e),
        );
        scheduleNext(modbusRetryMs);
      });
    }, delayMs);
  }

  logger.info({ event: "device_session_start", deviceCode: device.deviceCode, site: device.site }, "device session started");
  scheduleNext(0);

  return function stopDeviceSession() {
    clearTimer();
    logger.info({ event: "device_session_stop", deviceCode: device.deviceCode, site: device.site }, "device session stopped");
  };
}
