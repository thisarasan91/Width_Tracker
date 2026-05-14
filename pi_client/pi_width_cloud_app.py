"""
Cloud-connected Raspberry Pi width-measurement screen.

This script uses edge_detect.py for camera setup, calibration settings,
edge detection, and width calculation. It does not change the detection
algorithm; it only adds cloud program selection, measurement sequencing,
stability capture, countdown, and upload.
"""

from __future__ import annotations

import os
import json
import csv
import math
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import requests

import edge_detect
from width_device_client import DeviceClientError, fetch_programs, local_timestamp_iso, upload_measurement


WINDOW_CLOUD = "TB Meter"
APP_DIR = Path(__file__).resolve().parent
LOCAL_QUEUE_PATH = Path(os.getenv("WIDTH_LOCAL_QUEUE_PATH", str(APP_DIR / "local_measurements_queue.jsonl")))
MEASUREMENT_LOG_PATH = Path(os.getenv("WIDTH_MEASUREMENT_LOG_PATH", str(APP_DIR / "measurement_log.csv")))
PROGRAM_CACHE_PATH = Path(os.getenv("WIDTH_PROGRAM_CACHE_PATH", str(APP_DIR / "program_cache.json")))
SPLASH_IMAGE_PATH = Path(os.getenv("WIDTH_SPLASH_IMAGE_PATH", str(APP_DIR / "splash_image.png")))
LOCAL_SYNC_INTERVAL_SECONDS = float(os.getenv("WIDTH_LOCAL_SYNC_INTERVAL_SECONDS", "20"))
INACTIVITY_SHUTDOWN_SECONDS = float(os.getenv("WIDTH_INACTIVITY_SHUTDOWN_SECONDS", "180"))
SHUTDOWN_WARNING_SECONDS = float(os.getenv("WIDTH_SHUTDOWN_WARNING_SECONDS", "30"))
ENABLE_AUTO_SHUTDOWN = os.getenv("WIDTH_ENABLE_AUTO_SHUTDOWN", "true").lower() != "false"

STABLE_SECONDS = float(os.getenv("WIDTH_STABLE_SECONDS", "1.0"))
COUNTDOWN_SECONDS = int(os.getenv("WIDTH_COUNTDOWN_SECONDS", "3"))
STABLE_TOLERANCE_MM = float(os.getenv("WIDTH_STABLE_TOLERANCE_MM", "0.15"))
STABLE_TOLERANCE_PX = float(os.getenv("WIDTH_STABLE_TOLERANCE_PX", "4.0"))
REQUIRE_CENTER_ALIGNMENT = os.getenv("WIDTH_REQUIRE_CENTER_ALIGNMENT", "true").lower() != "false"
MANUAL_VERTICAL_ALIGNMENT_TOLERANCE_DEG = float(os.getenv("WIDTH_MANUAL_VERTICAL_TOLERANCE_DEG", "1.0"))
REMOVAL_SECONDS = float(os.getenv("WIDTH_REMOVAL_SECONDS", "0.6"))
AVERAGE_SAMPLE_COUNT = 3
CENTER_ALIGNMENT_TOLERANCE_RATIO = float(os.getenv("WIDTH_CENTER_ALIGNMENT_TOLERANCE_RATIO", "0.03"))
CENTER_ALIGNMENT_TOLERANCE_PX: float | None = None
ANGLE_ALIGNMENT_TOLERANCE_DEG = float(os.getenv("WIDTH_ANGLE_ALIGNMENT_TOLERANCE_DEG", "2.0"))

COLOR_BG = (30, 36, 43)
COLOR_PANEL = (245, 248, 250)
COLOR_BUTTON = (23, 107, 135)
COLOR_BUTTON_ALT = (60, 80, 96)
COLOR_TEXT = (255, 255, 255)
COLOR_DARK_TEXT = (20, 30, 40)
COLOR_SUCCESS = (0, 190, 95)
COLOR_WARNING = (0, 190, 255)
COLOR_DANGER = (40, 40, 220)
CSV_HEADERS = [
    "measured_at",
    "logged_at",
    "source",
    "measurement_session_id",
    "device_name",
    "serial_number",
    "loom_name",
    "program_name",
    "batch_name",
    "reading_label",
    "reading_value",
    "unit",
    "cloud_status",
    "rows_stored",
]


queue_lock = threading.RLock()
csv_lock = threading.Lock()


def parse_float(value: Any, default: float | None = None) -> float | None:
    if value is None or value == "":
        return default

    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def clamp_float(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def read_settings_json() -> dict[str, Any]:
    try:
        with open(edge_detect.get_settings_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

    return data if isinstance(data, dict) else {}


def save_program_cache(payload: dict[str, Any]) -> None:
    try:
        PROGRAM_CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        pass


def load_program_cache() -> dict[str, Any] | None:
    try:
        data = json.loads(PROGRAM_CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    if not isinstance(data, dict) or not isinstance(data.get("programs"), list) or not isinstance(data.get("device"), dict):
        return None

    return data


def program_snapshot(program: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "assignment_id",
        "program_id",
        "program_name",
        "batch_name",
        "elastic_development_reference",
        "description",
        "nominal_width",
        "upper_tolerance",
        "lower_tolerance",
        "required_data_points_per_measurement",
        "labels_for_each_reading",
    )
    return {key: program.get(key) for key in keys}


def append_measurement_csv(
    device: dict[str, Any] | None,
    program: dict[str, Any],
    readings: list[dict[str, Any]],
    measurement_session_id: str,
    source: str,
    cloud_status: str,
    rows_stored: int | None = None,
) -> None:
    MEASUREMENT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logged_at = local_timestamp_iso()

    with csv_lock:
        file_exists = MEASUREMENT_LOG_PATH.exists() and MEASUREMENT_LOG_PATH.stat().st_size > 0
        with MEASUREMENT_LOG_PATH.open("a", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=CSV_HEADERS)
            if not file_exists:
                writer.writeheader()
            for reading in readings:
                writer.writerow(
                    {
                        "measured_at": reading.get("measured_at") or logged_at,
                        "logged_at": logged_at,
                        "source": source,
                        "measurement_session_id": measurement_session_id,
                        "device_name": (device or {}).get("device_name"),
                        "serial_number": (device or {}).get("serial_number"),
                        "loom_name": (device or {}).get("loom_name"),
                        "program_name": program.get("program_name"),
                        "batch_name": program.get("batch_name"),
                        "reading_label": reading.get("reading_label"),
                        "reading_value": reading.get("reading_value"),
                        "unit": reading.get("unit"),
                        "cloud_status": cloud_status,
                        "rows_stored": rows_stored or "",
                    }
                )


def build_queue_payload(
    device: dict[str, Any] | None,
    program: dict[str, Any],
    readings: list[dict[str, Any]],
    measurement_session_id: str,
    sent_at: str,
    error: str,
) -> dict[str, Any]:
    return {
        "queued_at": local_timestamp_iso(),
        "last_error": error,
        "measurement_session_id": measurement_session_id,
        "sent_at": sent_at,
        "loom_name": (device or {}).get("loom_name"),
        "device": {
            "id": (device or {}).get("id"),
            "device_name": (device or {}).get("device_name"),
            "serial_number": (device or {}).get("serial_number"),
            "loom_name": (device or {}).get("loom_name"),
        },
        "program": program_snapshot(program),
        "readings": readings,
    }


def append_local_queue(payload: dict[str, Any]) -> None:
    LOCAL_QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with queue_lock:
        with LOCAL_QUEUE_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, separators=(",", ":")) + "\n")


def read_local_queue() -> list[dict[str, Any]]:
    if not LOCAL_QUEUE_PATH.exists():
        return []

    items: list[dict[str, Any]] = []
    with queue_lock:
        try:
            lines = LOCAL_QUEUE_PATH.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []

    for line in lines:
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict):
            items.append(item)
    return items


