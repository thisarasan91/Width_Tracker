import os
import json
import time
import math
import subprocess
import tkinter as tk
import cv2
import numpy as np
from picamera2 import Picamera2

# =========================================================
# CONFIG
# =========================================================
CAP_W, CAP_H = 3280, 2464
FPS = 5

WINDOW_MAIN = "Width Measurement"
WINDOW_PARAMS = "Parameters"
WINDOW_GAP = 20
MAX_VERTICAL_ANGLE_DEG = 45.0

USE_MM = False
MM_PER_PIXEL = 0.10   # set after calibration

# Force GUI to external display when running remotely
FORCE_EXTERNAL_DISPLAY = True
DEFAULT_DISPLAY = ":0"
DEFAULT_XAUTHORITY = "/home/pi/.Xauthority"   # change username if needed
SETTINGS_FILE = "edge_detect_settings.json"
UI_SCALE_MULTIPLIER = 1.6
CENTER_ALIGN_TOL_RATIO = 0.03
ANGLE_ALIGN_TOL_DEG = 2.0
UI_FONT = cv2.FONT_HERSHEY_TRIPLEX
FONT_THICKNESS_SCALE = float(os.getenv("WIDTH_FONT_THICKNESS_SCALE", "0.55"))

# Button area on main GUI
BTN_X1, BTN_Y1, BTN_X2, BTN_Y2 = 20, 20, 180, 70
CAL_BTN_W, CAL_BTN_H = 320, 70

params_window_open = False
SCREEN_W = None
SCREEN_H = None
params_root = None
params_window = None
calibration_input_window = None
calibration_input_var = None
calibration_status = "Not calibrated"
latest_frame = None
latest_params = None
latest_result = None
latest_display_shape = None
pending_calibration_width_mm = None

DEFAULT_PARAMS = {
    "brightness": 0,
    "contrast": 0,
    "blur": 5,
    "canny_low": 50,
    "canny_high": 150,
    "hough_th": 60,
    "min_line_len": 120,
    "max_line_gap": 20,
    "angle_tol": 12,
    "roi_top": 15,
    "roi_bottom": 85,
    "min_sep_px": 30,
    "show_edges": 1,
}

PARAM_SPECS = [
    ("brightness", "Brightness", -100, 100),
    ("contrast", "Contrast", -100, 100),
    ("blur", "Blur", 1, 31),
    ("canny_low", "Canny Low", 0, 255),
    ("canny_high", "Canny High", 0, 255),
    ("hough_th", "Hough Th", 1, 300),
    ("min_line_len", "Min Line Len", 5, 1000),
    ("max_line_gap", "Max Line Gap", 0, 200),
    ("angle_tol", "Angle Tol", 1, 45),
    ("roi_top", "ROI Top %", 0, 100),
    ("roi_bottom", "ROI Bottom %", 0, 100),
    ("min_sep_px", "Min Sep px", 1, 500),
    ("show_edges", "Show Edges", 0, 1),
]

def font_thickness(value):
    return max(1, int(round(float(value) * FONT_THICKNESS_SCALE)))

params_values = DEFAULT_PARAMS.copy()
params_vars = {}


# =========================================================
# DISPLAY HELPERS
# =========================================================
def setup_external_display():
    """
    Force OpenCV GUI to use Raspberry Pi local desktop display
    when script is launched remotely from VS Code / SSH.
    """
    if not FORCE_EXTERNAL_DISPLAY:
        return

    # If DISPLAY is missing, force to local desktop
    if not os.environ.get("DISPLAY"):
        os.environ["DISPLAY"] = DEFAULT_DISPLAY

    # Wayland can sometimes cause issues with cv2.imshow from remote launch
    if not os.environ.get("XDG_SESSION_TYPE"):
        os.environ["XDG_SESSION_TYPE"] = "x11"

    # Set XAUTHORITY if missing
    if not os.environ.get("XAUTHORITY") and os.path.exists(DEFAULT_XAUTHORITY):
        os.environ["XAUTHORITY"] = DEFAULT_XAUTHORITY

def detect_screen_size():
    """
    Try to read actual external display resolution from xrandr.
    Falls back to 800x480 for 5-inch LCD.
    """
    try:
        env = os.environ.copy()
        out = subprocess.check_output(["xrandr"], env=env, text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            if " connected" in line and "+" in line:
                parts = line.split()
                for p in parts:
                    if "x" in p and "+" in p:
                        res = p.split("+")[0]
                        w, h = res.split("x")
                        return int(w), int(h)
    except Exception:
        pass
    return 800, 480  # fallback for 5-inch LCD

def has_display() -> bool:
    return bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))

def fit_to_screen(frame, screen_w, screen_h):
    h, w = frame.shape[:2]
    scale = min(screen_w / w, screen_h / h)
    new_w = max(1, int(w * scale))
    new_h = max(1, int(h * scale))
    return cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

def is_window_open(window_name):
    try:
        return cv2.getWindowProperty(window_name, cv2.WND_PROP_VISIBLE) >= 1
    except cv2.error:
        return False

