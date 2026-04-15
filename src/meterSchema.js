/** @typedef {'single_phase' | 'three_phase'} ConnectionType */

/**
 * @param {object} d
 * @param {string} camel
 * @param {string} [snake]
 * @returns {unknown}
 */
function pick(d, camel, snake) {
  const c = d[camel];
  if (c !== undefined && c !== null && String(c).trim() !== "") return c;
  if (snake) {
    const s = d[snake];
    if (s !== undefined && s !== null && String(s).trim() !== "") return s;
  }
  return undefined;
}

/**
 * Canonical meter object for Modbus + MQTT.
 * @param {object} d — camelCase (JSON env) and/or snake_case (Supabase row)
 * @param {string} ctx — error prefix, e.g. devices[row-uuid]
 * @returns {{ deviceCode: string; name: string; site: string; host: string; port: number; unitId: number; connectionType: ConnectionType }}
 */
export function normalizeMeter(d, ctx) {
  const deviceCode = pick(d, "deviceCode", "device_code");
  const name = pick(d, "name", "name");
  const site = pick(d, "site", "site");
  const host = pick(d, "host", "host");
  const portRaw = pick(d, "port", "port");
  const unitIdRaw = pick(d, "unitId", "unit_id");
  const connectionRaw = pick(d, "connectionType", "connection_type") ?? "three_phase";

  const required = [
    ["deviceCode", deviceCode],
    ["name", name],
    ["site", site],
    ["host", host],
    ["port", portRaw],
    ["unitId", unitIdRaw],
  ];
  for (const [k, v] of required) {
    if (v === undefined || v === null || String(v).trim() === "") {
      throw new Error(`${ctx} missing required field: ${k}`);
    }
  }

  const port = Number.parseInt(String(portRaw), 10);
  const unitId = Number.parseInt(String(unitIdRaw), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`${ctx}: port must be a valid TCP port`);
  }
  if (!Number.isFinite(unitId) || unitId < 0 || unitId > 255) {
    throw new Error(`${ctx}: unitId must be 0-255`);
  }

  const connectionType = String(connectionRaw).trim();
  if (connectionType !== "single_phase" && connectionType !== "three_phase") {
    throw new Error(`${ctx}: connectionType must be single_phase or three_phase`);
  }

  return {
    deviceCode: String(deviceCode),
    name: String(name),
    site: String(site),
    host: String(host),
    port,
    unitId,
    connectionType,
  };
}
