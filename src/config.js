import "dotenv/config";

const REQUIRED_DEVICE_KEYS = ["deviceCode", "name", "site", "host", "port", "unitId"];

function envBool(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

function parsePositiveInt(name, raw, fallback) {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${name}: must be a positive integer`);
  }
  return n;
}

function parseDevices(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    throw new Error("DEVICES is required (JSON array of meter objects)");
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (e) {
    throw new Error(`DEVICES must be valid JSON: ${e.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("DEVICES must be a JSON array");
  }
  if (parsed.length === 0) {
    throw new Error("DEVICES must contain at least one meter");
  }
  return parsed.map((d, i) => {
    if (!d || typeof d !== "object") {
      throw new Error(`DEVICES[${i}] must be an object`);
    }
    for (const k of REQUIRED_DEVICE_KEYS) {
      if (d[k] === undefined || d[k] === null || d[k] === "") {
        throw new Error(`DEVICES[${i}] missing required field: ${k}`);
      }
    }
    const port = Number.parseInt(String(d.port), 10);
    const unitId = Number.parseInt(String(d.unitId), 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(`DEVICES[${i}].port must be a valid TCP port`);
    }
    if (!Number.isFinite(unitId) || unitId < 0 || unitId > 255) {
      throw new Error(`DEVICES[${i}].unitId must be 0-255`);
    }
    return {
      deviceCode: String(d.deviceCode),
      name: String(d.name),
      site: String(d.site),
      host: String(d.host),
      port,
      unitId,
    };
  });
}

/**
 * @returns {{ mqttUsername?: string; mqttPassword?: string }}
 */
function parseMqttAuth() {
  const userRaw = process.env.MQTT_USERNAME;
  const passRaw = process.env.MQTT_PASSWORD;
  const username = userRaw !== undefined && userRaw !== null ? String(userRaw).trim() : "";
  const hasUsername = username.length > 0;
  const hasPasswordEnv = Object.prototype.hasOwnProperty.call(process.env, "MQTT_PASSWORD");

  if (hasUsername && !hasPasswordEnv) {
    throw new Error("MQTT_PASSWORD is required when MQTT_USERNAME is set");
  }
  if (!hasUsername && hasPasswordEnv && String(passRaw ?? "").length > 0) {
    throw new Error("MQTT_USERNAME is required when MQTT_PASSWORD is set");
  }
  if (!hasUsername) {
    return {};
  }
  return {
    mqttUsername: username,
    mqttPassword: passRaw === undefined || passRaw === null ? "" : String(passRaw),
  };
}

export function loadConfig() {
  const mqttUrl = process.env.MQTT_URL?.trim() || "mqtt://127.0.0.1:1883";
  const { mqttUsername, mqttPassword } = parseMqttAuth();
  const pollIntervalMs = parsePositiveInt("POLL_INTERVAL_MS", process.env.POLL_INTERVAL_MS, 5000);
  const outageConfirmMs = parsePositiveInt("OUTAGE_CONFIRM_MS", process.env.OUTAGE_CONFIRM_MS, 30000);
  const modbusTimeoutMs = parsePositiveInt("MODBUS_TIMEOUT_MS", process.env.MODBUS_TIMEOUT_MS, 3000);
  const logLevel = process.env.LOG_LEVEL?.trim() || "info";
  const logMeterReadings = envBool("LOG_METER_READINGS", true);

  const devices = parseDevices(process.env.DEVICES);

  return {
    mqttUrl,
    mqttUsername,
    mqttPassword,
    pollIntervalMs,
    outageConfirmMs,
    modbusTimeoutMs,
    logLevel,
    logMeterReadings,
    devices,
    /** Phase voltages below this (volts) count toward outage when all phases are low */
    outageVoltageThresholdV: 20,
  };
}
