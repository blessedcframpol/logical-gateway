/**
 * Decode raw Modbus register arrays into engineering units.
 * Assumes 32-bit floats as big-endian high-word-first pairs (Schneider PM5300-style FC3).
 */

/**
 * IEEE 754 float32 from two big-endian Modbus registers (high word first).
 *
 * @param {number[]} regs
 * @param {number} wordOffset Register index of the first of two 16-bit words
 * @returns {number}
 */
export function float32FromRegistersBE(regs, wordOffset) {
  const w0 = regs[wordOffset] & 0xffff;
  const w1 = regs[wordOffset + 1] & 0xffff;
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt16BE(w0, 0);
  buf.writeUInt16BE(w1, 2);
  return buf.readFloatBE(0);
}

/**
 * UINT32 from two big-endian Modbus registers (high word first).
 *
 * @param {number[]} regs
 * @param {number} wordOffset
 * @returns {number}
 */
export function uint32FromRegistersBE(regs, wordOffset) {
  const hi = regs[wordOffset] & 0xffff;
  const lo = regs[wordOffset + 1] & 0xffff;
  return (hi << 16) | lo;
}

/**
 * Unsigned 64-bit integer from four big-endian Modbus registers (MSW first).
 *
 * @param {number[]} regs
 * @param {number} wordOffset First of four 16-bit registers
 * @returns {bigint}
 */
export function uint64FromRegistersBE(regs, wordOffset) {
  if (!regs || regs.length < wordOffset + 4) {
    throw new Error("uint64FromRegistersBE: need 4 registers");
  }
  let n = 0n;
  for (let i = 0; i < 4; i++) {
    n = (n << 16n) + BigInt(regs[wordOffset + i] & 0xffff);
  }
  return n;
}

/**
 * L–N phase voltages for outage logic (Va, Vb, Vc).
 *
 * @param {Record<string, number[]>} snapshot
 * @returns {{ va: number; vb: number; vc: number }}
 */
export function phaseVoltagesFromSnapshot(snapshot) {
  const regs = snapshot.voltageLNRegs;
  if (!regs || regs.length < 6) {
    throw new Error("voltageLNRegs missing or too short (expected 6 registers)");
  }
  return {
    va: float32FromRegistersBE(regs, 0),
    vb: float32FromRegistersBE(regs, 2),
    vc: float32FromRegistersBE(regs, 4),
  };
}

/**
 * @param {Record<string, number[]>} snapshot
 */
export function telemetryExtrasFromSnapshot(snapshot) {
  /** @type {Record<string, unknown>} */
  const out = {};

  const iRegs = snapshot.phaseCurrentRegs;
  if (iRegs && iRegs.length >= 8) {
    out.phaseCurrentA = {
      a: float32FromRegistersBE(iRegs, 0),
      b: float32FromRegistersBE(iRegs, 2),
      c: float32FromRegistersBE(iRegs, 4),
      n: float32FromRegistersBE(iRegs, 6),
    };
  }

  const llRegs = snapshot.voltageLLRegs;
  if (llRegs && llRegs.length >= 6) {
    out.phaseVoltageLLV = {
      ab: float32FromRegistersBE(llRegs, 0),
      bc: float32FromRegistersBE(llRegs, 2),
      ca: float32FromRegistersBE(llRegs, 4),
    };
  }

  const apRegs = snapshot.activePowerPhaseRegs;
  if (apRegs && apRegs.length >= 6) {
    out.activePowerPhaseKw = {
      a: float32FromRegistersBE(apRegs, 0),
      b: float32FromRegistersBE(apRegs, 2),
      c: float32FromRegistersBE(apRegs, 4),
    };
  }

  const pRegs = snapshot.totalActivePowerRegs;
  if (pRegs && pRegs.length >= 2) {
    out.totalActivePowerKw = float32FromRegistersBE(pRegs, 0);
  }

  const qRegs = snapshot.totalReactivePowerRegs;
  if (qRegs && qRegs.length >= 2) {
    out.totalReactivePowerKvar = float32FromRegistersBE(qRegs, 0);
  }

  const sRegs = snapshot.totalApparentPowerRegs;
  if (sRegs && sRegs.length >= 2) {
    out.totalApparentPowerKva = float32FromRegistersBE(sRegs, 0);
  }

  const pfRegs = snapshot.powerFactorTotalRegs;
  if (pfRegs && pfRegs.length >= 2) {
    out.powerFactorTotal = float32FromRegistersBE(pfRegs, 0);
  }

  const fRegs = snapshot.frequencyRegs;
  if (fRegs && fRegs.length >= 2) {
    out.frequencyHz = float32FromRegistersBE(fRegs, 0);
  }

  const eRegs = snapshot.totalEnergyRegs;
  if (eRegs && eRegs.length >= 4) {
    const wh = uint64FromRegistersBE(eRegs, 0);
    out.totalEnergyWh = wh.toString();
    out.totalEnergyKwh = Number(wh) / 1000;
  }

  return out;
}

/**
 * Full MQTT telemetry fields from a Modbus snapshot.
 *
 * @param {Record<string, number[]>} snapshot
 */
export function snapshotToTelemetryFields(snapshot) {
  const { va, vb, vc } = phaseVoltagesFromSnapshot(snapshot);
  const extras = telemetryExtrasFromSnapshot(snapshot);
  return {
    phaseVoltageV: { a: va, b: vb, c: vc },
    ...extras,
  };
}
