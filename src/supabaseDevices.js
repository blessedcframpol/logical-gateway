import { createClient } from "@supabase/supabase-js";
import { normalizeMeter } from "./meterSchema.js";

/**
 * Load enabled meters from Supabase (server-side service role only).
 *
 * @param {string} url
 * @param {string} serviceRoleKey
 * @param {string} [table='devices']
 * @returns {Promise<ReturnType<typeof normalizeMeter>[]>}
 */
export async function fetchMetersFromSupabase(url, serviceRoleKey, table = "devices") {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client
    .from(table)
    .select("id, device_code, name, site, host, port, unit_id, connection_type")
    .eq("enabled", true)
    .order("site", { ascending: true })
    .order("device_code", { ascending: true });

  if (error) {
    throw new Error(`Supabase gateway devices query failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error(`No enabled rows in ${table} (or table empty)`);
  }

  return data.map((row) => {
    const id = row.id != null ? String(row.id) : "?";
    return normalizeMeter(row, `devices[${id}]`);
  });
}
