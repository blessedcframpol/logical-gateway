/**
 * @param {string} site
 * @param {string} deviceCode
 */
export function telemetryTopic(site, deviceCode) {
  return `power/${site}/${deviceCode}/telemetry`;
}

export function statusTopic(site, deviceCode) {
  return `power/${site}/${deviceCode}/status`;
}

export function outageTopic(site, deviceCode) {
  return `power/${site}/${deviceCode}/outage`;
}

/**
 * @param {{ publishJson: (topic: string, payload: object, opts?: object) => Promise<void> }} mqttApi
 */
export function createTelemetryPublisher(mqttApi) {
  const { publishJson } = mqttApi;

  const waitTelemetry = { waitForMs: 90_000 };
  const waitStatus = { waitForMs: 12_000 };

  /**
   * @param {object} device
   * @param {object} fields
   */
  async function publishTelemetry(device, fields) {
    const payload = {
      deviceCode: device.deviceCode,
      name: device.name,
      site: device.site,
      timestamp: new Date().toISOString(),
      ...fields,
    };
    await publishJson(telemetryTopic(device.site, device.deviceCode), payload, waitTelemetry);
  }

  /**
   * @param {object} device
   * @param {'online' | 'offline' | 'comm_fault'} state
   * @param {object} [extra]
   */
  async function publishStatus(device, state, extra = {}) {
    const payload = {
      deviceCode: device.deviceCode,
      name: device.name,
      site: device.site,
      state,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    await publishJson(statusTopic(device.site, device.deviceCode), payload, waitStatus);
  }

  /**
   * @param {object} device
   * @param {object} outagePayload
   */
  async function publishOutage(device, outagePayload) {
    await publishJson(outageTopic(device.site, device.deviceCode), outagePayload, waitTelemetry);
  }

  return { publishTelemetry, publishStatus, publishOutage };
}
