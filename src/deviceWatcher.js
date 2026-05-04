/**
 * Watches Supabase for device list changes and triggers reconciliation.
 *
 * Two mechanisms (both optional, complementary):
 *  - Periodic poll (safety net, also catches transient Realtime drops).
 *  - Postgres change subscription via Supabase Realtime (instant pickup).
 */

import { createClient } from "@supabase/supabase-js";
import { fetchMetersFromSupabase } from "./supabaseDevices.js";

/**
 * @param {object} deps
 * @param {ReturnType<import('./deviceRegistry.js').createDeviceRegistry>} deps.registry
 * @param {import('pino').Logger} deps.logger
 * @param {object} deps.supabase
 * @param {string} deps.supabase.url
 * @param {string} deps.supabase.serviceRoleKey
 * @param {string} deps.supabase.table
 * @param {number} deps.reloadIntervalMs
 * @param {boolean} deps.realtime
 */
export function startDeviceWatcher({ registry, logger, supabase, reloadIntervalMs, realtime }) {
  let stopped = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let pollHandle = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let coalesceHandle = null;
  /** @type {ReturnType<typeof createClient> | null} */
  let realtimeClient = null;
  /** @type {any} */
  let realtimeChannel = null;

  async function reconcileNow(reason) {
    if (stopped) return;
    try {
      const fresh = await fetchMetersFromSupabase(
        supabase.url,
        supabase.serviceRoleKey,
        supabase.table,
      );
      const result = registry.reconcile(fresh);
      logger.info(
        { event: "device_reconcile", reason, ...result, total: registry.size() },
        `device reconcile (${reason}): +${result.started} / -${result.stopped} / ~${result.restarted} (now ${registry.size()})`,
      );
    } catch (err) {
      logger.warn(
        { err, event: "device_reload_failed", reason },
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Coalesce bursts of realtime events into one reconcile. */
  function scheduleRealtimeReconcile() {
    if (coalesceHandle) return;
    coalesceHandle = setTimeout(() => {
      coalesceHandle = null;
      void reconcileNow("realtime");
    }, 500);
  }

  if (realtime) {
    try {
      realtimeClient = createClient(supabase.url, supabase.serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      realtimeChannel = realtimeClient
        .channel("devices_changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: supabase.table },
          (payload) => {
            logger.info(
              {
                event: "supabase_devices_change",
                changeType: payload.eventType,
                deviceCode: payload.new?.device_code ?? payload.old?.device_code,
              },
              `supabase ${payload.eventType} on ${supabase.table}`,
            );
            scheduleRealtimeReconcile();
          },
        )
        .subscribe((status) => {
          logger.info({ event: "supabase_realtime_status", status }, `realtime: ${status}`);
        });
    } catch (err) {
      logger.warn(
        { err, event: "supabase_realtime_init_failed" },
        "failed to start Supabase Realtime — falling back to polling only",
      );
    }
  }

  pollHandle = setInterval(() => {
    void reconcileNow("poll");
  }, reloadIntervalMs);

  return async function stopDeviceWatcher() {
    stopped = true;
    if (pollHandle) clearInterval(pollHandle);
    if (coalesceHandle) clearTimeout(coalesceHandle);
    if (realtimeChannel) {
      try {
        await realtimeChannel.unsubscribe();
      } catch {
        /* ignore */
      }
    }
    if (realtimeClient) {
      try {
        await realtimeClient.removeAllChannels();
      } catch {
        /* ignore */
      }
    }
  };
}