def write_local_queue(items: list[dict[str, Any]]) -> None:
    with queue_lock:
        if not items:
            try:
                LOCAL_QUEUE_PATH.unlink()
            except FileNotFoundError:
                pass
            return

        LOCAL_QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOCAL_QUEUE_PATH.open("w", encoding="utf-8") as handle:
            for item in items:
                handle.write(json.dumps(item, separators=(",", ":")) + "\n")


def upload_queue_item(item: dict[str, Any]) -> dict[str, Any]:
    program = item.get("program")
    readings = item.get("readings")
    if not isinstance(program, dict) or not isinstance(readings, list):
        raise DeviceClientError("Invalid local queued measurement.")

    return upload_measurement(
        program,
        readings,
        item.get("loom_name"),
        measurement_session_id=str(item.get("measurement_session_id") or ""),
        sent_at=str(item.get("sent_at") or local_timestamp_iso()),
    )


def sync_local_queue_once() -> tuple[int, int]:
    with queue_lock:
        queued_items = read_local_queue()
        if not queued_items:
            return 0, 0

        remaining: list[dict[str, Any]] = []
        uploaded_count = 0

        for item in queued_items:
            try:
                upload_queue_item(item)
                uploaded_count += 1
            except (DeviceClientError, requests.RequestException) as exc:
                item["last_error"] = str(exc)
                item["last_retry_at"] = local_timestamp_iso()
                remaining.append(item)

        write_local_queue(remaining)
        return uploaded_count, len(remaining)


