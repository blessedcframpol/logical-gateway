-- logical-gateway: Modbus meter devices stored in Postgres (Supabase).
-- Run in Supabase SQL Editor or via `supabase db push` after placing under supabase/migrations/.
--
-- If you already created public.gateway_devices, rename once:
--   ALTER TABLE public.gateway_devices RENAME TO devices;
-- (then align trigger/index names with this script or recreate as needed.)
--
-- Column mapping to app/runtime objects (camelCase):
--   device_code -> deviceCode
--   unit_id     -> unitId
--   connection_type -> single_phase | three_phase (outage/telemetry logic can branch on this later)
--
-- Timestamps: stored as local wall clock GMT+2 (PostgreSQL zone Etc/GMT-2 = UTC+2), not UTC.

-- Enum: electrical service connection (single-phase vs three-phase).
DO $$
BEGIN
  CREATE TYPE public.gateway_connection_type AS ENUM (
    'single_phase',
    'three_phase'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

COMMENT ON TYPE public.gateway_connection_type IS
  'Installation wiring: single_phase (L–N) vs three_phase (three lines + neutral where applicable).';

CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity & Modbus TCP
  device_code text NOT NULL,
  name text NOT NULL,
  site text NOT NULL,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 502
    CONSTRAINT devices_port_range CHECK (port >= 1 AND port <= 65535),
  unit_id smallint NOT NULL
    CONSTRAINT devices_unit_id_range CHECK (unit_id >= 0 AND unit_id <= 255),

  -- Electrical connection (enum-backed)
  connection_type public.gateway_connection_type NOT NULL DEFAULT 'three_phase',

  -- Soft-disable without deleting row
  enabled boolean NOT NULL DEFAULT true,

  -- Wall clock in GMT+2 (see PostgreSQL Etc/GMT-* POSIX-style names; Etc/GMT-2 means UTC+2).
  created_at timestamp without time zone NOT NULL DEFAULT (timezone('Etc/GMT-2', now())),
  updated_at timestamp without time zone NOT NULL DEFAULT (timezone('Etc/GMT-2', now())),

  CONSTRAINT devices_site_device_code_unique UNIQUE (site, device_code)
);

COMMENT ON TABLE public.devices IS
  'PM5340 / Modbus TCP meters polled by logical-gateway; sole source for the gateway device list.';

COMMENT ON COLUMN public.devices.device_code IS 'Stable meter id used in MQTT topic segments.';
COMMENT ON COLUMN public.devices.connection_type IS 'single_phase or three_phase; references gateway_connection_type enum.';
COMMENT ON COLUMN public.devices.created_at IS 'Row created at (wall clock GMT+2, stored without time zone).';
COMMENT ON COLUMN public.devices.updated_at IS 'Last update at (wall clock GMT+2, stored without time zone).';

CREATE INDEX IF NOT EXISTS devices_enabled_site_idx
  ON public.devices (site)
  WHERE enabled = true;

-- Keep updated_at in sync on UPDATE (GMT+2 wall clock, same as column default).
CREATE OR REPLACE FUNCTION public.devices_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('Etc/GMT-2', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS devices_set_updated_at ON public.devices;
CREATE TRIGGER devices_set_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW
  EXECUTE PROCEDURE public.devices_set_updated_at();

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

-- No policies: anon/authenticated cannot read/write. Service role (gateway worker) bypasses RLS.
-- Add policies later if you expose this table to logged-in users.

-- Example seed (uncomment and edit, or insert via Table Editor):
-- INSERT INTO public.devices (device_code, name, site, host, port, unit_id, connection_type, enabled)
-- VALUES
--   ('PM5340-01', 'Meter 1', 'dev-office', '10.0.76.102', 502, 255, 'three_phase', true);

-- If `devices` already existed with timestamptz UTC columns, convert stored instants to GMT+2 wall clock once:
-- ALTER TABLE public.devices
--   ALTER COLUMN created_at TYPE timestamp without time zone
--     USING (timezone('Etc/GMT-2', created_at)),
--   ALTER COLUMN updated_at TYPE timestamp without time zone
--     USING (timezone('Etc/GMT-2', updated_at));
