/**
 * PM5340 Modbus register map — single place to update addresses.
 *
 * All standard telemetry readings are accessed as Holding Registers (FC3).
 * Instantaneous values (V, I, kW, etc.) are 32-bit floats (2 registers).
 * Energy values are 64-bit integers (4 registers).
 *
 * `start` is the Modbus PDU address for readHoldingRegisters (0-based per spec).
 * Schneider manuals often list 1-based register numbers — use manual address − 1 here.
 */

/** @typedef {'holding' | 'input'} RegisterType */

/**
 * One logical read for the poller. `id` keys the raw buffer in the snapshot.
 * @typedef {{ id: string; start: number; length: number; registerType: RegisterType }} ReadBlock
 */

// ==========================================
// CURRENT (Amps)
// ==========================================
export const PHASE_CURRENT_BLOCK = {
  id: "phaseCurrentRegs",
  start: 2999, // manual 3000 → PDU 2999
  length: 8, // Phase A, B, C, and Neutral (4 * float32 = 8 registers)
  registerType: "holding",
};

// ==========================================
// VOLTAGE (Volts)
// ==========================================
export const VOLTAGE_LL_BLOCK = {
  id: "voltageLLRegs",
  start: 3019, // manual 3020 → PDU 3019
  length: 6, // V_AB, V_BC, V_CA (3 * float32 = 6 registers)
  registerType: "holding",
};

export const VOLTAGE_LN_BLOCK = {
  id: "voltageLNRegs",
  start: 3027, // manual 3028 → PDU 3027
  length: 6, // V_AN, V_BN, V_CN (3 * float32 = 6 registers)
  registerType: "holding",
};

// ==========================================
// POWER (kW, kVAR, kVA)
// ==========================================
export const ACTIVE_POWER_PHASE_BLOCK = {
  id: "activePowerPhaseRegs",
  start: 3053, // manual 3054 → PDU 3053
  length: 6, // Active Power Phase A, B, C (3 * float32 = 6 registers)
  registerType: "holding",
};

export const TOTAL_ACTIVE_POWER_BLOCK = {
  id: "totalActivePowerRegs",
  start: 3059, // manual 3060 → PDU 3059
  length: 2, // Total Active Power kW (1 * float32 = 2 registers)
  registerType: "holding",
};

export const TOTAL_REACTIVE_POWER_BLOCK = {
  id: "totalReactivePowerRegs",
  start: 3067, // manual 3068 → PDU 3067
  length: 2, // Total Reactive Power kVAR (1 * float32 = 2 registers)
  registerType: "holding",
};

export const TOTAL_APPARENT_POWER_BLOCK = {
  id: "totalApparentPowerRegs",
  start: 3075, // manual 3076 → PDU 3075
  length: 2, // Total Apparent Power kVA (1 * float32 = 2 registers)
  registerType: "holding",
};

// ==========================================
// POWER QUALITY & FREQUENCY
// ==========================================
export const POWER_FACTOR_TOTAL_BLOCK = {
  id: "powerFactorTotalRegs",
  start: 3083, // manual 3084 → PDU 3083
  length: 2, // Total Power Factor (1 * float32 = 2 registers)
  registerType: "holding",
};

export const FREQUENCY_BLOCK = {
  id: "frequencyRegs",
  start: 3109, // manual 3110 → PDU 3109
  length: 2, // Frequency in Hz (1 * float32 = 2 registers)
  registerType: "holding",
};

// ==========================================
// ENERGY (kWh)
// ==========================================
export const TOTAL_ENERGY_BLOCK = {
  id: "totalEnergyRegs",
  start: 2699, // manual 2700 → PDU 2699
  length: 4, // Active Energy Delivered INT64 (1 * int64 = 4 registers)
  registerType: "holding",
};

/** All blocks read each poll cycle, in order. */
export const READ_BLOCKS = [
  PHASE_CURRENT_BLOCK,
  VOLTAGE_LL_BLOCK,
  VOLTAGE_LN_BLOCK,
  ACTIVE_POWER_PHASE_BLOCK,
  TOTAL_ACTIVE_POWER_BLOCK,
  TOTAL_REACTIVE_POWER_BLOCK,
  TOTAL_APPARENT_POWER_BLOCK,
  POWER_FACTOR_TOTAL_BLOCK,
  FREQUENCY_BLOCK,
  TOTAL_ENERGY_BLOCK,
];
