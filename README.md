# PM5340 logical gateway

Node.js service that polls Schneider PM5340 power meters over **Modbus TCP** and publishes **telemetry**, **status**, and **outage** messages to **MQTT**. The meter list is loaded from **Supabase** (`public.devices`); see `sql/supabase_devices.sql`.

## Requirements

- Node.js 18+
- **Supabase** project with `public.devices` populated (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`; service role is server-side only).
- MQTT broker (default: `mqtt://127.0.0.1:1883`). If the broker disables anonymous access, set `MQTT_USERNAME` and `MQTT_PASSWORD` in `.env` (see `.env.example`).
- Network path from the gateway host to each meter Modbus TCP endpoint (`host` / `port` / `unit_id` in the database).

## Quick run

1. In Supabase, run `sql/supabase_devices.sql`, then insert at least one enabled row into `public.devices` (see commented example at the bottom of that file).

2. Copy the environment template and set Supabase credentials:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`: set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (never expose the service role key to clients).

3. Install and start:

   ```bash
   npm install
   npm start
   ```

4. Subscribe to verify topics:

   ```bash
   mosquitto_sub -h 127.0.0.1 -t 'power/+/+/#' -v
   ```

## Topics

- `power/{orgSlug}/{deviceCode}/telemetry` — measurements (QoS 1)
- `power/{orgSlug}/{deviceCode}/status` — `online` / `offline` / `comm_fault` (QoS 1)
- `power/{orgSlug}/{deviceCode}/outage` — `outage_confirmed` / `outage_cleared` (QoS 1)

## Register map

Replace placeholder Modbus addresses in [`src/modbus/pm5340Map.js`](src/modbus/pm5340Map.js) using Schneider's PM5340 documentation.

## systemd (Ubuntu)

See [`logical-gateway.service`](logical-gateway.service). Adjust `User`, `WorkingDirectory`, and `EnvironmentFile`, then:

```bash
sudo cp logical-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now logical-gateway.service
sudo journalctl -u logical-gateway.service -f
```