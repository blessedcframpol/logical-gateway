import ModbusRTU from "modbus-serial";
import { READ_BLOCKS } from "./pm5340Map.js";

/** Max time to wait for modbus-serial's close() callback before forcing teardown. */
const CLOSE_GRACE_MS = 3500;

/**
 * Always release the poller: close() can hang forever if the TCP stack never emits "close"
 * after a bad network drop, which would leave devicePoller.inFlight stuck true.
 * @param {{ close?: (cb: () => void) => void; destroy?: (cb: () => void) => void }} client
 */
async function safeCloseClient(client) {
  await Promise.race([
    new Promise((resolve) => {
      try {
        if (client && typeof client.close === "function") {
          client.close(() => resolve());
        } else {
          resolve();
        }
      } catch {
        resolve();
      }
    }),
    new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS)),
  ]);

  try {
    if (client && typeof client.destroy === "function") {
      client.destroy(() => {});
    }
  } catch {
    /* ignore */
  }
}

/**
 * Poll one PM5340 (or path that exposes the same register map) over Modbus TCP.
 * One connection per snapshot; socket is always torn down (bounded wait + destroy fallback).
 *
 * Important: call setTimeout() *before* connectTCP so TcpPort gets a socket connect timeout.
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
    client.setTimeout(timeoutMs);
    await client.connectTCP(host, { port });
    client.setID(unitId);

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
    await safeCloseClient(client);
  }
}
