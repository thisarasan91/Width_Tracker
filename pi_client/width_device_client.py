"""
Raspberry Pi 5 example client for the Width Tracker cloud workflow.

Environment variables:
  WIDTH_DEVICE_API_BASE=http://localhost:3000
  WIDTH_DEVICE_TOKEN=wtk_your_one_time_device_token
  WIDTH_OPERATOR_NAME=Operator name

Replace capture_width_for_label() with sensor integration when the device hardware is ready.
"""

from __future__ import annotations

import os
import json
import sys
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
except ImportError:  # Python < 3.9 fallback for local testing.
    ZoneInfo = None

    class ZoneInfoNotFoundError(Exception):
        pass

import requests


CONFIG_PATH = Path(__file__).with_name("device_config.json")


def load_device_config() -> dict[str, str]:
    if not CONFIG_PATH.exists():
        return {}

    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

    if not isinstance(data, dict):
        return {}

    return {str(key): str(value) for key, value in data.items() if value is not None}


DEVICE_CONFIG = load_device_config()


def config_value(key: str, default: str = "") -> str:
    return os.getenv(key) or DEVICE_CONFIG.get(key, default)


API_BASE = config_value("WIDTH_DEVICE_API_BASE", "http://localhost:3000").rstrip("/")
DEVICE_TOKEN = config_value("WIDTH_DEVICE_TOKEN")
OPERATOR_NAME = config_value("WIDTH_OPERATOR_NAME")
LOCAL_TIMEZONE = config_value("WIDTH_LOCAL_TIMEZONE", "Asia/Colombo")


class DeviceClientError(RuntimeError):
    pass


def headers() -> dict[str, str]:
    if not DEVICE_TOKEN:
        raise DeviceClientError("WIDTH_DEVICE_TOKEN is not set.")

    return {
        "authorization": f"Bearer {DEVICE_TOKEN}",
        "content-type": "application/json",
    }


def fetch_programs() -> dict[str, Any]:
    response = requests.get(
        f"{API_BASE}/api/device/programs",
        headers=headers(),
        timeout=20,
    )
    if response.status_code != 200:
        raise DeviceClientError(f"Could not fetch programs: {response.text}")

    payload = response.json()
    if not payload.get("success"):
        raise DeviceClientError(payload.get("message", "Program fetch failed."))

    return payload


def local_timestamp_iso() -> str:
    if ZoneInfo is not None:
        try:
            tzinfo = ZoneInfo(LOCAL_TIMEZONE)
            return datetime.now(tzinfo).isoformat()
        except ZoneInfoNotFoundError:
            pass

    tzinfo = timezone(timedelta(hours=5, minutes=30))
    return datetime.now(tzinfo).isoformat()


def choose_program(programs: list[dict[str, Any]]) -> dict[str, Any]:
    if not programs:
        raise DeviceClientError("No active programs are assigned to this device.")

    print("\nAssigned programs")
    for index, program in enumerate(programs, start=1):
        print(
            f"{index}. {program['program_name']} "
            f"({program['required_data_points_per_measurement']} readings)"
        )

    while True:
        choice = input("Select program number: ").strip()
        if choice.isdigit() and 1 <= int(choice) <= len(programs):
            return programs[int(choice) - 1]
        print("Invalid selection.")


def capture_width_for_label(label: str) -> float:
    """Replace this with serial/GPIO/sensor reading code later."""

    while True:
        value = input(f"{label} width (mm): ").strip()
        try:
            return float(value)
        except ValueError:
            print("Enter a numeric width value.")


def collect_readings(program: dict[str, Any]) -> list[dict[str, Any]]:
    labels = program["labels_for_each_reading"]
    required_count = program["required_data_points_per_measurement"]

    print(f"\n{required_count} readings required")
    readings: list[dict[str, Any]] = []

    for label in labels:
        width = capture_width_for_label(label)
        readings.append(
            {
                "reading_label": label,
                "reading_value": width,
                "unit": "mm",
            }
        )

    if len(readings) != required_count:
        raise DeviceClientError("Required readings were not completed.")

    return readings


def upload_measurement(
    program: dict[str, Any],
    readings: list[dict[str, Any]],
    loom_name: str | None,
) -> dict[str, Any]:
    payload = {
        "assignment_id": program["assignment_id"],
        "program_id": program["program_id"],
        "measurement_session_id": str(uuid.uuid4()),
        "readings": readings,
        "unit": "mm",
        "operator_name": OPERATOR_NAME or None,
        "loom_name": loom_name,
        "sent_at": local_timestamp_iso(),
    }

    response = requests.post(
        f"{API_BASE}/api/device/measurements",
        headers=headers(),
        json=payload,
        timeout=30,
    )

    try:
        body = response.json()
    except ValueError as exc:
        raise DeviceClientError(f"Upload returned invalid JSON: {response.text}") from exc

    if response.status_code != 200 or not body.get("success"):
        raise DeviceClientError(body.get("message", "Upload failed, retry required."))

    return body


def main() -> int:
    try:
        cloud_payload = fetch_programs()
        device = cloud_payload["device"]
        program = choose_program(cloud_payload["programs"])
        readings = collect_readings(program)
        confirmation = upload_measurement(program, readings, device.get("loom_name"))

        print("\nMeasurement successfully stored")
        print(f"Session: {confirmation['measurement_session_id']}")
        print(f"Rows stored: {confirmation['rows_stored']}")
        return 0
    except DeviceClientError as exc:
        print(f"\nUpload failed, retry required: {exc}", file=sys.stderr)
        return 1
    except requests.RequestException as exc:
        print(f"\nUpload failed, retry required: network error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    while True:
        exit_code = main()
        again = input("\nCapture another measurement? [y/N]: ").strip().lower()
        if again != "y":
            raise SystemExit(exit_code)
        time.sleep(0.5)
