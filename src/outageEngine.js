/**
 * Per-device outage state: all three phase voltages below threshold for OUTAGE_CONFIRM_MS.
 */

/**
 * @typedef {'outage_confirmed' | 'outage_cleared'} OutageEventType
 */

/**
 * @typedef {object} OutageEventPayload
 * @property {OutageEventType} event
 * @property {string} deviceCode
 * @property {string} name
 * @property {string} site
 * @property {string} timestamp
 * @property {number} [thresholdV]
 * @property {{ a: number; b: number; c: number }} [phaseVoltageV]
 */

function deviceKey(device) {
  return `${device.site}:${device.deviceCode}`;
}

export function createOutageEngine({ confirmMs, voltageThresholdV }) {
  /** @type {Map<string, { pendingSince: number | null; confirmed: boolean }>} */
  const state = new Map();

  function getOrInit(key) {
    let s = state.get(key);
    if (!s) {
      s = { pendingSince: null, confirmed: false };
      state.set(key, s);
    }
    return s;
  }

  /**
   * @param {object} device
   * @param {{ a: number; b: number; c: number }} phaseVoltageV
   * @param {number} nowMs
   * @returns {OutageEventPayload | null}
   */
  function update(device, phaseVoltageV, nowMs) {
    const key = deviceKey(device);
    const s = getOrInit(key);
    const { a: va, b: vb, c: vc } = phaseVoltageV;
    const allLow = va < voltageThresholdV && vb < voltageThresholdV && vc < voltageThresholdV;

    const ts = new Date(nowMs).toISOString();

    if (allLow) {
      if (s.pendingSince === null) {
        s.pendingSince = nowMs;
      }
      const elapsed = nowMs - s.pendingSince;
      if (elapsed >= confirmMs && !s.confirmed) {
        s.confirmed = true;
        return {
          event: "outage_confirmed",
          deviceCode: device.deviceCode,
          name: device.name,
          site: device.site,
          timestamp: ts,
          thresholdV: voltageThresholdV,
          phaseVoltageV: { a: va, b: vb, c: vc },
        };
      }
      return null;
    }

    // Not all phases low: clear pending timer
    s.pendingSince = null;

    if (s.confirmed) {
      s.confirmed = false;
      return {
        event: "outage_cleared",
        deviceCode: device.deviceCode,
        name: device.name,
        site: device.site,
        timestamp: ts,
        thresholdV: voltageThresholdV,
        phaseVoltageV: { a: va, b: vb, c: vc },
      };
    }

    return null;
  }

  return { update };
}
