import ModbusRTU from "modbus-serial";
import { READ_BLOCKS } from "./pm5340Map.js";

/**
 * Poll one PM5340 (or path that exposes the same register map) over Modbus TCP.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {number} opts.unitId
 * @param {number} opts.timeoutMs
 * @returns {Promise<Record<string, number[]>>} Raw holding/input register arrays keyed by block id from pm5340Map
 */
export async function readMeterSnapshot({ host, port, unitId, timeoutMs }) {
  const client = new ModbusRTU();
  try {
    await client.connectTCP(host, { port });
    client.setID(unitId);
    client.setTimeout(timeoutMs);

    /** @type {Record<string, number[]>} */
    const snapshot = {};

    for (const block of READ_BLOCKS) {
      const resp =
        block.registerType === "input"
          ? await client.readInputRegisters(block.start, block.length)
          : await client.readHoldingRegisters(block.start, block.length);
      snapshot[block.id] = resp.data;
    }

    return snapshot;
  } finally {
    await new Promise((resolve) => {
      client.close(() => resolve());
    });
  }
}