def first_setting(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in data:
            return data[key]
    return None


def env_or_json_float(
    env_key: str,
    data: dict[str, Any],
    json_keys: tuple[str, ...],
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    env_value = os.getenv(env_key)
    raw_value = env_value if env_value not in (None, "") else first_setting(data, *json_keys)
    parsed = parse_float(raw_value, default)
    return clamp_float(parsed if parsed is not None else default, minimum, maximum)


def load_alignment_settings() -> None:
    global CENTER_ALIGNMENT_TOLERANCE_RATIO
    global CENTER_ALIGNMENT_TOLERANCE_PX
    global ANGLE_ALIGNMENT_TOLERANCE_DEG
    global MANUAL_VERTICAL_ALIGNMENT_TOLERANCE_DEG

    data = read_settings_json()

    CENTER_ALIGNMENT_TOLERANCE_RATIO = env_or_json_float(
        "WIDTH_CENTER_ALIGNMENT_TOLERANCE_RATIO",
        data,
        ("center_alignment_tolerance_ratio", "center_align_tolerance_ratio"),
        CENTER_ALIGNMENT_TOLERANCE_RATIO,
        0.001,
        0.25,
    )

    center_px_env = os.getenv("WIDTH_CENTER_ALIGNMENT_TOLERANCE_PX")
    center_px_raw = (
        center_px_env
        if center_px_env not in (None, "")
        else first_setting(data, "center_alignment_tolerance_px", "center_align_tolerance_px")
    )
    center_px = parse_float(center_px_raw, None)
    CENTER_ALIGNMENT_TOLERANCE_PX = center_px if center_px is not None and center_px > 0 else None

    ANGLE_ALIGNMENT_TOLERANCE_DEG = env_or_json_float(
        "WIDTH_ANGLE_ALIGNMENT_TOLERANCE_DEG",
        data,
        ("angle_alignment_tolerance_deg", "angle_align_tolerance_deg"),
        ANGLE_ALIGNMENT_TOLERANCE_DEG,
        0.1,
        45.0,
    )

    MANUAL_VERTICAL_ALIGNMENT_TOLERANCE_DEG = env_or_json_float(
        "WIDTH_MANUAL_VERTICAL_TOLERANCE_DEG",
        data,
        ("manual_vertical_alignment_tolerance_deg", "manual_vertical_tolerance_deg"),
        MANUAL_VERTICAL_ALIGNMENT_TOLERANCE_DEG,
        0.1,
        45.0,
    )


def save_alignment_settings() -> None:
    payload = read_settings_json()
    payload["center_alignment_tolerance_ratio"] = CENTER_ALIGNMENT_TOLERANCE_RATIO
    payload["center_alignment_tolerance_px"] = CENTER_ALIGNMENT_TOLERANCE_PX or 0
    payload["angle_alignment_tolerance_deg"] = ANGLE_ALIGNMENT_TOLERANCE_DEG
    payload["manual_vertical_alignment_tolerance_deg"] = MANUAL_VERTICAL_ALIGNMENT_TOLERANCE_DEG

    try:
        with open(edge_detect.get_settings_path(), "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
    except OSError:
        pass


def configured_center_tolerance_px(width: int) -> float:
    if CENTER_ALIGNMENT_TOLERANCE_PX is not None:
        return CENTER_ALIGNMENT_TOLERANCE_PX
    return max(12.0, width * CENTER_ALIGNMENT_TOLERANCE_RATIO)


def get_configured_alignment_status(img: np.ndarray, result: dict[str, Any]) -> dict[str, Any]:
    height, width = img.shape[:2]
    center_x = width // 2
    center_y = height // 2
    tolerance_px = configured_center_tolerance_px(width)

    tape_center_offset_px = None
    angle_error_deg = None
    aligned = False

    if result is not None and result.get("ok") and result.get("midline") is not None:
        (mx1, my1), (mx2, my2) = result["midline"]
        if my2 != my1:
            ratio = (center_y - my1) / float(my2 - my1)
            mid_x_at_center = mx1 + ratio * (mx2 - mx1)
            tape_center_offset_px = float(mid_x_at_center - center_x)
        else:
            tape_center_offset_px = float(((mx1 + mx2) * 0.5) - center_x)

        angle_deg = result.get("angle_deg")
        if angle_deg is not None:
            angle_error_deg = abs(float(angle_deg) - 90.0)

        aligned = (
            tape_center_offset_px is not None
            and angle_error_deg is not None
            and abs(tape_center_offset_px) <= tolerance_px
            and angle_error_deg <= ANGLE_ALIGNMENT_TOLERANCE_DEG
        )

    return {
        "aligned": aligned,
        "offset_px": tape_center_offset_px,
        "angle_error_deg": angle_error_deg,
        "center_tolerance_px": tolerance_px,
        "angle_tolerance_deg": ANGLE_ALIGNMENT_TOLERANCE_DEG,
    }


@dataclass
class ClickTarget:
    action: str
    rect: tuple[int, int, int, int]
    value: Any = None


@dataclass
class StabilityTracker:
    samples: list[tuple[float, float]] = field(default_factory=list)
    anchor_value: float | None = None
    stable_started_at: float | None = None

    def reset(self) -> None:
        self.samples.clear()
        self.anchor_value = None
        self.stable_started_at = None

    def update(self, value: float | None, tolerance: float, now: float) -> bool:
        if value is None:
            self.reset()
            return False

        current_value = float(value)
        self.samples.append((now, current_value))
        self.samples = self.samples[-20:]

        if self.anchor_value is None or abs(current_value - self.anchor_value) > tolerance:
            self.anchor_value = current_value
            self.stable_started_at = now
            return False

        if self.stable_started_at is None:
            self.stable_started_at = now
            return False

        return now - self.stable_started_at >= STABLE_SECONDS


class WidthCloudApp:
    def __init__(self) -> None:
        self.state = "programs"
        self.device: dict[str, Any] | None = None
        self.programs: list[dict[str, Any]] = []
        self.selected_program: dict[str, Any] | None = None
        self.readings: list[dict[str, Any]] = []
        self.current_index = 0
        self.click_targets: list[ClickTarget] = []
        self.program_page = 0
        self.message = "Loading assigned programs..."
        self.error_message = ""
        self.latest_result: dict[str, Any] | None = None
        self.latest_width: float | None = None
        self.latest_unit = "mm"
        self.stability = StabilityTracker()
        self.countdown_started_at: float | None = None
        self.capture_samples: list[float] = []
        self.awaiting_tape_removal = False
        self.removal_started_at: float | None = None
        self.upload_thread: threading.Thread | None = None
        self.upload_result: dict[str, Any] | None = None
        self.upload_error = ""
        self.send_to_cloud_enabled = True
        self.cloud_toggle_locked = False
        self.measurement_session_id: str | None = None
        self.measurement_started_at: str | None = None
        self.measurement_logged = False
        self.sync_thread: threading.Thread | None = None
        self.sync_message = ""
        self.local_queue_count = len(read_local_queue())
        self.last_activity_at = time.time()
        self.shutdown_started = False

    def build_manual_program(self) -> dict[str, Any]:
        return {
            "manual": True,
            "assignment_id": None,
            "program_id": None,
            "program_name": "Manual",
            "batch_name": None,
            "elastic_development_reference": None,
            "description": "Manual width measurement. Values are not uploaded.",
            "required_data_points_per_measurement": 1,
            "labels_for_each_reading": ["Manual width"],
        }

    def reset_capture_state(self) -> None:
        self.stability.reset()
        self.countdown_started_at = None
        self.capture_samples = []
        self.awaiting_tape_removal = False
        self.removal_started_at = None

    def reset_program_state(self) -> None:
        self.readings = []
        self.current_index = 0
        self.upload_result = None
        self.upload_error = ""
        self.send_to_cloud_enabled = True
        self.cloud_toggle_locked = False
        self.measurement_session_id = None
        self.measurement_started_at = None
        self.measurement_logged = False
        self.reset_capture_state()

    def note_activity(self) -> None:
        self.last_activity_at = time.time()
        self.shutdown_started = False

    def shutdown_warning_remaining(self) -> int | None:
        if not ENABLE_AUTO_SHUTDOWN:
            return None

        elapsed = time.time() - self.last_activity_at
        remaining = int(math.ceil(INACTIVITY_SHUTDOWN_SECONDS - elapsed))
        if remaining <= int(SHUTDOWN_WARNING_SECONDS):
            return max(0, remaining)
        return None

    def maybe_shutdown_for_inactivity(self) -> bool:
        if not ENABLE_AUTO_SHUTDOWN or self.shutdown_started:
            return False

        if time.time() - self.last_activity_at < INACTIVITY_SHUTDOWN_SECONDS:
            return False

        self.shutdown_started = True
        try:
            subprocess.Popen(["sudo", "shutdown", "-h", "now"])
        except OSError:
            try:
                subprocess.Popen(["shutdown", "-h", "now"])
            except OSError:
                return False
        return True

    def begin_measurement_session(self) -> None:
        self.measurement_session_id = str(uuid.uuid4())
        self.measurement_started_at = local_timestamp_iso()
        self.measurement_logged = False

    def session_sent_at(self) -> str:
        for reading in self.readings:
            measured_at = reading.get("measured_at")
            if measured_at:
                return str(measured_at)
        return self.measurement_started_at or local_timestamp_iso()

    def start_queue_sync(self) -> None:
        if self.sync_thread and self.sync_thread.is_alive():
            return

        def worker() -> None:
            while True:
                uploaded_count, remaining_count = sync_local_queue_once()
                self.local_queue_count = remaining_count
                if uploaded_count:
                    self.sync_message = f"Uploaded {uploaded_count} locally saved session(s)."
                    if self.state == "programs":
                        self.message = self.sync_message
                elif remaining_count:
                    self.sync_message = f"{remaining_count} session(s) saved locally."
                time.sleep(LOCAL_SYNC_INTERVAL_SECONDS)

        self.sync_thread = threading.Thread(target=worker, daemon=True)
        self.sync_thread.start()

    def load_programs(self) -> None:
        try:
            payload = fetch_programs()
            self.device = payload["device"]
            self.programs = payload["programs"]
            save_program_cache(payload)
            self.message = "Select assigned program"
            self.error_message = "" if self.programs else "No active programs assigned to this device."
        except (DeviceClientError, requests.RequestException) as exc:
            cached_payload = load_program_cache()
            if cached_payload:
                self.device = cached_payload["device"]
                self.programs = cached_payload["programs"]
                self.message = "Cloud offline. Using cached programs."
                self.error_message = "Measurements will save locally until internet returns."
            else:
                self.programs = []
                self.message = "Cloud connection failed"
                self.error_message = str(exc)

    def handle_click(self, x: int, y: int) -> None:
        for target in self.click_targets:
            x1, y1, x2, y2 = target.rect
            if x1 <= x <= x2 and y1 <= y <= y2:
                self.dispatch_action(target.action, target.value)
                return

    def dispatch_action(self, action: str, value: Any = None) -> None:
        if action == "refresh":
            self.state = "programs"
            self.program_page = 0
            self.load_programs()
        elif action == "manual":
            self.selected_program = self.build_manual_program()
            self.reset_program_state()
            self.message = "Manual live width"
            self.state = "manual_live"
        elif action == "program":
            self.selected_program = value
            self.reset_program_state()
            self.message = "Review expected measurement sequence"
            self.state = "sequence"
        elif action == "toggle_cloud":
            if not self.cloud_toggle_locked:
                self.send_to_cloud_enabled = not self.send_to_cloud_enabled
        elif action == "next_page":
            self.program_page += 1
        elif action == "prev_page":
            self.program_page = max(0, self.program_page - 1)
        elif action == "back":
            self.state = "programs"
            self.reset_capture_state()
        elif action == "abort":
            self.selected_program = None
            self.reset_program_state()
            self.message = "Measurement cancelled. No values sent."
            self.state = "programs"
        elif action == "start":
            self.cloud_toggle_locked = True
            self.reset_capture_state()
            if self.selected_program and not self.selected_program.get("manual") and not self.send_to_cloud_enabled:
                self.state = "program_live"
                self.message = "Cloud sending off. Live width only."
            else:
                if self.selected_program and not self.selected_program.get("manual"):
                    self.begin_measurement_session()
                self.state = "measuring"
                self.message = "Position tape for first reading"
        elif action == "retry_upload":
            self.start_upload()
        elif action == "new_measurement":
            self.selected_program = None
            self.reset_program_state()
            self.state = "programs"

    def current_label(self) -> str:
        if not self.selected_program:
            return ""
        labels = self.selected_program["labels_for_each_reading"]
        if self.current_index >= len(labels):
            return ""
        return labels[self.current_index]

    def capture_current_reading(self, value: float, unit: str) -> None:
        label = self.current_label()
        self.readings.append(
            {
                "reading_label": label,
                "reading_value": round(float(value), 4),
                "unit": unit,
                "measured_at": local_timestamp_iso(),
            }
        )
        self.current_index += 1
        self.reset_capture_state()

        if self.selected_program and self.current_index >= self.selected_program["required_data_points_per_measurement"]:
            if self.selected_program.get("manual"):
                self.state = "manual_complete"
                self.message = "Manual measurement complete"
                return
            if not self.send_to_cloud_enabled:
                self.state = "local_complete"
                self.message = "Measurement complete. Cloud sending off."
                return
            self.start_upload()
        else:
            self.awaiting_tape_removal = True
            self.message = "Remove tape"

    def start_upload(self) -> None:
        if not self.selected_program or not self.device:
            return
        if self.selected_program.get("manual"):
            self.state = "manual_complete"
            return
        self.state = "uploading"
        self.upload_result = None
        self.upload_error = ""
        program = program_snapshot(self.selected_program)
        readings = [dict(reading) for reading in self.readings]
        measurement_session_id = self.measurement_session_id or str(uuid.uuid4())
        self.measurement_session_id = measurement_session_id
        sent_at = self.session_sent_at()
        device = dict(self.device)

        def worker() -> None:
            try:
                result = upload_measurement(
                    program,
                    readings,
                    device.get("loom_name"),
                    measurement_session_id=measurement_session_id,
                    sent_at=sent_at,
                )
                append_measurement_csv(
                    device,
                    program,
                    readings,
                    measurement_session_id,
                    "cloud",
                    "cloud_stored",
                    result.get("rows_stored"),
                )
                self.upload_result = result
            except requests.RequestException as exc:
                payload = build_queue_payload(device, program, readings, measurement_session_id, sent_at, str(exc))
                append_local_queue(payload)
                append_measurement_csv(
                    device,
                    program,
                    readings,
                    measurement_session_id,
                    "local",
                    "saved_locally",
                    None,
                )
                self.local_queue_count = len(read_local_queue())
                self.upload_result = {
                    "success": True,
                    "local_saved": True,
                    "message": "Measurement saved locally. Will upload when internet returns.",
                    "measurement_session_id": measurement_session_id,
                    "rows_stored": len(readings),
                }
            except DeviceClientError as exc:
                self.upload_error = str(exc)

        self.upload_thread = threading.Thread(target=worker, daemon=True)
        self.upload_thread.start()

    def update_upload_state(self) -> None:
        if self.state != "uploading":
            return
        if self.upload_result:
            if self.upload_result.get("local_saved"):
                self.state = "local_saved"
                self.message = "Measurement saved locally"
            else:
                self.state = "uploaded"
                self.message = "Measurement successfully stored in cloud"
        elif self.upload_error:
            self.state = "upload_failed"
            self.message = "Upload failed, retry required"

    def apply_detection(self, result: dict[str, Any], alignment_status: dict[str, Any]) -> tuple[float | None, str, bool]:
        self.latest_result = result
        width_value = None
        unit = "mm"

        if result.get("width_mm") is not None:
            width_value = float(result["width_mm"])
            unit = "mm"
        elif result.get("width_px") is not None:
            width_value = float(result["width_px"])
            unit = "px"

        self.latest_unit = unit

        aligned = bool(alignment_status.get("aligned")) if REQUIRE_CENTER_ALIGNMENT else True
        can_capture = bool(result.get("ok")) and width_value is not None and aligned
        self.latest_width = width_value if can_capture else None
        return width_value, unit, can_capture

    def update_measurement_capture(self, result: dict[str, Any], alignment_status: dict[str, Any]) -> str:
        now = time.time()
        width_value, unit, can_capture = self.apply_detection(result, alignment_status)

        if self.awaiting_tape_removal:
            if result.get("ok") and width_value is not None:
                self.removal_started_at = None
                return "Remove tape"

            if self.removal_started_at is None:
                self.removal_started_at = now
                return "Tape removed"

            if now - self.removal_started_at >= REMOVAL_SECONDS:
                self.awaiting_tape_removal = False
                self.removal_started_at = None
                self.message = "Place next tape"
                return "Place next tape"

            return "Tape removed"

        if not can_capture:
            self.stability.reset()
            self.countdown_started_at = None
            self.capture_samples = []
            if not result.get("ok"):
                if self.message == "Place next tape":
                    return "Place next tape"
                return f"Detecting edges: {result.get('msg', 'no reading')}"
            if REQUIRE_CENTER_ALIGNMENT and not alignment_status.get("aligned"):
                return "Align tape to center guide"
            return "Waiting for valid width"

        tolerance = STABLE_TOLERANCE_MM if unit == "mm" else STABLE_TOLERANCE_PX
        stable = self.stability.update(width_value, tolerance, now)

        if not stable:
            self.countdown_started_at = None
            self.capture_samples = []
            return f"Getting stable width: {width_value:.3f} {unit}"

        if self.countdown_started_at is None:
            self.countdown_started_at = now
            self.capture_samples = []

        self.capture_samples.append(width_value)
        self.capture_samples = self.capture_samples[-10:]

        elapsed = now - self.countdown_started_at

        if elapsed >= COUNTDOWN_SECONDS and width_value is not None:
            if len(self.capture_samples) < AVERAGE_SAMPLE_COUNT:
                return f"Averaging {len(self.capture_samples)}/{AVERAGE_SAMPLE_COUNT}"

            averaged_width = sum(self.capture_samples[-AVERAGE_SAMPLE_COUNT:]) / AVERAGE_SAMPLE_COUNT
            self.capture_current_reading(averaged_width, unit)
            return f"Captured avg {averaged_width:.3f} {unit}"

        remaining = max(1, math.ceil(COUNTDOWN_SECONDS - elapsed))
        return f"Stabilized, getting data, {remaining}"

    def program_number(self, key: str, default: float | None = None) -> float | None:
        if not self.selected_program:
            return default

        value = self.selected_program.get(key)
        if value is None or value == "":
            return default

        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def tolerance_limits(self) -> tuple[float, float, float] | None:
        nominal = self.program_number("nominal_width")
        if nominal is None:
            return None

        lower = self.program_number("lower_tolerance", 0.0) or 0.0
        upper = self.program_number("upper_tolerance", 0.0) or 0.0
        return nominal - lower, nominal, nominal + upper

    def tolerance_status(self, value: float | None, unit: str | None = None) -> str:
        active_unit = unit or self.latest_unit
        limits = self.tolerance_limits()
        if value is None or limits is None or active_unit != "mm":
            return "unknown"

        min_allowed, _, max_allowed = limits
        return "in" if min_allowed <= value <= max_allowed else "out"

    def tolerance_color(self, value: float | None, unit: str | None = None) -> tuple[int, int, int]:
        status = self.tolerance_status(value, unit)
        if status == "in":
            return COLOR_SUCCESS
        if status == "out":
            return COLOR_DANGER
        return COLOR_TEXT

    def tolerance_footer_text(self) -> str:
        limits = self.tolerance_limits()
        if limits is None:
            return "Tolerance: not set"

        lower, nominal, upper = limits
        return f"LSL {lower:.3f} | NOM {nominal:.3f} | USL {upper:.3f}"

    def _line_angle_from_vertical_degrees(self, line: tuple[tuple[int, int], tuple[int, int]] | None) -> float | None:
        if line is None:
            return None
        try:
            (x1, y1), (x2, y2) = line
        except (TypeError, ValueError):
            return None

        dx = float(x2 - x1)
        dy = float(y2 - y1)
        if dx == 0.0 and dy == 0.0:
            return None

        angle = math.degrees(math.atan2(dx, dy))
        while angle > 90.0:
            angle -= 180.0
        while angle < -90.0:
            angle += 180.0
        return angle

    def manual_alignment_ready(self, result: dict[str, Any], alignment_status: dict[str, Any]) -> tuple[bool, str]:
        if REQUIRE_CENTER_ALIGNMENT and not alignment_status.get("aligned"):
            return False, "Align tape to center guide"

        angles = [
            angle
            for angle in (
                self._line_angle_from_vertical_degrees(result.get("line1")),
                self._line_angle_from_vertical_degrees(result.get("line2")),
            )
            if angle is not None
        ]
        if not angles:
            return False, "Checking vertical alignment"

        vertical_angle = sum(angles) / len(angles)
        if abs(vertical_angle) > MANUAL_VERTICAL_ALIGNMENT_TOLERANCE_DEG:
            return False, f"Straighten tape vertically: {vertical_angle:+.2f} deg"

        return True, ""

    def update_manual_display(self, result: dict[str, Any], alignment_status: dict[str, Any]) -> str:
        width_value, unit, _ = self.apply_detection(result, alignment_status)
        if not result.get("ok") or width_value is None:
            self.latest_width = None
            return f"Detecting edges: {result.get('msg', 'no reading')}"

        manual_ready, manual_message = self.manual_alignment_ready(result, alignment_status)
        if not manual_ready:
            self.latest_width = None
            return manual_message

        return f"Width live: {width_value:.3f} {unit}"

    def update_program_live_display(self, result: dict[str, Any], alignment_status: dict[str, Any]) -> str:
        width_value, unit, _ = self.apply_detection(result, alignment_status)
        if not result.get("ok") or width_value is None:
            self.latest_width = None
            return f"Detecting edges: {result.get('msg', 'no reading')}"

        if REQUIRE_CENTER_ALIGNMENT and not alignment_status.get("aligned"):
            return "Align tape to center guide"

        status = self.tolerance_status(width_value, unit)
        if status == "in":
            return f"Within tolerance: {width_value:.3f} {unit}"
        if status == "out":
            return f"Out of tolerance: {width_value:.3f} {unit}"
        return f"Live width: {width_value:.3f} {unit}"


app = WidthCloudApp()


def mouse_callback(event: int, x: int, y: int, flags: int, param: Any) -> None:
    if event == cv2.EVENT_LBUTTONDOWN:
        app.note_activity()
        app.handle_click(x, y)


def draw_text(img, text, origin, scale, color=(255,255,255), thickness=2):
    cv2.putText(
        img,
        text,
        origin,
        cv2.FONT_HERSHEY_SIMPLEX,
        scale,
        color,
        max(2, thickness),   # increase thickness
        cv2.LINE_AA           # keep anti-aliasing
    )

def draw_button(
    img: np.ndarray,
    rect: tuple[int, int, int, int],
    title: str,
    subtitle: str = "",
    color: tuple[int, int, int] = COLOR_BUTTON,
) -> None:
    x1, y1, x2, y2 = rect
    cv2.rectangle(img, (x1, y1), (x2, y2), color, -1)
    cv2.rectangle(img, (x1, y1), (x2, y2), (15, 20, 25), 2)
    draw_text(img, title[:34], (x1 + 18, y1 + 34), 0.72, COLOR_TEXT, 2)
    if subtitle:
        draw_text(img, subtitle[:44], (x1 + 18, y1 + 62), 0.52, COLOR_TEXT, 1)


def blank_screen(width: int, height: int) -> np.ndarray:
    img = np.zeros((height, width, 3), dtype=np.uint8)
    img[:, :] = COLOR_BG
    return img


def load_splash_image(width: int, height: int) -> np.ndarray:
    if SPLASH_IMAGE_PATH.exists():
        splash = cv2.imread(str(SPLASH_IMAGE_PATH))
        if splash is not None:
            return fit_cover_to_canvas(splash, width, height)

    img = blank_screen(width, height)
    draw_text(img, "TB Meter", (width // 2 - 130, height // 2 - 20), 1.4, COLOR_TEXT, 4)
    return img


def render_splash_screen(width: int, height: int, status: str, progress: float) -> np.ndarray:
    img = load_splash_image(width, height)
    progress = clamp_float(progress, 0.0, 1.0)
    overlay_h = 118
    y1 = height - overlay_h
    cv2.rectangle(img, (0, y1), (width, height), (20, 26, 32), -1)
    draw_text(img, "TB Meter", (30, y1 + 34), 0.75, COLOR_TEXT, 2)
    draw_text(img, status[:70], (30, y1 + 70), 0.55, COLOR_WARNING, 2)

    bar_x1 = 30
    bar_y1 = height - 32
    bar_x2 = width - 30
    bar_y2 = height - 16
    cv2.rectangle(img, (bar_x1, bar_y1), (bar_x2, bar_y2), (60, 70, 80), -1)
    fill_x2 = bar_x1 + int((bar_x2 - bar_x1) * progress)
    cv2.rectangle(img, (bar_x1, bar_y1), (fill_x2, bar_y2), COLOR_SUCCESS, -1)
    return img


def show_splash(width: int, height: int, status: str, progress: float) -> None:
    cv2.imshow(WINDOW_CLOUD, render_splash_screen(width, height, status, progress))
    cv2.waitKey(1)


def render_program_screen(width: int, height: int) -> np.ndarray:
    img = blank_screen(width, height)
    app.click_targets = []

    draw_text(img, "TB Meter", (30, 55), 1.2, COLOR_TEXT, 3)
    draw_text(img, app.message, (32, 92), 0.65, COLOR_WARNING if app.error_message else COLOR_TEXT, 2)
    if app.local_queue_count:
        draw_text(img, f"{app.local_queue_count} session(s) saved locally for upload", (32, 126), 0.48, COLOR_WARNING, 1)
    elif app.sync_message:
        draw_text(img, app.sync_message[:80], (32, 126), 0.48, COLOR_SUCCESS, 1)
    if app.error_message:
        draw_text(img, app.error_message[:80], (32, 156), 0.48, COLOR_DANGER, 1)

    refresh_rect = (width - 190, 24, width - 30, 74)
    draw_button(img, refresh_rect, "Refresh", "", COLOR_BUTTON_ALT)
    app.click_targets.append(ClickTarget("refresh", refresh_rect))

    manual_rect = (30, 112, width - 30, 184)
    draw_button(img, manual_rect, "Manual", "Live width display. No cloud upload.", COLOR_SUCCESS)
    app.click_targets.append(ClickTarget("manual", manual_rect))

    top = 206
    margin = 30
    gap = 12
    button_h = 74
    available_h = max(button_h, height - top - 90)
    page_size = max(1, available_h // (button_h + gap))
    start = app.program_page * page_size
    visible_programs = app.programs[start:start + page_size]

    for index, program in enumerate(visible_programs):
        y1 = top + index * (button_h + gap)
        rect = (margin, y1, width - margin, y1 + button_h)
        subtitle = (
            f"{program['required_data_points_per_measurement']} readings"
            f" | Batch: {program.get('batch_name') or 'not set'}"
        )
        draw_button(img, rect, program["program_name"], subtitle)
        app.click_targets.append(ClickTarget("program", rect, program))

    pager_y = height - 62
    if app.program_page > 0:
        prev_rect = (margin, pager_y, margin + 150, pager_y + 44)
        draw_button(img, prev_rect, "Prev", "", COLOR_BUTTON_ALT)
        app.click_targets.append(ClickTarget("prev_page", prev_rect))
    if start + page_size < len(app.programs):
        next_rect = (width - margin - 150, pager_y, width - margin, pager_y + 44)
        draw_button(img, next_rect, "Next", "", COLOR_BUTTON_ALT)
        app.click_targets.append(ClickTarget("next_page", next_rect))

    return img


def render_sequence_screen(width: int, height: int) -> np.ndarray:
    img = blank_screen(width, height)
    app.click_targets = []
    program = app.selected_program
    if not program:
        app.state = "programs"
        return render_program_screen(width, height)

    draw_text(img, program["program_name"], (30, 55), 1.0, COLOR_TEXT, 3)
    draw_text(img, f"{program['required_data_points_per_measurement']} readings required", (32, 92), 0.65, COLOR_WARNING, 2)
    if program.get("manual"):
        draw_text(img, "Manual values are not uploaded to cloud.", (32, 124), 0.52, COLOR_TEXT, 1)
    else:
        toggle_color = COLOR_SUCCESS if app.send_to_cloud_enabled else COLOR_BUTTON_ALT
        toggle_text = "Cloud Send: ON" if app.send_to_cloud_enabled else "Cloud Send: OFF"
        toggle_rect = (width - 285, 112, width - 30, 166)
        draw_button(img, toggle_rect, toggle_text, "Locked after Start", toggle_color)
        app.click_targets.append(ClickTarget("toggle_cloud", toggle_rect))

    labels = program["labels_for_each_reading"]
    y = 158 if program.get("manual") else 190
    for index, label in enumerate(labels, start=1):
        draw_text(img, f"{index}. {label}", (46, y), 0.62, COLOR_TEXT, 2)
        y += 38
        if y > height - 130:
            draw_text(img, "...", (46, y), 0.62, COLOR_TEXT, 2)
            break

    back_rect = (30, height - 76, 190, height - 26)
    start_rect = (width - 260, height - 76, width - 30, height - 26)
    draw_button(img, back_rect, "Back", "", COLOR_BUTTON_ALT)
    draw_button(img, start_rect, "Start", "", COLOR_SUCCESS)
    app.click_targets.append(ClickTarget("back", back_rect))
    app.click_targets.append(ClickTarget("start", start_rect))
    return img


def draw_detection_overlay(display: np.ndarray, result: dict[str, Any], params: dict[str, Any]) -> np.ndarray:
    ui_scale = edge_detect.get_ui_scale(display)
    overlay_thickness = max(2, int(round(2 * ui_scale)))
    _, ry1, _, ry2 = result["roi_box"]
    display[ry1:ry2, :] = edge_detect.apply_image_adjustments(display[ry1:ry2, :], params)
    cv2.rectangle(display, (0, ry1), (display.shape[1] - 1, ry2), (80, 80, 80), overlay_thickness)

    if params["show_edges"]:
        edges = result["edges"]
        edge_bgr = np.zeros((edges.shape[0], edges.shape[1], 3), dtype=np.uint8)
        edge_bgr[:, :, 2] = edges
        display[ry1:ry2, :] = cv2.addWeighted(display[ry1:ry2, :], 1.0, edge_bgr, 0.6, 0)

    if result["ok"]:
        cv2.line(display, result["line1"][0], result["line1"][1], (0, 255, 0), max(2, int(round(3 * ui_scale))))
        cv2.line(display, result["line2"][0], result["line2"][1], (0, 255, 0), max(2, int(round(3 * ui_scale))))
        if result["midline"] is not None:
            cv2.line(display, result["midline"][0], result["midline"][1], (255, 255, 0), max(1, int(round(ui_scale))))
        cv2.line(display, result["segment1"], result["segment2"], (255, 0, 255), max(2, int(round(3 * ui_scale))))
        cv2.circle(display, result["segment1"], max(4, int(round(6 * ui_scale))), (255, 0, 255), -1)
        cv2.circle(display, result["segment2"], max(4, int(round(6 * ui_scale))), (255, 0, 255), -1)

    alignment_status = get_configured_alignment_status(display, result)
    edge_detect.draw_center_alignment_indicator(display, alignment_status)
    return display


def draw_measurement_hud(display: np.ndarray, status_text: str) -> np.ndarray:
    program = app.selected_program
    if not program:
        return display

    width = display.shape[1]
    app.click_targets = []
    bottom_top = display.shape[0] - 82
    cv2.rectangle(display, (0, 0), (width, 126), (20, 26, 32), -1)
    cv2.rectangle(display, (0, bottom_top), (width, display.shape[0]), (20, 26, 32), -1)

    label = app.current_label()
    progress = f"{app.current_index + 1}/{program['required_data_points_per_measurement']}"
    title = "Manual" if program.get("manual") else program["program_name"]
    draw_text(display, f"TB Meter | {title}"[:34], (16, 30), 0.62, COLOR_TEXT, 2)
    draw_text(display, f"{progress}: {label}"[:34], (16, 66), 0.78, COLOR_WARNING, 2)
    cloud_text = "Cloud ON" if app.send_to_cloud_enabled else "Cloud OFF"
    draw_text(display, cloud_text, (width - 250, 32), 0.52, COLOR_SUCCESS if app.send_to_cloud_enabled else COLOR_WARNING, 2)

    status_color = COLOR_SUCCESS if "Stabilized" in status_text or "Captured" in status_text else COLOR_TEXT
    draw_text(display, status_text[:36], (16, 104), 0.66, status_color, 2)

    if app.latest_width is not None:
        draw_text(
            display,
            f"Live width: {app.latest_width:.3f} {app.latest_unit}",
            (width - 335, 108),
            0.58,
            app.tolerance_color(app.latest_width, app.latest_unit),
            2,
        )

    exit_rect = (width - 128, 16, width - 14, 64)
    draw_button(display, exit_rect, "Exit", "", COLOR_DANGER)
    app.click_targets.append(ClickTarget("abort", exit_rect))

    if status_text.startswith("Stabilized"):
        countdown = status_text.rsplit(" ", 1)[-1]
        draw_text(display, countdown, (width // 2 - 38, display.shape[0] // 2 + 42), 3.0, COLOR_SUCCESS, 7)

    draw_text(display, app.tolerance_footer_text(), (16, display.shape[0] - 50), 0.48, COLOR_WARNING, 2)

    if app.latest_width is not None and app.latest_unit != "mm" and app.tolerance_limits() is not None:
        draw_text(display, "Tolerance needs mm calibration", (width - 330, display.shape[0] - 50), 0.44, COLOR_DANGER, 1)

    x = 16
    y = display.shape[0] - 18
    for reading in app.readings[-1:]:
        reading_value = float(reading["reading_value"])
        reading_unit = str(reading.get("unit", app.latest_unit))
        draw_text(
            display,
            f"{reading['reading_label'][:14]}: {reading['reading_value']} {reading['unit']}"[:32],
            (x, y),
            0.46,
            app.tolerance_color(reading_value, reading_unit),
            1,
        )
        x += 350

    return display


def draw_program_live_hud(display: np.ndarray, status_text: str) -> np.ndarray:
    program = app.selected_program
    if not program:
        return display

    width = display.shape[1]
    height = display.shape[0]
    app.click_targets = []
    cv2.rectangle(display, (0, 0), (width, 116), (20, 26, 32), -1)
    cv2.rectangle(display, (0, height - 82), (width, height), (20, 26, 32), -1)

    draw_text(display, f"TB Meter | {program['program_name']}"[:34], (18, 34), 0.66, COLOR_TEXT, 2)
    draw_text(display, "Cloud OFF | Live width only", (18, 74), 0.6, COLOR_WARNING, 2)
    draw_text(display, status_text[:48], (18, 108), 0.52, app.tolerance_color(app.latest_width, app.latest_unit), 2)

    if app.latest_width is not None:
        value_text = f"{app.latest_width:.3f} {app.latest_unit}"
        value_color = app.tolerance_color(app.latest_width, app.latest_unit)
        text_size, _ = cv2.getTextSize(value_text, cv2.FONT_HERSHEY_SIMPLEX, 1.8, 5)
        draw_text(display, value_text, ((width - text_size[0]) // 2, height // 2 + 34), 1.8, value_color, 5)
    else:
        placeholder = "Align tape first" if "Align" in status_text or "angle" in status_text else "No width detected"
        draw_text(display, placeholder, (width // 2 - 180, height // 2 + 20), 0.9, COLOR_DANGER, 3)

    draw_text(display, app.tolerance_footer_text(), (18, height - 46), 0.52, COLOR_WARNING, 2)
    if app.latest_width is not None and app.latest_unit != "mm" and app.tolerance_limits() is not None:
        draw_text(display, "Tolerance needs mm calibration", (18, height - 18), 0.46, COLOR_DANGER, 1)

    exit_rect = (width - 128, 18, width - 14, 66)
    draw_button(display, exit_rect, "Exit", "", COLOR_DANGER)
    app.click_targets.append(ClickTarget("abort", exit_rect))
    return display


def draw_manual_hud(display: np.ndarray, status_text: str) -> np.ndarray:
    width = display.shape[1]
    height = display.shape[0]
    app.click_targets = []
    cv2.rectangle(display, (0, 0), (width, 98), (20, 26, 32), -1)
    cv2.rectangle(display, (0, height - 80), (width, height), (20, 26, 32), -1)

    draw_text(display, "TB Meter | Manual", (18, 38), 0.78, COLOR_TEXT, 2)
    draw_text(display, "Live width only. No cloud upload.", (18, 76), 0.58, COLOR_WARNING, 2)

    if app.latest_width is not None:
        value_text = f"{app.latest_width:.3f} {app.latest_unit}"
        text_size, _ = cv2.getTextSize(value_text, cv2.FONT_HERSHEY_SIMPLEX, 1.8, 5)
        draw_text(display, value_text, ((width - text_size[0]) // 2, height // 2 + 34), 1.8, COLOR_SUCCESS, 5)
    else:
        placeholder = (
            "Align tape first"
            if "Align" in status_text or "Straighten" in status_text or "Checking" in status_text
            else "No width detected"
        )
        draw_text(display, placeholder, (width // 2 - 180, height // 2 + 20), 0.9, COLOR_DANGER, 3)

    draw_text(display, status_text[:54], (18, height - 30), 0.62, COLOR_TEXT, 2)
    exit_rect = (width - 128, 18, width - 14, 66)
    draw_button(display, exit_rect, "Exit", "", COLOR_DANGER)
    app.click_targets.append(ClickTarget("abort", exit_rect))
    return display


def fit_cover_to_canvas(display: np.ndarray, width: int, height: int) -> np.ndarray:
    src_h, src_w = display.shape[:2]
    scale = max(width / src_w, height / src_h)
    resized_w = max(width, int(round(src_w * scale)))
    resized_h = max(height, int(round(src_h * scale)))
    resized = cv2.resize(display, (resized_w, resized_h), interpolation=cv2.INTER_AREA)
    x1 = max(0, (resized_w - width) // 2)
    y1 = max(0, (resized_h - height) // 2)
    return resized[y1:y1 + height, x1:x1 + width].copy()


def render_status_screen(width: int, height: int, title: str, detail: str, failed: bool = False) -> np.ndarray:
    img = blank_screen(width, height)
    app.click_targets = []
    draw_text(img, title, (40, 80), 1.05, COLOR_DANGER if failed else COLOR_SUCCESS, 3)
    if detail:
        draw_text(img, detail[:90], (42, 130), 0.55, COLOR_TEXT, 1)

    if failed:
        retry_rect = (40, height - 88, 240, height - 32)
        back_rect = (260, height - 88, 460, height - 32)
        draw_button(img, retry_rect, "Retry", "", COLOR_DANGER)
        draw_button(img, back_rect, "Programs", "", COLOR_BUTTON_ALT)
        app.click_targets.append(ClickTarget("retry_upload", retry_rect))
        app.click_targets.append(ClickTarget("new_measurement", back_rect))
    else:
        done_rect = (40, height - 88, 280, height - 32)
        draw_button(img, done_rect, "New Measurement", "", COLOR_SUCCESS)
        app.click_targets.append(ClickTarget("new_measurement", done_rect))
    return img


def render_uploading_screen(width: int, height: int) -> np.ndarray:
    img = blank_screen(width, height)
    app.click_targets = []
    draw_text(img, "Uploading measurement session...", (40, 90), 0.9, COLOR_WARNING, 3)
    draw_text(img, "Please wait for cloud confirmation.", (42, 136), 0.58, COLOR_TEXT, 1)
    return img


def draw_shutdown_warning(display: np.ndarray, remaining_seconds: int) -> np.ndarray:
    width = display.shape[1]
    height = display.shape[0]
    panel_h = 116
    y1 = max(0, height - panel_h)
    cv2.rectangle(display, (0, y1), (width, height), (20, 26, 32), -1)
    cv2.rectangle(display, (0, y1), (width, y1 + 4), COLOR_DANGER, -1)
    draw_text(display, f"App will shutdown in {remaining_seconds} sec", (28, y1 + 44), 0.82, COLOR_DANGER, 3)
    draw_text(display, "Touch the screen to continue measuring", (30, y1 + 84), 0.58, COLOR_TEXT, 2)
    return display


def init_camera() -> Any:
    picam2 = edge_detect.Picamera2()
    picam2.configure(
        picam2.create_preview_configuration(
            main={"size": (edge_detect.CAP_W, edge_detect.CAP_H), "format": "RGB888"},
            controls={"FrameRate": edge_detect.FPS},
        )
    )
    picam2.start()
    time.sleep(0.5)
    return picam2


def main() -> int:
    edge_detect.setup_external_display()
    screen_w, screen_h = edge_detect.detect_screen_size()
    edge_detect.SCREEN_W = screen_w
    edge_detect.SCREEN_H = screen_h

    cv2.namedWindow(WINDOW_CLOUD, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_CLOUD, screen_w, screen_h)
    cv2.moveWindow(WINDOW_CLOUD, 0, 0)
    cv2.setWindowProperty(WINDOW_CLOUD, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
    cv2.setMouseCallback(WINDOW_CLOUD, mouse_callback)

    show_splash(256, 256, "Loading camera settings...", 0.15)
    edge_detect.load_params_from_file()
    load_alignment_settings()

    show_splash(screen_w, screen_h, "Connecting to cloud and loading assigned programs...", 0.35)
    app.load_programs()

    show_splash(screen_w, screen_h, "Starting local upload sync...", 0.5)
    app.start_queue_sync()

    show_splash(screen_w, screen_h, "Starting camera...", 0.7)
    picam2 = init_camera()
    show_splash(screen_w, screen_h, "Ready", 1.0)
    time.sleep(0.25)
    app.note_activity()

    try:
        while True:
            edge_detect.process_params_window_events()
            app.update_upload_state()

            if app.state == "programs":
                view = render_program_screen(screen_w, screen_h)
            elif app.state == "sequence":
                view = render_sequence_screen(screen_w, screen_h)
            elif app.state == "uploading":
                view = render_uploading_screen(screen_w, screen_h)
            elif app.state == "uploaded":
                rows = app.upload_result.get("rows_stored") if app.upload_result else len(app.readings)
                view = render_status_screen(screen_w, screen_h, "Measurement stored in cloud", f"Rows stored: {rows}")
            elif app.state == "local_saved":
                rows = app.upload_result.get("rows_stored") if app.upload_result else len(app.readings)
                detail = f"{rows} readings saved locally. Will upload when internet returns."
                view = render_status_screen(screen_w, screen_h, "Measurement saved locally", detail)
            elif app.state == "manual_complete":
                if app.readings:
                    reading = app.readings[-1]
                    detail = f"{reading['reading_label']}: {reading['reading_value']} {reading['unit']} | Not uploaded"
                else:
                    detail = "No values uploaded"
                view = render_status_screen(screen_w, screen_h, "Manual measurement complete", detail)
            elif app.state == "local_complete":
                detail = f"{len(app.readings)} readings captured. Cloud sending was OFF."
                view = render_status_screen(screen_w, screen_h, "Measurement complete", detail)
            elif app.state == "upload_failed":
                view = render_status_screen(screen_w, screen_h, "Upload failed, retry required", app.upload_error, failed=True)
            elif app.state == "manual_live":
                frame = picam2.capture_array()
                params = edge_detect.get_params()
                result = edge_detect.detect_parallel_edges_and_width(frame, params)
                display = draw_detection_overlay(frame.copy(), result, params)
                alignment_status = get_configured_alignment_status(display, result)
                status_text = app.update_manual_display(result, alignment_status)
                view = fit_cover_to_canvas(display, screen_w, screen_h)
                view = draw_manual_hud(view, status_text)
            elif app.state == "program_live":
                frame = picam2.capture_array()
                params = edge_detect.get_params()
                result = edge_detect.detect_parallel_edges_and_width(frame, params)
                display = draw_detection_overlay(frame.copy(), result, params)
                alignment_status = get_configured_alignment_status(display, result)
                status_text = app.update_program_live_display(result, alignment_status)
                view = fit_cover_to_canvas(display, screen_w, screen_h)
                view = draw_program_live_hud(view, status_text)
            else:
                frame = picam2.capture_array()
                params = edge_detect.get_params()
                result = edge_detect.detect_parallel_edges_and_width(frame, params)
                display = draw_detection_overlay(frame.copy(), result, params)
                alignment_status = get_configured_alignment_status(display, result)
                status_text = app.update_measurement_capture(result, alignment_status)
                view = fit_cover_to_canvas(display, screen_w, screen_h)
                view = draw_measurement_hud(view, status_text)

            warning_remaining = app.shutdown_warning_remaining()
            if warning_remaining is not None:
                view = draw_shutdown_warning(view, warning_remaining)

            cv2.imshow(WINDOW_CLOUD, view)
            key = cv2.waitKey(1) & 0xFF
            if key != 255:
                app.note_activity()
            if key == ord("q"):
                break
            if key == ord("r") and app.state in {"programs", "upload_failed"}:
                app.dispatch_action("refresh")
            if key == ord("p"):
                if not edge_detect.params_window_open:
                    edge_detect.open_params_window()
                else:
                    edge_detect.close_params_window()
            if key == ord("c") and app.latest_result is not None:
                if edge_detect.pending_calibration_width_mm is not None and app.latest_result.get("ok"):
                    edge_detect.save_current_calibration(app.latest_result)
                else:
                    edge_detect.open_calibration_input_window()
            if app.maybe_shutdown_for_inactivity():
                break
    except KeyboardInterrupt:
        pass
    finally:
        picam2.stop()
        edge_detect.close_calibration_input_window()
        edge_detect.close_params_window()
        edge_detect.save_params_to_file()
        save_alignment_settings()
        if edge_detect.params_root is not None:
            try:
                edge_detect.params_root.destroy()
            except edge_detect.tk.TclError:
                pass
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
