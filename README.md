# TB Meter

Supabase + Vercel web app and Raspberry Pi 5 workflow for a width-measuring device.

The web app manages Raspberry Pi devices, measurement programs, device-program assignments, uploaded readings, CSV export, and cloud verification status. The Pi client authenticates with a device token, fetches active assigned programs, prompts the operator through each required reading label, validates a complete session, and uploads the readings to Supabase through trusted Next.js API routes.

## Stack

- Next.js App Router for the Vercel web app
- Supabase Postgres for devices, programs, assignments, and measurements
- Supabase Auth for web users
- Supabase Row Level Security for web access
- Service-role-only device token verification in Next.js API routes
- Python `requests` client for Raspberry Pi 5

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in `.env.local`:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
   DEVICE_TOKEN_PEPPER=replace-with-a-long-random-secret
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

4. Run the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Supabase Setup

1. Create a Supabase project.
2. In Supabase Auth, keep Email/Password enabled.
3. Apply migrations from `supabase/migrations` in order.

Using Supabase CLI:

```bash
supabase link --project-ref your-project-ref
supabase db push
```

Or paste each migration into the Supabase SQL editor:

- `supabase/migrations/202605030001_initial_schema.sql`
- `supabase/migrations/202605030002_rls_policies.sql`
- `supabase/migrations/202605080001_program_tolerances.sql`

The schema includes:

- `devices`
- `device_api_tokens`
- `programs`
- `device_program_assignments`
- `measurements`

`device_api_tokens` has RLS enabled with no authenticated-user policies. Tokens are created and checked only by server code using `SUPABASE_SERVICE_ROLE_KEY`.

## Web Workflow

1. Create a web user on `/login`.
2. Create a device on `/devices`.
3. Copy the one-time device token shown after creation.
4. Create a program on `/programs`.
5. Set `required_data_points_per_measurement`.
6. Set nominal width, upper tolerance, and lower tolerance when tolerance checks are needed on the Pi.
7. Enter one reading label per line, for example:

   ```text
   Tape 1 Left
   Tape 1 Right
   Tape 2 Left
   Tape 2 Right
   Tape 3 Left
   Tape 3 Right
   ```

8. Open the device detail page and assign one or more active programs.
9. View uploaded readings on `/measurements`.
10. Use `/reports` for live width-vs-time graphs, filtered CSV export, and PDF reports.
11. Export CSV from `/measurements` with the Export CSV button.

## Device API

All device API calls use:

```http
Authorization: Bearer <device-token>
```

Fetch active assigned programs:

```http
GET /api/device/programs
```

Upload one complete measurement session:

```http
POST /api/device/measurements
Content-Type: application/json
```

Example body:

```json
{
  "assignment_id": "assignment-uuid",
  "program_id": "program-uuid",
  "measurement_session_id": "session-uuid",
  "operator_name": "Nimal",
  "loom_name": "Loom 14",
  "sent_at": "2026-05-03T15:00:00.000Z",
  "readings": [
    {
      "reading_label": "Tape 1 Left",
      "reading_value": 12.4,
      "unit": "mm"
    }
  ]
}
```

The API validates:

- Device token is valid and not revoked.
- Program is active.
- Assignment is active for that device.
- Reading count matches the program requirement.
- Reading labels match the program labels in order.
- Reading values are numeric.

Successful response:

```json
{
  "success": true,
  "message": "Measurement successfully stored",
  "measurement_session_id": "session-uuid",
  "cloud_verification_status": "stored",
  "rows_stored": 6
}
```

## Raspberry Pi 5 Client

Install Python dependencies on the Pi:

```bash
cd pi_client
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

For Raspberry Pi OS, install the camera/display packages if they are not already present:

```bash
sudo apt install -y python3-picamera2 python3-opencv
```

Set the device environment:

```bash
export WIDTH_DEVICE_API_BASE=https://your-vercel-app.vercel.app
export WIDTH_DEVICE_TOKEN=wtk_your_device_token
export WIDTH_OPERATOR_NAME="Operator name"
```

Or create `pi_client/device_config.json` for a Pi-local fallback when those environment variables are not set:

```json
{
  "WIDTH_DEVICE_API_BASE": "https://your-vercel-app.vercel.app",
  "WIDTH_DEVICE_TOKEN": "wtk_your_device_token",
  "WIDTH_OPERATOR_NAME": "Operator name",
  "WIDTH_LOCAL_TIMEZONE": "Asia/Colombo"
}
```

`pi_client/device_config.json` is ignored by Git because it contains the device token. Keep `pi_client/device_config.example.json` as the safe template.

Run the cloud-connected camera screen:

```bash
python pi_width_cloud_app.py
```

This opens the Pi main screen with assigned cloud programs as buttons. Tapping a program shows the expected measurement sequence from Supabase, then the camera screen captures each reading automatically after the detected width is stable and the `Stabilized, getting data, 3,2,1` countdown completes.

The Pi first screen also has a `Manual` button. Manual mode is live-only: it continuously shows the current width without taking a measurement sequence or uploading values.

During a program measurement, the `Exit` button cancels the current cycle and clears captured readings without sending values to Supabase.

`pi_width_cloud_app.py` reuses `edge_detect.py` for the existing edge detection and width calculation. The original detector can still be run directly with:

```bash
python edge_detect.py
```

The stability behavior can be tuned with:

```bash
export WIDTH_STABLE_SECONDS=1.0
export WIDTH_COUNTDOWN_SECONDS=3
export WIDTH_STABLE_TOLERANCE_MM=0.15
export WIDTH_REQUIRE_CENTER_ALIGNMENT=true
export WIDTH_REMOVAL_SECONDS=0.6
export WIDTH_LOCAL_TIMEZONE=Asia/Colombo
```

For assigned programs, each captured reading is the average of the latest 3 stable camera readings. After each capture, the Pi waits for the current tape to be removed before prompting `Place next tape` for the next label.

Assigned programs also show a `Cloud Send` toggle before starting measurement. When it is off, the program becomes a live width display with program tolerance coloring and no captured readings or upload. Once measurement starts, the toggle is locked for that cycle.

The older terminal prompt example is still available:

```bash
python width_device_client.py
```

The function `capture_width_for_label()` currently prompts for a numeric value. Replace that function with serial, GPIO, USB, or sensor-specific measurement code when the hardware integration is ready.

## Vercel Deployment

1. Push this project to a Git repository.
2. Import the repository in Vercel.
3. Set these Vercel environment variables:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SERVICE_ROLE_KEY
   DEVICE_TOKEN_PEPPER
   NEXT_PUBLIC_SITE_URL=https://your-vercel-app.vercel.app
   ```

4. Deploy.
5. Add the Vercel URL to Supabase Auth redirect URLs:

   ```text
   https://your-vercel-app.vercel.app/auth/callback
   ```

## Production Notes

- Keep `SUPABASE_SERVICE_ROLE_KEY` only in server environments.
- Keep `DEVICE_TOKEN_PEPPER` stable; changing it invalidates existing device tokens.
- Rotate a device token from the device detail page if a Pi token is exposed.
- The dashboard treats a device as effectively offline when it has not checked in for 5 minutes.
- For multi-site or multi-company use, add an organization table and scope every RLS policy by organization membership.
