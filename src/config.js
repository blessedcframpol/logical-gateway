import "dotenv/config";
import { fetchMetersFromSupabase } from "./supabaseDevices.js";

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

async function loadDevicesFromSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? "";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const table =
    process.env.SUPABASE_DEVICES_TABLE?.trim() ||
    process.env.SUPABASE_GATEWAY_DEVICES_TABLE?.trim() ||
    "devices";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Meters are loaded only from Supabase: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role; server-side only)",
    );
  }

  return fetchMetersFromSupabase(supabaseUrl, supabaseKey, table);
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

export async function loadConfig() {
  const mqttUrl = process.env.MQTT_URL?.trim() || "mqtt://127.0.0.1:1883";
  const { mqttUsername, mqttPassword } = parseMqttAuth();
  const pollIntervalMs = parsePositiveInt("POLL_INTERVAL_MS", process.env.POLL_INTERVAL_MS, 5000);
  const outageConfirmMs = parsePositiveInt("OUTAGE_CONFIRM_MS", process.env.OUTAGE_CONFIRM_MS, 30000);
  const modbusTimeoutMs = parsePositiveInt("MODBUS_TIMEOUT_MS", process.env.MODBUS_TIMEOUT_MS, 3000);
  const modbusRetryMs = parsePositiveInt("MODBUS_RETRY_MS", process.env.MODBUS_RETRY_MS, 3000);
  const logLevel = process.env.LOG_LEVEL?.trim() || "info";
  const logMeterReadings = envBool("LOG_METER_READINGS", true);

  const devices = await loadDevicesFromSupabase();

  return {
    mqttUrl,
    mqttUsername,
    mqttPassword,
    pollIntervalMs,
    outageConfirmMs,
    modbusTimeoutMs,
    modbusRetryMs,
    logLevel,
    logMeterReadings,
    devices,
    /** Phase voltages below this (volts) count toward outage when all phases are low */
    outageVoltageThresholdV: 20,
  };
}
