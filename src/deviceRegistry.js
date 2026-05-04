/**
 * Owns the running set of device sessions and reconciles them against a fresh
 * device list from Supabase. Decides what to start, stop, or restart based on
 * which fields actually affect the Modbus connection.
 */

import { startDeviceSession } from "./devicePoller.js";

/** Fields whose change requires tearing down and restarting the session. */
const CONNECTION_FIELDS = ["host", "port", "unitId"];

/**
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function connectionDetailsChanged(a, b) {
  return CONNECTION_FIELDS.some((f) => a[f] !== b[f]);
}

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {import('pino').Logger} deps.logger
 * @param {ReturnType<import('./outageEngine.js').createOutageEngine>} deps.outageEngine
 * @param {ReturnType<import('./publishers/telemetryPublisher.js').createTelemetryPublisher>} deps.publisher
 */
export function createDeviceRegistry({ config, logger, outageEngine, publisher }) {
  /** @type {Map<string, { device: object; stop: () => void }>} */
  const sessions = new Map();

  function keyOf(device) {
    return `${device.site}:${device.deviceCode}`;
  }

  function startOne(device) {
    const stop = startDeviceSession({ device, config, logger, outageEngine, publisher });
    sessions.set(keyOf(device), { device, stop });
  }

  function stopOne(key) {
    const s = sessions.get(key);
    if (!s) return;
    s.stop();
    sessions.delete(key);
  }

  /**
   * Reconcile running sessions with the latest device list.
   *
   * @param {Array<object>} freshDevices
   * @returns {{ started: number; stopped: number; restarted: number }}
   */
  function reconcile(freshDevices) {
    const freshMap = new Map(freshDevices.map((d) => [keyOf(d), d]));
    let started = 0;
    let stopped = 0;
    let restarted = 0;

    // 1. Stop sessions for devices that have been removed or disabled.
    for (const key of [...sessions.keys()]) {
      if (!freshMap.has(key)) {
        const { device } = sessions.get(key);
        logger.info(
          { event: "device_removed", deviceCode: device.deviceCode, site: device.site },
          `device removed (or disabled) — stopping session`,
        );
        stopOne(key);
        stopped += 1;
      }
    }

    // 2. Start new devices and restart any whose connection details changed.
    for (const [key, device] of freshMap) {
      const existing = sessions.get(key);
      if (!existing) {
        logger.info(
          {
            event: "device_added",
            deviceCode: device.deviceCode,
            site: device.site,
            host: device.host,
          },
          "new device — starting session",
        );
        startOne(device);
        started += 1;
        continue;
      }

      if (connectionDetailsChanged(existing.device, device)) {
        logger.info(
          {
            event: "device_changed",
            deviceCode: device.deviceCode,
            site: device.site,
            from: {
              host: existing.device.host,
              port: existing.device.port,
              unitId: existing.device.unitId,
            },
            to: { host: device.host, port: device.port, unitId: device.unitId },
          },
          "device connection details changed — restarting session",
        );
        stopOne(key);
        startOne(device);
        restarted += 1;
        continue;
      }

      // No connection change — refresh stored device metadata in case
      // cosmetic fields (name) changed; nothing else to do.
      existing.device = device;
    }

    return { started, stopped, restarted };
  }

  function stopAll() {
    for (const key of [...sessions.keys()]) {
      stopOne(key);
    }
  }

  function size() {
    return sessions.size;
  }

  return { reconcile, stopAll, size };
}
