"""Hardware side: talk to the Arduino and grab camera frames.

LedBoard    - sends one-char commands, waits for "ok <cmd>"
ManualBoard - same interface, but asks a human to move a flashlight (testing without Arduino)
Camera    - OpenCV camera with warm-up, averaging, best-effort exposure lock
"""
from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import serial
import serial.tools.list_ports


def find_arduino_port() -> str | None:
    for p in serial.tools.list_ports.comports():
        text = f"{p.description} {p.manufacturer or ''}".lower()
        if any(k in text for k in ("arduino", "ch340", "usb serial", "sparkfun", "wchusb", "usbmodem")):
            return p.device
        if "usbmodem" in p.device or "usbserial" in p.device:
            return p.device
    return None


class LedBoard:
    def __init__(self, port: str | None = None, baud: int = 115200, timeout: float = 2.0):
        port = port or find_arduino_port()
        if port is None:
            raise RuntimeError("Arduino not found. Pass --port (e.g. /dev/cu.usbmodem1101 or COM3).")
        try:
            self.ser = serial.Serial(port, baud, timeout=timeout)
        except serial.SerialException as e:
            raise RuntimeError(f"can't open {port} ({e}). Close the Arduino IDE Serial Monitor "
                               "or anything else using the port.") from None
        time.sleep(2.0)  # opening the port resets the board
        self.ser.reset_input_buffer()
        try:
            self.send("?")
        except TimeoutError:
            self.ser.close()
            raise RuntimeError(f"no reply on {port}. Is arduino/terminator_leds/terminator_leds.ino "
                               "uploaded? (test_leds doesn't answer commands)") from None

    def send(self, cmd: str) -> None:
        self.ser.write(cmd.encode())
        deadline = time.time() + 2.0
        while time.time() < deadline:
            line = self.ser.readline().decode(errors="ignore").strip()
            if line == f"ok {cmd}":
                return
            if line.startswith("err"):
                raise RuntimeError(f"Arduino rejected {cmd!r}: {line}")
        raise TimeoutError(f"no ack for {cmd!r}")

    def light(self, k: int) -> None:
        self.send(str(k))

    def off(self) -> None:
        self.send("x")

    def all_on(self) -> None:
        self.send("a")

    def close(self) -> None:
        try:
            self.off()
        finally:
            self.ser.close()


class ManualBoard:
    """Stand-in for LedBoard: you are the LEDs. Hold a flashlight flat on the table at the
    named edge of the paper, aimed at the center, and press Enter."""

    NAMES = ["NORTH (top edge in the camera image)", "EAST (right edge)", "SOUTH (bottom edge)", "WEST (left edge)"]

    def light(self, k: int) -> None:
        input(f"Light from {self.NAMES[k]}, keep still, press Enter... ")

    def off(self) -> None:
        input("All lights off (dark frame), press Enter... ")

    def all_on(self) -> None:
        print("Manual mode: light the paper any way you like while aiming.")

    def close(self) -> None:
        pass


def list_cameras(folder: Path, max_index: int = 5) -> None:
    """Save one snapshot per working camera index so you can tell which one is the phone."""
    folder.mkdir(parents=True, exist_ok=True)
    for i in range(max_index):
        cap = cv2.VideoCapture(i)
        ok = False
        if cap.isOpened():
            for _ in range(10):  # first frames are often black
                ok, frame = cap.read()
        if ok:
            path = folder / f"camera_{i}.jpg"
            cv2.imwrite(str(path), frame)
            print(f"camera {i}: {frame.shape[1]}x{frame.shape[0]} -> {path}")
        else:
            print(f"camera {i}: not available")
        cap.release()


ROTATIONS = {"cw": cv2.ROTATE_90_CLOCKWISE, "ccw": cv2.ROTATE_90_COUNTERCLOCKWISE, "180": cv2.ROTATE_180}


class Camera:
    def __init__(self, index: int = 0, width: int = 1920, height: int = 1080, exposure: float | None = None,
                 rotate: str | None = None):
        self.rotate = ROTATIONS[rotate] if rotate else None
        self.cap = cv2.VideoCapture(index)
        if not self.cap.isOpened():
            raise RuntimeError(f"camera {index} not available")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        if exposure is not None:
            # Best effort: works on most Linux/Windows webcams, often ignored on macOS.
            # reveal.py's flat-field step cancels global exposure changes anyway.
            self.cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
            self.cap.set(cv2.CAP_PROP_EXPOSURE, exposure)
        for _ in range(15):
            self.cap.read()

    def read(self) -> np.ndarray:
        ok, frame = self.cap.read()
        if not ok:
            raise RuntimeError("camera read failed")
        return cv2.rotate(frame, self.rotate) if self.rotate is not None else frame

    def grab(self, n_avg: int = 5, settle: float = 0.25) -> np.ndarray:
        """Let the scene settle (auto-exposure, focus), then average n_avg fresh frames.

        Frames are read, not slept through, while settling, so nothing stale is left buffered.
        """
        deadline = time.time() + settle
        while time.time() < deadline:
            self.cap.grab()
        acc = None
        for _ in range(n_avg):
            f = self.read().astype(np.float32)
            acc = f if acc is None else acc + f
        return (acc / n_avg).clip(0, 255).astype(np.uint8)

    def preview(self) -> np.ndarray:
        return self.read()

    def close(self) -> None:
        self.cap.release()
