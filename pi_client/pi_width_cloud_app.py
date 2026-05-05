"""
Cloud-connected Raspberry Pi width-measurement screen.

This script uses edge_detect.py for camera setup, calibration settings,
edge detection, and width calculation. It does not change the detection
algorithm; it only adds cloud program selection, measurement sequencing,
stability capture, countdown, and upload.
"""

from __future__ import annotations

import os
import math
import threading
import time
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np
import requests

import edge_detect
from width_device_client import DeviceClientError, fetch_programs, upload_measurement


WINDOW_CLOUD = "TB Meter"

STABLE_SECONDS = float(os.getenv("WIDTH_STABLE_SECONDS", "1.0"))
COUNTDOWN_SECONDS = int(os.getenv("WIDTH_COUNTDOWN_SECONDS", "3"))
STABLE_TOLERANCE_MM = float(os.getenv("WIDTH_STABLE_TOLERANCE_MM", "0.15"))
STABLE_TOLERANCE_PX = float(os.getenv("WIDTH_STABLE_TOLERANCE_PX", "4.0"))
REQUIRE_CENTER_ALIGNMENT = os.getenv("WIDTH_REQUIRE_CENTER_ALIGNMENT", "true").lower() != "false"
REMOVAL_SECONDS = float(os.getenv("WIDTH_REMOVAL_SECONDS", "0.6"))
AVERAGE_SAMPLE_COUNT = 3

COLOR_BG = (30, 36, 43)
COLOR_PANEL = (245, 248, 250)
COLOR_BUTTON = (23, 107, 135)
COLOR_BUTTON_ALT = (60, 80, 96)
COLOR_TEXT = (255, 255, 255)
COLOR_DARK_TEXT = (20, 30, 40)
COLOR_SUCCESS = (0, 190, 95)
COLOR_WARNING = (0, 190, 255)
COLOR_DANGER = (40, 40, 220)


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

    def load_programs(self) -> None:
        try:
            payload = fetch_programs()
            self.device = payload["device"]
            self.programs = payload["programs"]
            self.message = "Select assigned program"
            self.error_message = "" if self.programs else "No active programs assigned to this device."
        except (DeviceClientError, requests.RequestException) as exc:
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
            self.readings = []
            self.current_index = 0
            self.upload_result = None
            self.upload_error = ""
            self.reset_capture_state()
            self.message = "Manual live width"
            self.state = "manual_live"
        elif action == "program":
            self.selected_program = value
            self.readings = []
            self.current_index = 0
            self.reset_capture_state()
            self.message = "Review expected measurement sequence"
            self.state = "sequence"
        elif action == "next_page":
            self.program_page += 1
        elif action == "prev_page":
            self.program_page = max(0, self.program_page - 1)
        elif action == "back":
            self.state = "programs"
            self.reset_capture_state()
        elif action == "abort":
            self.selected_program = None
            self.readings = []
            self.current_index = 0
            self.reset_capture_state()
            self.message = "Measurement cancelled. No values sent."
            self.state = "programs"
        elif action == "start":
            self.state = "measuring"
            self.message = "Position tape for first reading"
            self.reset_capture_state()
        elif action == "retry_upload":
            self.start_upload()
        elif action == "new_measurement":
            self.selected_program = None
            self.readings = []
            self.current_index = 0
            self.upload_result = None
            self.upload_error = ""
            self.reset_capture_state()
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
            }
        )
        self.current_index += 1
        self.reset_capture_state()

        if self.selected_program and self.current_index >= self.selected_program["required_data_points_per_measurement"]:
            if self.selected_program.get("manual"):
                self.state = "manual_complete"
                self.message = "Manual measurement complete"
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

        def worker() -> None:
            try:
                self.upload_result = upload_measurement(
                    self.selected_program,
                    self.readings,
                    self.device.get("loom_name"),
                )
            except (DeviceClientError, requests.RequestException) as exc:
                self.upload_error = str(exc)

        self.upload_thread = threading.Thread(target=worker, daemon=True)
        self.upload_thread.start()

    def update_upload_state(self) -> None:
        if self.state != "uploading":
            return
        if self.upload_result:
            self.state = "uploaded"
            self.message = "Measurement successfully stored"
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

        self.latest_width = width_value
        self.latest_unit = unit

        aligned = bool(alignment_status.get("aligned")) if REQUIRE_CENTER_ALIGNMENT else True
        can_capture = bool(result.get("ok")) and width_value is not None and aligned
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

    def update_manual_display(self, result: dict[str, Any], alignment_status: dict[str, Any]) -> str:
        width_value, unit, _ = self.apply_detection(result, alignment_status)
        if result.get("ok") and width_value is not None:
            return f"Width live: {width_value:.3f} {unit}"
        return f"Detecting edges: {result.get('msg', 'no reading')}"


app = WidthCloudApp()


def mouse_callback(event: int, x: int, y: int, flags: int, param: Any) -> None:
    if event == cv2.EVENT_LBUTTONDOWN:
        app.handle_click(x, y)


def draw_text(img, text, origin, scale, color=(255,255,255), thickness=2):
    cv2.putText(
        img,
        text,
        origin,
        cv2.FONT_HERSHEY_DUPLEX
        scale,
        color,
        max(2, thickness),   # increase thickness
        cv2.LINE_AA           # keep anti-aliasing
    ) -> None:
    cv2.putText(img, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness, cv2.LINE_AA)


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


