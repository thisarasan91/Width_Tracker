# Width Tracker

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
6. Enter one reading label per line, for example:

   ```text
   Tape 1 Left
   Tape 1 Right
   Tape 2 Left
   Tape 2 Right
   Tape 3 Left
   Tape 3 Right
   ```

7. Open the device detail page and assign one or more active programs.
8. View uploaded readings on `/measurements`.
9. Export CSV from `/measurements` with the Export CSV button.

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

Set the device environment:

```bash
export WIDTH_DEVICE_API_BASE=https://your-vercel-app.vercel.app
export WIDTH_DEVICE_TOKEN=wtk_your_device_token
export WIDTH_OPERATOR_NAME="Operator name"
```

Run:

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
