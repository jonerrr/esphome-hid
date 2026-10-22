"""Exercise component validation through ESPHome's real configuration pipeline."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]


def validate(tmp_path, keyboard=None, actions=None, **extra):
    config = {
        "esphome": {
            "name": "hid-test",
            "on_boot": {"then": actions or [{"hid_keyboard.release_all": "keyboard"}]},
        },
        "esp32": {"board": "esp32-s3-devkitc-1", "framework": {"type": "esp-idf"}},
        "logger": {"hardware_uart": "UART0"},
        "external_components": [
            {
                "source": {"type": "local", "path": str(ROOT / "components")},
                "components": ["hid_keyboard"],
            }
        ],
        "hid_keyboard": {"id": "keyboard", **(keyboard or {})},
        **extra,
    }
    path = tmp_path / "test.yaml"
    path.write_text(yaml.safe_dump(config))
    return subprocess.run(
        [sys.executable, "-m", "esphome", "config", str(path)],
        capture_output=True,
        text=True,
        env=os.environ,
    )


def test_valid_actions(tmp_path):
    result = validate(
        tmp_path,
        actions=[
            {"hid_keyboard.press": {"key": "RIGHT_CTRL", "modifiers": ["CTRL", "ALT"]}},
            {"hid_keyboard.release": "keyboard"},
            {"hid_keyboard.tap": {"key": "DELETE", "modifiers": "CTRL_ALT"}},
            {"hid_keyboard.type": {"text": 'Hello! @#$%^&*()_+{}|:"<>?\n\t'}},
            {"hid_keyboard.release_all": "keyboard"},
        ],
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize(
    ("keyboard", "expected"),
    [
        ({"layout": "AZERTY_FR"}, "QWERTY_US"),
        ({"queue_size": 9}, "8"),
        ({"max_text_length": 1025}, "1024"),
        ({"keypress_duration": "0ms"}, "1ms"),
        ({"vbus_monitor_pin": 19}, "GPIO19/GPIO20"),
    ],
)
def test_invalid_settings(tmp_path, keyboard, expected):
    result = validate(tmp_path, keyboard)
    assert result.returncode != 0
    assert expected in result.stdout + result.stderr


@pytest.mark.parametrize(
    "action",
    [
        {"hid_keyboard.type": {"text": "abcé"}},
        {"hid_keyboard.type": {"text": "abc\r"}},
        {"hid_keyboard.type": {"text": "abc\0"}},
        {"hid_keyboard.tap": {"key": "UNKNOWN"}},
        {"hid_keyboard.tap": {"key": "ENTER", "modifiers": 256}},
    ],
)
def test_invalid_static_actions(tmp_path, action):
    assert validate(tmp_path, actions=[action]).returncode != 0


@pytest.mark.parametrize(
    "extra",
    [
        {"tinyusb": {}},
        {"logger": {"hardware_uart": "USB_CDC"}},
        {"logger": {"hardware_uart": "USB_SERIAL_JTAG"}},
        {"esp32": {"board": "esp32-s3-devkitc-1", "framework": {"type": "arduino"}}},
        {"esp32": {"board": "esp32dev", "framework": {"type": "esp-idf"}}},
    ],
)
def test_incompatible_platform_or_owner(tmp_path, extra):
    assert validate(tmp_path, **extra).returncode != 0