def render_program_screen(width: int, height: int) -> np.ndarray:
    img = blank_screen(width, height)
    app.click_targets = []

    draw_text(img, "TB Meter", (30, 55), 1.2, COLOR_TEXT, 3)
    draw_text(img, app.message, (32, 92), 0.65, COLOR_WARNING if app.error_message else COLOR_TEXT, 2)
    if app.error_message:
        draw_text(img, app.error_message[:80], (32, 126), 0.48, COLOR_DANGER, 1)

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

    labels = program["labels_for_each_reading"]
    y = 158 if program.get("manual") else 140
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

    alignment_status = edge_detect.get_center_alignment_status(display, result)
    edge_detect.draw_center_alignment_indicator(display, alignment_status)
    return display


def draw_measurement_hud(display: np.ndarray, status_text: str) -> np.ndarray:
    program = app.selected_program
    if not program:
        return display

    width = display.shape[1]
    app.click_targets = []
    cv2.rectangle(display, (0, 0), (width, 126), (20, 26, 32), -1)
    cv2.rectangle(display, (0, display.shape[0] - 52), (width, display.shape[0]), (20, 26, 32), -1)

    label = app.current_label()
    progress = f"{app.current_index + 1}/{program['required_data_points_per_measurement']}"
    title = "Manual" if program.get("manual") else program["program_name"]
    draw_text(display, f"TB Meter | {title}"[:34], (16, 30), 0.62, COLOR_TEXT, 2)
    draw_text(display, f"{progress}: {label}"[:34], (16, 66), 0.78, COLOR_WARNING, 2)

    status_color = COLOR_SUCCESS if "Stabilized" in status_text or "Captured" in status_text else COLOR_TEXT
    draw_text(display, status_text[:36], (16, 104), 0.66, status_color, 2)

    if app.latest_width is not None:
        draw_text(
            display,
            f"Live width: {app.latest_width:.3f} {app.latest_unit}",
            (width - 335, 108),
            0.58,
            COLOR_TEXT,
            2,
        )

    exit_rect = (width - 128, 16, width - 14, 64)
    draw_button(display, exit_rect, "Exit", "", COLOR_DANGER)
    app.click_targets.append(ClickTarget("abort", exit_rect))

    if status_text.startswith("Stabilized"):
        countdown = status_text.rsplit(" ", 1)[-1]
        draw_text(display, countdown, (width // 2 - 38, display.shape[0] // 2 + 42), 3.0, COLOR_SUCCESS, 7)

    x = 16
    y = display.shape[0] - 18
    for reading in app.readings[-2:]:
        draw_text(
            display,
            f"{reading['reading_label'][:14]}: {reading['reading_value']} {reading['unit']}"[:32],
            (x, y),
            0.46,
            COLOR_SUCCESS,
            1,
        )
        x += 350

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
        draw_text(display, "No width detected", (width // 2 - 180, height // 2 + 20), 0.9, COLOR_DANGER, 3)

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
    edge_detect.load_params_from_file()
    app.load_programs()

    screen_w, screen_h = edge_detect.detect_screen_size()
    edge_detect.SCREEN_W = screen_w
    edge_detect.SCREEN_H = screen_h

    cv2.namedWindow(WINDOW_CLOUD, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WINDOW_CLOUD, screen_w, screen_h)
    cv2.moveWindow(WINDOW_CLOUD, 0, 0)
    cv2.setWindowProperty(WINDOW_CLOUD, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
    cv2.setMouseCallback(WINDOW_CLOUD, mouse_callback)

    picam2 = init_camera()

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
                view = render_status_screen(screen_w, screen_h, "Measurement successfully stored", f"Rows stored: {rows}")
            elif app.state == "manual_complete":
                if app.readings:
                    reading = app.readings[-1]
                    detail = f"{reading['reading_label']}: {reading['reading_value']} {reading['unit']} | Not uploaded"
                else:
                    detail = "No values uploaded"
                view = render_status_screen(screen_w, screen_h, "Manual measurement complete", detail)
            elif app.state == "upload_failed":
                view = render_status_screen(screen_w, screen_h, "Upload failed, retry required", app.upload_error, failed=True)
            elif app.state == "manual_live":
                frame = picam2.capture_array()
                params = edge_detect.get_params()
                result = edge_detect.detect_parallel_edges_and_width(frame, params)
                display = draw_detection_overlay(frame.copy(), result, params)
                alignment_status = edge_detect.get_center_alignment_status(display, result)
                status_text = app.update_manual_display(result, alignment_status)
                view = fit_cover_to_canvas(display, screen_w, screen_h)
                view = draw_manual_hud(view, status_text)
            else:
                frame = picam2.capture_array()
                params = edge_detect.get_params()
                result = edge_detect.detect_parallel_edges_and_width(frame, params)
                display = draw_detection_overlay(frame.copy(), result, params)
                alignment_status = edge_detect.get_center_alignment_status(display, result)
                status_text = app.update_measurement_capture(result, alignment_status)
                view = fit_cover_to_canvas(display, screen_w, screen_h)
                view = draw_measurement_hud(view, status_text)

            cv2.imshow(WINDOW_CLOUD, view)
            key = cv2.waitKey(1) & 0xFF
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
    except KeyboardInterrupt:
        pass
    finally:
        picam2.stop()
        edge_detect.close_calibration_input_window()
        edge_detect.close_params_window()
        edge_detect.save_params_to_file()
        if edge_detect.params_root is not None:
            try:
                edge_detect.params_root.destroy()
            except edge_detect.tk.TclError:
                pass
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
