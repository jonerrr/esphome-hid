"""Compile and execute the real C++ state machine on the development host."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_engine(tmp_path):
    env = {
        **os.environ,
        "ZIG_GLOBAL_CACHE_DIR": "/tmp/esphome-hid-zig-cache",
        "ZIG_LOCAL_CACHE_DIR": str(tmp_path / "zig"),
    }
    binary = tmp_path / "engine-test"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "ziglang",
            "c++",
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-I",
            str(ROOT / "components/hid_keyboard"),
            str(ROOT / "tests/engine_test.cpp"),
            str(ROOT / "components/hid_keyboard/keyboard_engine.cpp"),
            "-o",
            str(binary),
        ],
        check=True,
        env=env,
    )
    subprocess.run([str(binary)], check=True)


def test_transport(tmp_path):
    # TinyUSB headers from the exact pinned firmware dependency. Build
    # the example first, or point TINYUSB_SOURCE at an unpacked registry package.
    tinyusb = Path(
        os.environ.get(
            "TINYUSB_SOURCE",
            ROOT / "examples/.esphome/build/pc-remote/managed_components/espressif__tinyusb/src",
        )
    )
    if not tinyusb.exists():
        pytest.skip("Build examples/keyboard.yaml first to obtain pinned TinyUSB headers")
    env = {
        **os.environ,
        "ZIG_GLOBAL_CACHE_DIR": "/tmp/esphome-hid-zig-cache",
        "ZIG_LOCAL_CACHE_DIR": str(tmp_path / "zig"),
    }
    binary = tmp_path / "transport-test"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "ziglang",
            "c++",
            "-std=c++17",
            "-Wall",
            "-Wextra",
            "-I",
            str(ROOT / "tests/stubs"),
            "-DUSE_TEXT_SENSOR",
            "-I",
            str(tinyusb),
            "-I",
            str(ROOT / "components/hid_keyboard"),
            str(ROOT / "tests/transport_test.cpp"),
            str(ROOT / "components/hid_keyboard/hid_keyboard.cpp"),
            str(ROOT / "components/hid_keyboard/keyboard_engine.cpp"),
            "-o",
            str(binary),
        ],
        check=True,
        env=env,
    )
    subprocess.run([str(binary)], check=True)
