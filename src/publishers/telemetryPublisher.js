/**
 * Convert a human-readable string to a topic-safe slug.
 * Rule: lowercase, any run of non-alphanumeric becomes a single hyphen,
 * strip leading/trailing hyphens.
 * Examples:
 *   "Power Room"      -> "power-room"
 *   "Dev Office"      -> "dev-office"
 *   "Site #2 (West)"  -> "site-2-west"
 *   "  Houses 1-4  "  -> "houses-1-4"
 */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} orgSlug
 * @param {string} siteSlug
 * @param {string} deviceCode
 */
export function telemetryTopic(orgSlug, siteSlug, deviceCode) {
  return `power/${orgSlug}/${siteSlug}/${deviceCode}/telemetry`;
}

/**
 * @param {string} orgSlug
 * @param {string} siteSlug
 * @param {string} deviceCode
 */
export function statusTopic(orgSlug, siteSlug, deviceCode) {
  return `power/${orgSlug}/${siteSlug}/${deviceCode}/status`;
}

/**
 * @param {string} orgSlug
 * @param {string} siteSlug
 * @param {string} deviceCode
 */
export function outageTopic(orgSlug, siteSlug, deviceCode) {
  return `power/${orgSlug}/${siteSlug}/${deviceCode}/outage`;
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
    const siteSlug = slugify(device.site);
    await publishJson(
      telemetryTopic(device.orgSlug, siteSlug, device.deviceCode),
      payload,
      waitTelemetry,
    );
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
    const siteSlug = slugify(device.site);
    await publishJson(
      statusTopic(device.orgSlug, siteSlug, device.deviceCode),
      payload,
      waitStatus,
    );
  }

  /**
   * @param {object} device
   * @param {object} outagePayload
   */
  async function publishOutage(device, outagePayload) {
    const siteSlug = slugify(device.site);
    await publishJson(
      outageTopic(device.orgSlug, siteSlug, device.deviceCode),
      outagePayload,
      waitTelemetry,
    );
  }

  return { publishTelemetry, publishStatus, publishOutage };
}
