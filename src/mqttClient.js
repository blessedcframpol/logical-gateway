import mqtt from "mqtt";

const MQTT_QOS = 1;

/**
 * @param {object} opts
 * @param {string} opts.url
 * @param {import('pino').Logger} opts.logger
 * @param {string} [opts.username]
 * @param {string} [opts.password]
 */
export function createMqttClient({ url, logger, username, password }) {
  const clientId = `logical-gateway-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

  /** @type {import('mqtt').IClientOptions} */
  const options = {
    clientId,
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10_000,
    protocolVersion: 4,
  };
  if (username !== undefined && username !== "") {
    options.username = username;
    options.password = password ?? "";
  }

  const client = mqtt.connect(url, options);

  client.on("connect", () => {
    logger.info({
      event: "mqtt_connected",
      url,
      mqttAuth: Boolean(username),
    });
  });

  client.on("reconnect", () => {
    logger.warn({ event: "mqtt_reconnecting", url });
  });

  client.on("close", () => {
    logger.warn({ event: "mqtt_closed", url });
  });

  client.on("offline", () => {
    logger.warn({ event: "mqtt_offline", url });
  });

  client.on("error", (err) => {
    logger.error({ err, event: "mqtt_error", url }, err.message);
  });

  const publishWaitPollMs = 250;

  /**
   * Publish JSON at QoS 1. If the broker dropped temporarily, waits until reconnect or timeout
   * so device status/telemetry can outlive brief MQTT outages without throwing immediately.
   *
   * @param {string} topic
   * @param {object} payload
   * @param {{ waitForMs?: number }} [opts]
   * @returns {Promise<void>}
   */
  function publishJson(topic, payload, opts = {}) {
    const waitForMs = opts.waitForMs ?? 60_000;
    const body = JSON.stringify(payload);
    const deadline = Date.now() + waitForMs;

    return new Promise((resolve, reject) => {
      function attempt() {
        if (client.connected) {
          client.publish(topic, body, { qos: MQTT_QOS }, (err) => {
            if (err) reject(err);
            else resolve();
          });
          return;
        }
        if (Date.now() >= deadline) {
          reject(new Error(`MQTT publish timeout after ${waitForMs}ms (not connected)`));
          return;
        }
        setTimeout(attempt, publishWaitPollMs);
      }
      attempt();
    });
  }

  /**
   * @param {number} [timeoutMs=30000]
   * @returns {Promise<void>}
   */
  function waitForConnection(timeoutMs = 30_000) {
    if (client.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        reject(new Error(`MQTT connect timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      function cleanup() {
        clearTimeout(t);
        client.off("connect", onConnect);
        client.off("error", onErr);
      }

      function onConnect() {
        cleanup();
        resolve();
      }

      function onErr(err) {
        cleanup();
        reject(err);
      }

      client.once("connect", onConnect);
      client.once("error", onErr);
    });
  }

  return {
    client,
    publishJson,
    waitForConnection,
    end: () =>
      new Promise((resolve) => {
        client.end(false, {}, () => resolve());
      }),
  };
}