def apply_main_window_layout():
    if SCREEN_W is None or SCREEN_H is None:
        return

    if params_window_open:
        params_w = min(420, max(320, SCREEN_W // 3))
        main_w = max(320, SCREEN_W - params_w - WINDOW_GAP)
        main_h = min(SCREEN_H, 720)
        cv2.resizeWindow(WINDOW_MAIN, main_w, main_h)
        cv2.moveWindow(WINDOW_MAIN, params_w + WINDOW_GAP, 0)
    else:
        cv2.resizeWindow(WINDOW_MAIN, SCREEN_W, SCREEN_H)
        cv2.moveWindow(WINDOW_MAIN, 0, 0)

def get_main_view_size():
    if SCREEN_W is None or SCREEN_H is None:
        return None, None

    if params_window_open:
        params_w = min(420, max(320, SCREEN_W // 3))
        return max(320, SCREEN_W - params_w - WINDOW_GAP), SCREEN_H

    return SCREEN_W, SCREEN_H

def get_params_window_geometry():
    params_w = min(420, max(320, SCREEN_W // 3 if SCREEN_W else 420))
    params_h = min(520, SCREEN_H if SCREEN_H else 520)
    return params_w, params_h

def get_settings_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), SETTINGS_FILE)

def load_params_from_file():
    global params_values, USE_MM, MM_PER_PIXEL, calibration_status

    settings_path = get_settings_path()
    if not os.path.exists(settings_path):
        return

    try:
        with open(settings_path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return

    if not isinstance(data, dict):
        return

    loaded = DEFAULT_PARAMS.copy()
    for key, _, min_val, max_val in PARAM_SPECS:
        value = data.get(key, loaded[key])
        if not isinstance(value, int):
            continue
        loaded[key] = clamp(value, min_val, max_val)

    params_values = loaded
    USE_MM = bool(data.get("use_mm", USE_MM))

    mm_per_pixel = data.get("mm_per_pixel", MM_PER_PIXEL)
    if isinstance(mm_per_pixel, (int, float)) and mm_per_pixel > 0:
        MM_PER_PIXEL = float(mm_per_pixel)

    calibration_status = (
        f"Loaded calibration: {MM_PER_PIXEL:.6f} mm/px" if USE_MM else "Not calibrated"
    )

def save_params_to_file():
    settings_path = get_settings_path()
    payload = {}

    if os.path.exists(settings_path):
        try:
            with open(settings_path, "r", encoding="utf-8") as handle:
                existing_payload = json.load(handle)
            if isinstance(existing_payload, dict):
                payload.update(existing_payload)
        except Exception:
            payload = {}

    for key, _, min_val, max_val in PARAM_SPECS:
        payload[key] = clamp(int(params_values[key]), min_val, max_val)
    payload["use_mm"] = USE_MM
    payload["mm_per_pixel"] = MM_PER_PIXEL

    try:
        with open(settings_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
    except Exception:
        pass


# =========================================================
# UTILS
# =========================================================
def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def get_ui_scale(img):
    h, w = img.shape[:2]
    return max(1.4, min(w / 1920.0, h / 1080.0) * UI_SCALE_MULTIPLIER)

def get_scaled_rect(img, rect):
    scale = get_ui_scale(img)
    x1, y1, x2, y2 = rect
    x1 = int(round(x1 * scale))
    y1 = int(round(y1 * scale))
    x2 = int(round(x2 * scale))
    y2 = int(round(y2 * scale))
    return x1, y1, x2, y2

def get_cal_button_rect(img):
    scale = get_ui_scale(img)
    btn_w = int(round(CAL_BTN_W * scale))
    btn_h = int(round(CAL_BTN_H * scale))
    margin = int(round(20 * scale))
    x2 = img.shape[1] - margin
    y1 = margin
    x1 = max(margin, x2 - btn_w)
    y2 = y1 + btn_h
    return x1, y1, x2, y2

def draw_button(img, rect, text, active=False):
    if rect is None or rect == "cal":
        x1, y1, x2, y2 = get_cal_button_rect(img)
    else:
        x1, y1, x2, y2 = get_scaled_rect(img, rect)
    scale = get_ui_scale(img)
    color = (0, 180, 255) if not active else (0, 255, 120)
    cv2.rectangle(img, (x1, y1), (x2, y2), color, -1)
    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 0), max(2, int(round(2 * scale))))
    text_size, _ = cv2.getTextSize(
        text,
        UI_FONT,
        0.9 * scale,
        font_thickness(2 * scale),
    )
    text_x = x1 + max(8, (x2 - x1 - text_size[0]) // 2)
    text_y = y1 + max(text_size[1] + 6, (y2 - y1 + text_size[1]) // 2)
    cv2.putText(
        img,
        text,
        (text_x, text_y),
        UI_FONT,
        0.9 * scale,
        (0, 0, 0),
        font_thickness(2 * scale),
        cv2.LINE_AA,
    )

def get_center_alignment_status(img, result):
    h, w = img.shape[:2]
    cx = w // 2
    cy = h // 2
    tol_px = max(12.0, w * CENTER_ALIGN_TOL_RATIO)

    aligned = False
    tape_center_offset_px = None
    angle_error_deg = None

    if result is not None and result.get("ok") and result.get("midline") is not None:
        (mx1, my1), (mx2, my2) = result["midline"]
        if my2 != my1:
            t = ( cy - my1) / float(my2 - my1)
            mid_x_at_center = mx1 + t * (mx2 - mx1)
            tape_center_offset_px = float(mid_x_at_center - cx)
        else:
            tape_center_offset_px = float(((mx1 + mx2) * 0.5) - cx)

        angle_deg = result.get("angle_deg")
        if angle_deg is not None:
            angle_error_deg = abs(float(angle_deg) - 90.0)

        aligned = (
            tape_center_offset_px is not None
            and angle_error_deg is not None
            and abs(tape_center_offset_px) <= tol_px
            and angle_error_deg <= ANGLE_ALIGN_TOL_DEG
        )

    return {
        "aligned": aligned,
        "offset_px": tape_center_offset_px,
        "angle_error_deg": angle_error_deg,
    }

def draw_center_alignment_indicator(img, alignment_status):
    scale = get_ui_scale(img)
    h, w = img.shape[:2]
    cx = w // 2
    cy = h // 2
    arm = max(18, int(round(24 * scale)))
    gap = max(8, int(round(10 * scale)))
    thickness = max(2, int(round(3 * scale)))

    aligned = alignment_status.get("aligned", False)
    tape_center_offset_px = alignment_status.get("offset_px")
    angle_error_deg = alignment_status.get("angle_error_deg")
    color = (0, 255, 0) if aligned else (0, 220, 255)

    cv2.line(img, (cx - arm, cy), (cx - gap, cy), color, thickness, cv2.LINE_AA)
    cv2.line(img, (cx + gap, cy), (cx + arm, cy), color, thickness, cv2.LINE_AA)
    cv2.line(img, (cx, cy - arm), (cx, cy - gap), color, thickness, cv2.LINE_AA)
    cv2.line(img, (cx, cy + gap), (cx, cy + arm), color, thickness, cv2.LINE_AA)
    cv2.circle(img, (cx, cy), max(5, int(round(6 * scale))), color, thickness, cv2.LINE_AA)

    if tape_center_offset_px is not None and angle_error_deg is not None:
        status = (
            f"Center guide: aligned"
            if aligned
            else f"Center guide: move {tape_center_offset_px:+.0f}px, angle {angle_error_deg:.1f}deg"
        )
        cv2.putText(
            img,
            status,
            (int(round(20 * scale)), int(round(200 * scale))),
            UI_FONT,
            0.55 * scale,
            color,
            font_thickness(2 * scale),
            cv2.LINE_AA,
        )

def map_view_point_to_display(x, y, view_img):
    if latest_display_shape is None or view_img is None:
        return x, y

    display_h, display_w = latest_display_shape[:2]
    view_h, view_w = view_img.shape[:2]
    if view_w <= 0 or view_h <= 0:
        return x, y

    disp_x = int(round(x * display_w / view_w))
    disp_y = int(round(y * display_h / view_h))
    return clamp(disp_x, 0, display_w - 1), clamp(disp_y, 0, display_h - 1)

def close_calibration_input_window():
    global calibration_input_window, calibration_input_var
    if calibration_input_window is not None:
        try:
            calibration_input_window.destroy()
        except tk.TclError:
            pass
        calibration_input_window = None
    calibration_input_var = None

def adjust_calibration_width(delta_mm):
    if calibration_input_var is None:
        return
    try:
        current = float(calibration_input_var.get())
    except (TypeError, ValueError):
        current = 1.0
    current = max(0.001, current + delta_mm)
    calibration_input_var.set(f"{current:.3f}")

def apply_calibration_width_and_close():
    global pending_calibration_width_mm, calibration_status
    if calibration_input_var is None:
        close_calibration_input_window()
        return
    try:
        width_mm = float(calibration_input_var.get())
    except (TypeError, ValueError):
        calibration_status = "Calibration input invalid"
        close_calibration_input_window()
        return
    if width_mm <= 0:
        calibration_status = "Calibration width must be > 0"
        close_calibration_input_window()
        return
    pending_calibration_width_mm = width_mm
    calibration_status = f"Calibration armed: {width_mm:.3f} mm"
    close_calibration_input_window()

def open_calibration_input_window():
    global params_root, calibration_input_window, calibration_input_var

    if params_root is None:
        params_root = tk.Tk()
        params_root.withdraw()

    if calibration_input_window is not None:
        try:
            calibration_input_window.lift()
            calibration_input_window.focus_force()
        except tk.TclError:
            calibration_input_window = None
        else:
            return

    calibration_input_window = tk.Toplevel(params_root)
    calibration_input_window.title("Calibration Width")
    calibration_input_window.geometry("420x320+40+40")
    calibration_input_window.resizable(False, False)
    calibration_input_window.protocol("WM_DELETE_WINDOW", close_calibration_input_window)

    frame = tk.Frame(calibration_input_window, padx=16, pady=16)
    frame.pack(fill="both", expand=True)

    tk.Label(frame, text="Enter Object Width (mm)", font=("TkDefaultFont", 16)).pack(pady=(0, 12))

    initial_width = pending_calibration_width_mm if pending_calibration_width_mm is not None else 1.000
    calibration_input_var = tk.StringVar(value=f"{initial_width:.3f}")
    tk.Label(
        frame,
        textvariable=calibration_input_var,
        relief="sunken",
        width=12,
        font=("TkDefaultFont", 22),
        bg="white",
    ).pack(pady=(0, 16))

    for row in ((-1.0, "-1.00", -0.1, "-0.10"), (0.1, "+0.10", 1.0, "+1.00")):
        row_frame = tk.Frame(frame)
        row_frame.pack(fill="x", pady=6)
        tk.Button(
            row_frame,
            text=row[1],
            height=2,
            width=10,
            command=lambda delta=row[0]: adjust_calibration_width(delta),
        ).pack(side="left", expand=True, fill="x", padx=6)
        tk.Button(
            row_frame,
            text=row[3],
            height=2,
            width=10,
            command=lambda delta=row[2]: adjust_calibration_width(delta),
        ).pack(side="left", expand=True, fill="x", padx=6)

    action_row = tk.Frame(frame)
    action_row.pack(fill="x", pady=(18, 0))
    tk.Button(
        action_row,
        text="Cancel",
        height=2,
        width=12,
        command=close_calibration_input_window,
    ).pack(side="left", expand=True, fill="x", padx=6)
    tk.Button(
        action_row,
        text="Use Width",
        height=2,
        width=12,
        command=apply_calibration_width_and_close,
    ).pack(side="left", expand=True, fill="x", padx=6)

def save_current_calibration(result):
    global USE_MM, MM_PER_PIXEL, calibration_status, pending_calibration_width_mm

    if pending_calibration_width_mm is None:
        calibration_status = "Calibration width not entered"
        return
    if result is None or not result.get("ok") or not result.get("width_px"):
        calibration_status = "Calibration failed: no valid edge measurement"
        return

    MM_PER_PIXEL = pending_calibration_width_mm / float(result["width_px"])
    USE_MM = True
    calibration_status = (
        f"Calibration saved: {pending_calibration_width_mm:.3f} mm / {result['width_px']:.2f} px"
    )
    pending_calibration_width_mm = None
    save_params_to_file()

def point_line_distance_signed(pt, line_point, normal):
    v = np.array(pt, dtype=np.float32) - np.array(line_point, dtype=np.float32)
    return float(np.dot(v, normal))

def line_intersections_with_rect(line_point, line_dir, x_min, y_min, x_max, y_max):
    px, py = line_point
    dx, dy = line_dir
    pts = []
    eps = 1e-9

    if abs(dx) > eps:
        t = (x_min - px) / dx
        y = py + t * dy
        if y_min <= y <= y_max:
            pts.append((int(round(x_min)), int(round(y))))

        t = (x_max - px) / dx
        y = py + t * dy
        if y_min <= y <= y_max:
            pts.append((int(round(x_max)), int(round(y))))

    if abs(dy) > eps:
        t = (y_min - py) / dy
        x = px + t * dx
        if x_min <= x <= x_max:
            pts.append((int(round(x)), int(round(y_min))))

        t = (y_max - py) / dy
        x = px + t * dx
        if x_min <= x <= x_max:
            pts.append((int(round(x)), int(round(y_max))))

    uniq = []
    for p in pts:
        if p not in uniq:
            uniq.append(p)

    if len(uniq) >= 2:
        return uniq[0], uniq[1]
    return None, None

def circular_angle_mean_deg(angles_deg):
    if len(angles_deg) == 0:
        return None
    ang = np.deg2rad(np.array(angles_deg) * 2.0)
    s = np.mean(np.sin(ang))
    c = np.mean(np.cos(ang))
    mean2 = math.atan2(s, c)
    return np.rad2deg(mean2) / 2.0

def angle_diff_deg(a, b):
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)

def vertical_angle_diff_deg(angle_deg):
    return angle_diff_deg(angle_deg, 90.0)

def line_points_from_xy_fit(slope_xy, intercept_xy, y1, y2):
    x1 = int(round(slope_xy * y1 + intercept_xy))
    x2 = int(round(slope_xy * y2 + intercept_xy))
    return (x1, y1), (x2, y2)

def perpendicular_segment_between_parallel_lines(slope_xy, intercept1, intercept2, y_center):
    x1 = slope_xy * y_center + intercept1
    x2 = slope_xy * y_center + intercept2
    denom = 1.0 + slope_xy * slope_xy
    delta_b = intercept2 - intercept1

    # Move from line 1 to line 2 along the shared normal direction.
    dx = delta_b / denom
    dy = -slope_xy * delta_b / denom

    pt1 = (int(round(x1)), int(round(y_center)))
    pt2 = (int(round(x1 + dx)), int(round(y_center + dy)))
    return pt1, pt2

def build_edges_preview(frame_shape, result):
    preview = np.zeros(frame_shape, dtype=np.uint8)
    edges = result["edges"]
    _, y1, _, y2 = result["roi_box"]
    ui_scale = get_ui_scale(preview)

    edge_bgr = cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)
    edge_bgr[:, :, 1] = 0
    edge_bgr[:, :, 0] = 0
    preview[y1:y2, :] = edge_bgr

    cv2.rectangle(preview, (0, y1), (preview.shape[1] - 1, y2), (80, 80, 80), 2)
    cv2.putText(preview, "Edge View", (20, 40),
                UI_FONT, 1.0 * ui_scale, (255, 255, 255),
                font_thickness(2 * ui_scale), cv2.LINE_AA)
    return preview

def build_main_view(display, result):
    if not params_window_open:
        return display

    _, y1, _, y2 = result["roi_box"]
    roi_display = display[y1:y2, :]
    roi_edges = build_edges_preview(display.shape, result)[y1:y2, :]

    if roi_display.size == 0 or roi_edges.size == 0:
        return display

    half_h = max(120, display.shape[0] // 2)
    top_view = cv2.resize(roi_display, (display.shape[1], half_h), interpolation=cv2.INTER_AREA)
    bottom_view = cv2.resize(roi_edges, (display.shape[1], half_h), interpolation=cv2.INTER_AREA)
    ui_scale = get_ui_scale(top_view)
    cv2.putText(top_view, "ROI View", (20, 40),
                UI_FONT, 1.0 * ui_scale, (255, 255, 255),
                font_thickness(2 * ui_scale), cv2.LINE_AA)
    return np.vstack((top_view, bottom_view))

def on_params_window_closed():
    close_params_window()

def set_param_var(key, value):
    for param_key, _, min_val, max_val in PARAM_SPECS:
        if param_key == key:
            clamped_value = clamp(value, min_val, max_val)
            params_values[key] = clamped_value
            if key in params_vars:
                params_vars[key].set(str(clamped_value))
            return

def adjust_param_value(key, delta):
    current_value = params_values.get(key, DEFAULT_PARAMS[key])
    if key in params_vars:
        raw_value = params_vars[key].get().strip()
        if raw_value:
            try:
                current_value = int(raw_value)
            except ValueError:
                current_value = params_values.get(key, DEFAULT_PARAMS[key])

    set_param_var(key, current_value + delta)

def create_params_window():
    global params_root, params_window, params_vars

    if params_root is None:
        params_root = tk.Tk()
        params_root.withdraw()

    params_w, params_h = get_params_window_geometry()

    params_window = tk.Toplevel(params_root)
    params_window.title(WINDOW_PARAMS)
    params_window.geometry(f"{params_w}x{params_h}+0+0")
    params_window.resizable(False, False)
    params_window.protocol("WM_DELETE_WINDOW", on_params_window_closed)

    container = tk.Frame(params_window, padx=8, pady=8)
    container.pack(fill="both", expand=True)

    params_vars = {}
    for row_idx, (key, label, min_val, max_val) in enumerate(PARAM_SPECS):
        tk.Label(container, text=label, anchor="w", width=14).grid(
            row=row_idx, column=0, sticky="w", padx=(0, 8), pady=3
        )

        tk.Button(
            container,
            text="-",
            width=3,
            command=lambda current_key=key: adjust_param_value(current_key, -1),
        ).grid(row=row_idx, column=1, padx=(0, 4), pady=3)

        var = tk.StringVar(value=str(params_values[key]))
        params_vars[key] = var

        value_label = tk.Label(
            container,
            textvariable=var,
            width=6,
            relief="sunken",
            anchor="center",
            bg="white",
        )
        value_label.grid(row=row_idx, column=2, padx=2, pady=3)

        tk.Button(
            container,
            text="+",
            width=3,
            command=lambda current_key=key: adjust_param_value(current_key, 1),
        ).grid(row=row_idx, column=3, padx=(4, 8), pady=3)

        entry = tk.Entry(container, textvariable=var, width=7, justify="center")
        entry.grid(row=row_idx, column=4, sticky="ew", pady=3)

        tk.Label(container, text=f"{min_val}-{max_val}", anchor="w", width=9).grid(
            row=row_idx, column=5, sticky="w", pady=3
        )

    container.columnconfigure(4, weight=1)

    tk.Label(
        container,
        text="Type values directly. Invalid input keeps last value.",
        anchor="w",
        justify="left",
    ).grid(row=len(PARAM_SPECS), column=0, columnspan=6, sticky="w", pady=(10, 0))

def close_params_window():
    global params_window_open, params_window, params_vars
    get_params()
    save_params_to_file()
    if params_window is not None:
        try:
            params_window.destroy()
        except tk.TclError:
            pass
        params_window = None
    params_vars = {}
    params_window_open = False
    apply_main_window_layout()

def sync_params_window_state():
    global params_window_open
    if params_window_open and params_window is None:
        params_window_open = False
        apply_main_window_layout()

def open_params_window():
    global params_window_open
    if params_window_open and params_window is not None:
        return

    create_params_window()
    params_window_open = True
    apply_main_window_layout()

def process_params_window_events():
    global params_window, params_window_open

    if params_root is None:
        return

    try:
        params_root.update_idletasks()
        params_root.update()
    except tk.TclError:
        params_window = None
        params_window_open = False
        apply_main_window_layout()

def get_params():
    sync_params_window_state()

    if not params_window_open:
        return params_values.copy()

    for key, _, min_val, max_val in PARAM_SPECS:
        raw_value = params_vars[key].get().strip()
        if not raw_value:
            continue
        try:
            parsed_value = int(raw_value)
        except ValueError:
            continue
        params_values[key] = clamp(parsed_value, min_val, max_val)

    blur = params_values["blur"]
    if blur < 1:
        blur = 1
    if blur % 2 == 0:
        blur += 1

    roi_top = params_values["roi_top"]
    roi_bottom = params_values["roi_bottom"]
    if roi_bottom <= roi_top + 5:
        roi_bottom = min(100, roi_top + 5)
        params_values["roi_bottom"] = roi_bottom
        if "roi_bottom" in params_vars:
            params_vars["roi_bottom"].set(roi_bottom)

    params_values["blur"] = blur

    return {
        "brightness": params_values["brightness"],
        "contrast": params_values["contrast"],
        "blur": blur,
        "canny_low": params_values["canny_low"],
        "canny_high": params_values["canny_high"],
        "hough_th": max(1, params_values["hough_th"]),
        "min_line_len": max(5, params_values["min_line_len"]),
        "max_line_gap": params_values["max_line_gap"],
        "angle_tol": max(1, params_values["angle_tol"]),
        "roi_top": roi_top,
        "roi_bottom": roi_bottom,
        "min_sep_px": max(1, params_values["min_sep_px"]),
        "show_edges": params_values["show_edges"],
    }


# =========================================================
# DETECTION
# =========================================================
def apply_image_adjustments(image, params):
    brightness = params.get("brightness", 0)
    contrast = params.get("contrast", 0)

    if brightness == 0 and contrast == 0:
        return image

    alpha = 1.0 + (contrast / 100.0)
    alpha = max(0.1, alpha)
    beta = brightness
    return cv2.convertScaleAbs(image, alpha=alpha, beta=beta)

def extract_roi(frame_bgr, params):
    h, w = frame_bgr.shape[:2]
    y1 = int(h * params["roi_top"] / 100.0)
    y2 = int(h * params["roi_bottom"] / 100.0)
    y1 = clamp(y1, 0, h - 1)
    y2 = clamp(y2, y1 + 1, h)
    roi = frame_bgr[y1:y2, :].copy()
    roi = apply_image_adjustments(roi, params)
    return roi, y1, y2, w

def build_vertical_profile(gray):
    sobel_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    abs_sobel = np.abs(sobel_x)
    profile = abs_sobel.mean(axis=0)
    smooth_width = max(9, (gray.shape[1] // 40) | 1)
    profile = cv2.GaussianBlur(profile.reshape(1, -1), (smooth_width, 1), 0).ravel()
    edge_strength = np.clip(abs_sobel, 0, 255).astype(np.uint8)
    return sobel_x, profile, edge_strength

def detect_parallel_edges_and_width(frame_bgr, params):
    roi, y1, y2, w = extract_roi(frame_bgr, params)

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (params["blur"], params["blur"]), 0)
    sobel_x, _, edge_strength = build_vertical_profile(gray)
    left_response = np.clip(-sobel_x, 0, None)
    right_response = np.clip(sobel_x, 0, None)

    profile_left = cv2.GaussianBlur(left_response.mean(axis=0).reshape(1, -1), (max(9, (w // 40) | 1), 1), 0).ravel()
    profile_right = cv2.GaussianBlur(right_response.mean(axis=0).reshape(1, -1), (max(9, (w // 40) | 1), 1), 0).ravel()

    result = {
        "ok": False,
        "edges": edge_strength,
        "roi_box": (0, y1, w, y2),
        "line1": None,
        "line2": None,
        "midline": None,
        "width_px": None,
        "width_mm": None,
        "angle_deg": None,
        "segment1": None,
        "segment2": None,
        "msg": "No tape edges found"
    }

    min_sep = params["min_sep_px"]
    center_x = w // 2
    left_end = max(min_sep, center_x - max(10, min_sep // 2))
    right_start = min(w - min_sep, center_x + max(10, min_sep // 2))

    if left_end <= 1 or right_start >= w - 1:
        result["msg"] = "ROI too narrow for requested separation"
        return result

    left_x = int(np.argmax(profile_left[:left_end]))
    right_x = int(np.argmax(profile_right[right_start:]) + right_start)
    width_px = float(right_x - left_x)
    if width_px < params["min_sep_px"]:
        result["msg"] = f"Separation too small: {width_px:.1f}px"
        return result

    left_peak = float(profile_left[left_x])
    right_peak = float(profile_right[right_x])
    if left_peak <= 0 or right_peak <= 0:
        result["msg"] = "Edge peaks too weak"
        return result

    row_left_points = []
    row_right_points = []
    roi_h = gray.shape[0]
    search_margin = max(20, int(width_px * 0.20))
    min_row_strength = max(10.0, min(left_peak, right_peak) * 0.20)

    for row_idx in range(roi_h):
        left_col_start = max(0, left_x - search_margin)
        left_col_end = min(w, left_x + search_margin + 1)
        right_col_start = max(0, right_x - search_margin)
        right_col_end = min(w, right_x + search_margin + 1)

        left_slice = left_response[row_idx, left_col_start:left_col_end]
        right_slice = right_response[row_idx, right_col_start:right_col_end]

        if left_slice.size == 0 or right_slice.size == 0:
            continue

        local_left_idx = int(np.argmax(left_slice))
        local_right_idx = int(np.argmax(right_slice))
        local_left_val = float(left_slice[local_left_idx])
        local_right_val = float(right_slice[local_right_idx])

        if local_left_val >= min_row_strength:
            row_left_points.append((row_idx + y1, local_left_idx + left_col_start))
        if local_right_val >= min_row_strength:
            row_right_points.append((row_idx + y1, local_right_idx + right_col_start))

    if len(row_left_points) < max(10, roi_h // 6) or len(row_right_points) < max(10, roi_h // 6):
        result["msg"] = "Not enough edge points"
        return result

    left_y = np.array([p[0] for p in row_left_points], dtype=np.float32)
    left_xs = np.array([p[1] for p in row_left_points], dtype=np.float32)
    right_y = np.array([p[0] for p in row_right_points], dtype=np.float32)
    right_xs = np.array([p[1] for p in row_right_points], dtype=np.float32)

    left_slope, left_intercept = np.polyfit(left_y, left_xs, 1)
    right_slope, right_intercept = np.polyfit(right_y, right_xs, 1)
    mean_slope = float((left_slope + right_slope) * 0.5)

    # Keep both edges parallel and limited to at most 45 degrees from vertical.
    angle_from_vertical = abs(math.degrees(math.atan(mean_slope)))
    if angle_from_vertical > MAX_VERTICAL_ANGLE_DEG:
        result["msg"] = "Detected angle exceeds vertical limit"
        return result

    y_mid = float((y1 + y2 - 1) * 0.5)
    left_mid_x = float(left_slope * y_mid + left_intercept)
    right_mid_x = float(right_slope * y_mid + right_intercept)

    left_intercept = left_mid_x - mean_slope * y_mid
    right_intercept = right_mid_x - mean_slope * y_mid
    width_px = abs(right_intercept - left_intercept) / math.sqrt(1.0 + mean_slope * mean_slope)
    if width_px < params["min_sep_px"]:
        result["msg"] = f"Separation too small: {width_px:.1f}px"
        return result

    p1a, p1b = line_points_from_xy_fit(mean_slope, left_intercept, y1, y2 - 1)
    p2a, p2b = line_points_from_xy_fit(mean_slope, right_intercept, y1, y2 - 1)
    mid_intercept = ((left_mid_x + right_mid_x) * 0.5) - mean_slope * y_mid
    pm1, pm2 = line_points_from_xy_fit(mean_slope, mid_intercept, y1, y2 - 1)
    foot1, foot2 = perpendicular_segment_between_parallel_lines(
        mean_slope, left_intercept, right_intercept, y_mid
    )

    width_mm = width_px * MM_PER_PIXEL if USE_MM else None

    result.update({
        "ok": True,
        "line1": (p1a, p1b),
        "line2": (p2a, p2b),
        "midline": (pm1, pm2) if pm1 is not None else None,
        "width_px": width_px,
        "width_mm": width_mm,
        "angle_deg": 90.0 - math.degrees(math.atan(mean_slope)),
        "segment1": foot1,
        "segment2": foot2,
        "msg": "OK"
    })

    return result


# =========================================================
# GUI / MOUSE
# =========================================================
def mouse_callback(event, x, y, flags, param):
    global params_window_open, calibration_status
    img = param if param is not None else np.zeros((CAP_H, CAP_W, 3), dtype=np.uint8)

    if event == cv2.EVENT_LBUTTONDOWN:
        px1, py1, px2, py2 = get_scaled_rect(img, (BTN_X1, BTN_Y1, BTN_X2, BTN_Y2))
        cx1, cy1, cx2, cy2 = get_cal_button_rect(img)

        if px1 <= x <= px2 and py1 <= y <= py2:
            if not params_window_open:
                open_params_window()
            else:
                close_params_window()
        elif cx1 <= x <= cx2 and cy1 <= y <= cy2:
            if pending_calibration_width_mm is not None and latest_result is not None and latest_result.get("ok"):
                save_current_calibration(latest_result)
            else:
                open_calibration_input_window()


# =========================================================
# MAIN
# =========================================================
def run_standalone_edge_detector():
    global SCREEN_W, SCREEN_H, latest_frame, latest_params, latest_result, latest_display_shape

    setup_external_display()
    load_params_from_file()
    print("DISPLAY =", os.environ.get("DISPLAY"))
    print("XAUTHORITY =", os.environ.get("XAUTHORITY"))

    picam2 = Picamera2()
    picam2.configure(
        picam2.create_preview_configuration(
            main={"size": (CAP_W, CAP_H), "format": "RGB888"},
            controls={"FrameRate": FPS}
        )
    )
    picam2.start()
    time.sleep(0.5)

    use_gui = has_display()
    print("GUI mode:", use_gui)

    if use_gui:
        SCREEN_W, SCREEN_H = detect_screen_size()
        print("Detected screen:", SCREEN_W, "x", SCREEN_H)

        cv2.namedWindow(WINDOW_MAIN, cv2.WINDOW_NORMAL)

        apply_main_window_layout()

        cv2.setMouseCallback(WINDOW_MAIN, mouse_callback, np.zeros((480, 800, 3), dtype=np.uint8))

    try:
        while True:
            if use_gui:
                process_params_window_events()

            frame = picam2.capture_array()

            params = get_params()
            latest_frame = frame.copy()
            latest_params = params.copy()
            result = detect_parallel_edges_and_width(frame, params)
            latest_result = result

            display = frame.copy()
            ui_scale = get_ui_scale(display)
            overlay_thickness = max(2, int(round(2 * ui_scale)))
            _, ry1, _, ry2 = result["roi_box"]
            display[ry1:ry2, :] = apply_image_adjustments(display[ry1:ry2, :], params)
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

                text1 = f"Width: {result['width_px']:.2f} px"
                if result["width_mm"] is not None:
                    text1 += f" ({result['width_mm']:.2f} mm)"

                text2 = f"Angle: {result['angle_deg']:.2f} deg"

                cv2.putText(display, text1, (int(round(20 * ui_scale)), display.shape[0] - int(round(50 * ui_scale))),
                            UI_FONT, 1.0 * ui_scale, (0, 255, 255), font_thickness(overlay_thickness), cv2.LINE_AA)
                cv2.putText(display, text2, (int(round(20 * ui_scale)), display.shape[0] - int(round(15 * ui_scale))),
                            UI_FONT, 0.8 * ui_scale, (0, 255, 255), font_thickness(overlay_thickness), cv2.LINE_AA)
            else:
                cv2.putText(display, f"Status: {result['msg']}", (int(round(20 * ui_scale)), display.shape[0] - int(round(20 * ui_scale))),
                            UI_FONT, 0.8 * ui_scale, (0, 0, 255), font_thickness(overlay_thickness), cv2.LINE_AA)

            mm_text = f"Scale: {MM_PER_PIXEL:.6f} mm/px" if USE_MM else "Scale: not calibrated"
            cv2.putText(display, mm_text, (int(round(20 * ui_scale)), int(round(95 * ui_scale))),
                        UI_FONT, 0.7 * ui_scale, (255, 255, 0), font_thickness(overlay_thickness), cv2.LINE_AA)
            cv2.putText(display, calibration_status, (int(round(20 * ui_scale)), int(round(130 * ui_scale))),
                        UI_FONT, 0.6 * ui_scale, (255, 255, 0), font_thickness(overlay_thickness), cv2.LINE_AA)
            if pending_calibration_width_mm is not None:
                pending_text = f"Pending calibration width: {pending_calibration_width_mm:.3f} mm"
                cv2.putText(display, pending_text, (int(round(20 * ui_scale)), int(round(165 * ui_scale))),
                            UI_FONT, 0.55 * ui_scale, (255, 255, 0), font_thickness(overlay_thickness), cv2.LINE_AA)

            alignment_status = get_center_alignment_status(display, result)
            draw_center_alignment_indicator(display, alignment_status)

            if alignment_status["aligned"] and result.get("width_mm") is not None:
                final_text = f"{result['width_mm']:.2f} mm"
                final_scale = 1.4 * ui_scale
                final_thickness = max(3, int(round(4 * ui_scale)))
                text_size, _ = cv2.getTextSize(
                    final_text,
                    UI_FONT,
                    final_scale,
                    font_thickness(final_thickness),
                )
                text_x = max(10, (display.shape[1] - text_size[0]) // 2)
                text_y = min(
                    display.shape[0] - 20,
                    ry2 + max(text_size[1] + 18, int(round(40 * ui_scale))),
                )
                cv2.putText(
                    display,
                    final_text,
                    (text_x, text_y),
                    UI_FONT,
                    final_scale,
                    (0, 255, 0),
                    font_thickness(final_thickness),
                    cv2.LINE_AA,
                )

            cal_button_ready = pending_calibration_width_mm is not None and result.get("ok")
            cal_button_text = "Save Calibration" if cal_button_ready else "Calibrate"
            draw_button(display, (BTN_X1, BTN_Y1, BTN_X2, BTN_Y2), "Params", params_window_open)
            draw_button(display, "cal", cal_button_text, cal_button_ready)
            cv2.putText(display, "Q=Quit  P=Toggle Params  C=Calibrate", (int(round(220 * ui_scale)), int(round(45 * ui_scale))),
                        UI_FONT, 0.8 * ui_scale, (255, 255, 255), font_thickness(overlay_thickness), cv2.LINE_AA)
            display_view = build_main_view(display, result)
            latest_display_shape = display.shape

            if use_gui:
                sync_params_window_state()

                target_w, target_h = get_main_view_size()
                if target_w and target_h:
                    view = fit_to_screen(display_view, target_w, target_h)
                else:
                    view = display_view

                cv2.setMouseCallback(WINDOW_MAIN, mouse_callback, view)
                cv2.imshow(WINDOW_MAIN, view)

                key = cv2.waitKey(1) & 0xFF
                if key == ord('q'):
                    break
                elif key == ord('c'):
                    if pending_calibration_width_mm is not None and result.get("ok"):
                        save_current_calibration(result)
                    else:
                        open_calibration_input_window()
                elif key == ord('p'):
                    if not params_window_open:
                        open_params_window()
                    else:
                        close_params_window()
            else:
                cv2.imwrite("frame_debug.jpg", display)
                print("Saved frame_debug.jpg")
                time.sleep(1)

    except KeyboardInterrupt:
        pass
    finally:
        picam2.stop()
        close_calibration_input_window()
        close_params_window()
        save_params_to_file()
        if params_root is not None:
            try:
                params_root.destroy()
            except tk.TclError:
                pass
        cv2.destroyAllWindows()


if __name__ == "__main__":
    run_standalone_edge_detector()
