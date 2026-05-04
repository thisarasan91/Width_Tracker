import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CreateDeviceForm } from "@/components/CreateDeviceForm";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient } from "@/lib/supabase/server";
import { effectiveDeviceStatus, formatDateTime } from "@/lib/format";
import type { Device } from "@/lib/types";

export default async function DevicesPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("devices").select("*").order("device_name");
  const devices = (data ?? []) as Device[];

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Raspberry Pi Fleet</p>
          <h1>Devices</h1>
        </div>
      </header>

      <CreateDeviceForm />

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Registry</p>
            <h2>All devices</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Serial</th>
                <th>Location</th>
                <th>Loom</th>
                <th>Last seen</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.device_name}</td>
                  <td>
                    <StatusBadge status={effectiveDeviceStatus(device)} />
                  </td>
                  <td>{device.serial_number}</td>
                  <td>{device.location ?? "Not set"}</td>
                  <td>{device.loom_name ?? "Not set"}</td>
                  <td>{formatDateTime(device.last_seen_at)}</td>
                  <td>
                    <Link className="button secondary" href={`/devices/${device.id}`}>
                      View
                      <ArrowRight aria-hidden="true" className="icon" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {devices.length === 0 ? <p className="empty-state">Create the first device to generate a Pi API token.</p> : null}
      </section>
    </div>
  );
}
