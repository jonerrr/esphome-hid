# ESPHome USB Boot Keyboard

A maintained keyboard-focused successor to [AntorFr/esphome-hid](https://github.com/AntorFr/esphome-hid), for an ESP32-S3 controlled through ESPHome's encrypted native API. Designed for UEFI and Linux initramfs input, including a LUKS passphrase prompt.

Supports text entry, special keys, and modifier combinations using a USB HID
boot keyboard interface.

## Requirements

- ESP32-S3 board with its native USB device port connected to the target computer.
- ESPHome 2026.10.0 or newer, using the ESP-IDF framework. Tested with 2026.10.0.
- US QWERTY keyboard layout on the target computer.
- Home Assistant with the ESPHome integration for dashboard control; HACS for
  installing the optional dashboard card.

## Build and connect

From this checkout:

```bash
uv sync --dev --locked
cp examples/secrets.example.yaml examples/secrets.yaml
openssl rand -base64 32
# Edit examples/secrets.yaml: Wi-Fi credentials and your newly generated API key.
uv run esphome compile examples/keyboard.yaml
uv run esphome run examples/keyboard.yaml --device /dev/ttyUSB0
```

Select the serial device on your machine. Flash and read logs through the board's
**UART bridge port**, then connect its **native USB port** to the target PC.
Set the board and flash size in the example to match the installed module.

The checked-in example uses a local external-component source for development.
To use the component in an existing ESPHome configuration, add the GitHub source:

```yaml
external_components:
  - source:
      type: git
      url: https://github.com/jonerrr/esphome-hid
      ref: main
    components: [hid_keyboard]

hid_keyboard:
  id: keyboard
  layout: QWERTY_US
  keypress_duration: 30ms
  inter_key_delay: 30ms
  max_text_length: 256
  queue_size: 4
```

For reproducible builds, replace `main` with a reviewed commit SHA. To use the
Home Assistant dashboard card, also copy the API actions and keyboard discovery text sensor
from [examples/keyboard.yaml](examples/keyboard.yaml).

For an ESP32 powered separately from the PC, `vbus_monitor_pin` can detect host
USB disconnection through a correctly conditioned VBUS sense signal. USB 5 V
must not be connected directly to a GPIO.

## Keyboard actions

| Action                     | Arguments                   | Behavior                                                 |
| -------------------------- | --------------------------- | -------------------------------------------------------- |
| `hid_keyboard.press`       | `key`, optional `modifiers` | Queues one ordinary key plus modifiers; leaves them held |
| `hid_keyboard.tap`         | `key`, optional `modifiers` | Queues press, hold, release, and inter-key delay         |
| `hid_keyboard.type`        | `text`                      | Validates and copies the entire text, then types it      |
| `hid_keyboard.release`     | optional `id`               | Cancels pending/active work and releases every key       |
| `hid_keyboard.release_all` | optional `id`               | Same cancellation/release behavior                       |

Every action can specify `id: keyboard`; it can be inferred when there is one keyboard. `key`, `modifiers`, and `text` accept lambdas. Static invalid input fails configuration validation; dynamic invalid input rejects the whole request before emitting any part of it.

```yaml
then:
  - hid_keyboard.tap:
      id: keyboard
      key: DELETE
      modifiers: [CTRL, ALT]
  - hid_keyboard.type:
      id: keyboard
      text: "Hello, World!"
  - hid_keyboard.tap:
      id: keyboard
      key: ENTER
```

`key` accepts a US character, `ENTER`/`RETURN`, `ESC`/`ESCAPE`, `BACKSPACE`, `DELETE`, `TAB`, `SPACE`, arrows, `HOME`, `END`, `INSERT`, `PAGEUP`, `PAGEDOWN`, `F1`–`F12`, `CAPS_LOCK`, `PRINT_SCREEN`, `SCROLL_LOCK`, `PAUSE`, and modifier-only keys such as `LEFT_CTRL` or `RIGHT_ALT`. Special names are case insensitive; character case is preserved.

`modifiers` accepts a list, a combination such as `CTRL_ALT`, or an integer mask 0–255. Bits 0–7 are left Ctrl/Shift/Alt/GUI followed by right Ctrl/Shift/Alt/GUI. `CTRL`, `SHIFT`, `ALT`, and `GUI` name left modifiers; `WIN` and `CMD` alias GUI. Lists support explicit side selection, e.g. `[RIGHT_CTRL, LEFT_SHIFT]`. Dynamic out-of-range modifiers are rejected before conversion.

Text accepts printable ASCII plus LF (`\n`, Enter) and tab (`\t`). Unicode, NUL, carriage return, and other control bytes are rejected. An explicit Enter tap avoids accidental submission of a passphrase. Shift and punctuation follow US QWERTY; text letter case compensates for the host-reported Caps Lock LED. The host's UEFI/initramfs/desktop keymap must match, and a host that does not report its lock state must start with Caps Lock off. Single-character `press`/`tap` use the physical US mapping without Caps Lock compensation.

Each press operation replaces the previous held key/modifier combination. Each new request first sends a neutral report, preventing a held modifier from contaminating text. The wire format has six key slots, but the action API intentionally supports one ordinary key at a time plus any modifier combination; it does not accumulate arbitrary multi-key chords.

## Typing and cancellation

Typing runs without blocking Wi-Fi or Home Assistant. Requests are queued in
order, with a default limit of four requests and 256 bytes per text request.
A full queue rejects new requests. `keypress_duration` and `inter_key_delay`
both default to 30 ms.

`release_all` cancels pending typing and releases held keys. Characters already
entered on the PC remain there. USB resets, disconnects, and suspend cancel
pending input; typing never resumes automatically after reconnection.

The `hid_keyboard.is_connected`, `hid_keyboard.is_busy`, and
`hid_keyboard.last_request_accepted` conditions are available for automations.
An accepted request has been queued; it does not confirm delivery to an application.

## Home Assistant

For the masked input card with Show/Hide, install this repository through
**HACS → Custom repositories**, using `https://github.com/jonerrr/esphome-hid`
and type **Dashboard**. Download **PC Keyboard (ESPHome HID)**, refresh your
browser, then add **PC keyboard** to your dashboard and choose the keyboard from
the visual editor's **Keyboard** dropdown. No particular device name is required.
HACS installs the dashboard card; configure and flash the ESPHome device
separately. See [installation details](home-assistant/README.md#installation).

[examples/keyboard.yaml](examples/keyboard.yaml) exposes `type_text`,
`keyboard_tap`, `clear_input`, and `release_all_keys`, plus `keyboard_press` and
status sensors. The discovery entity identifies the node, advertises its text
limit, and publishes live Connected/Busy state. The card resolves the four
action names from the advertised node name, independently of HA display names.
Type takes `input_text`; key actions take `key` and an integer `modifiers` mask.
Type/press/tap immediately return an API error status if submission fails. A
successful response means queued, not fully typed.

Add discovery to an existing keyboard configuration:

```yaml
text_sensor:
  - platform: hid_keyboard
    name: USB Keyboard
    hid_keyboard_id: keyboard
```

Use the configured `hid_keyboard` ID. Keep this diagnostic entity enabled in
Home Assistant. It contains public identity/status data, never typed text.
Separate Connected/Busy binary sensors are optional for other automations;
discovery does not require them. The example's API action names form the
dashboard contract; custom action names can be mapped under **Advanced overrides**.

For a passphrase, wait for USB Connected and the intended prompt, submit text once, observe Busy clearing, then submit Enter. Do not automatically retry after interruption: a prefix may remain in the host's input field. Clear the field or restart the prompt before sending a complete passphrase again. `release_all` releases keys but does not erase text already entered on the PC.

The component logs rejection reasons without logging input text or individual keys. Keep passphrases out of saved example YAML, automation traces, and verbose API logs. Use a private API encryption key; the example secrets contain a public compile-test value which must be replaced.

## Development

```bash
uv run ruff check components tests
uv run ruff format --check components tests
uv run clang-format --dry-run --Werror components/hid_keyboard/*.h components/hid_keyboard/*.cpp tests/*.cpp tests/stubs/*.h tests/stubs/esphome/core/*.h
uv run esphome compile examples/keyboard.yaml
uv run pytest -q
node --check dist/esphome-hid.js
node --check home-assistant/tests/card-tests.js
```

Tests cover keyboard scheduling, input validation, USB lifecycle handling,
descriptors, and dashboard discovery. Build the example before running the tests
to make its TinyUSB headers available. To run the browser checks,
serve the repository with `uv run -m http.server 8765 --bind 127.0.0.1` and open
`http://127.0.0.1:8765/home-assistant/tests/`. The preview uses simulated actions
and sends no keystrokes to a PC.
