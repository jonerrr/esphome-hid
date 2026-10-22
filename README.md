# ESPHome USB Boot Keyboard

A maintained keyboard-focused successor to [AntorFr/esphome-hid](https://github.com/AntorFr/esphome-hid), for an ESP32-S3 controlled through ESPHome's encrypted native API. Designed for UEFI and Linux initramfs input, including a LUKS passphrase prompt.

The USB interface declares HID boot subclass / keyboard protocol and sends the same eight-byte keyboard report in boot and report mode, without report IDs. TinyUSB handles protocol selection. Media controls, mouse, telephony, typing jitter, and keep-awake are outside this fork's initial scope.

**Software validation is complete; physical UEFI/LUKS acceptance is still pending.** A successful build does not establish compatibility with a particular motherboard firmware. See [the hardware test procedure](docs/hardware-validation.md).

## Supported stack

| Item                | Tested configuration                                |
| ------------------- | --------------------------------------------------- |
| ESPHome             | 2026.10.0                                           |
| Framework           | ESP-IDF 5.5.6, the release default                  |
| USB driver          | `espressif/esp_tinyusb` 2.2.1                       |
| USB core            | `espressif/tinyusb` 0.21.0~2                        |
| Board configuration | ESP32-S3-DevKitC-1, 8 MB flash, quad PSRAM for N8R2 |
| Text layout         | US QWERTY                                           |

The minimum ESPHome version is enforced. Later releases need CI and hardware verification before claiming support. USB dependencies are explicitly pinned because the Espressif driver's own dependency range would otherwise change the USB core independently. No older ESPHome compatibility layer is included.

## Build and connect

From this checkout:

```bash
mise exec -- uv sync --dev --locked
mise exec -- cp examples/secrets.example.yaml examples/secrets.yaml
mise exec -- openssl rand -base64 32
# Edit examples/secrets.yaml: Wi-Fi credentials and your newly generated API key.
mise exec -- uv run esphome compile examples/keyboard.yaml
mise exec -- uv run esphome run examples/keyboard.yaml --device /dev/ttyUSB0
```

Select the actual serial device on your machine. Flash and read logs through the board's **UART bridge port**. Connect the board's **native USB port** to the target PC; on the S3 it uses GPIO19 D− and GPIO20 D+. Neither USB CDC logging nor USB Serial/JTAG logging can share these pins with this component. Network logging is also available.

The example selects 8 MB flash and quad PSRAM at 80 MHz. It requires PSRAM to be detected rather than silently falling back. The keyboard itself does not need PSRAM.

The checked-in example uses a local external-component source. For another project, use an absolute local checkout path or your published fork URL with a pinned revision:

```yaml
external_components:
  - source:
      type: local
      path: /path/to/esphome-hid/components
    components: [hid_keyboard]

hid_keyboard:
  id: keyboard
  layout: QWERTY_US
  keypress_duration: 30ms
  inter_key_delay: 30ms
  max_text_length: 256
  queue_size: 4
```

Do not add `tinyusb:`, manual driver initialization, IDF component dependencies, `CFG_TUD_*` compiler definitions, or USB console SDK overrides. The component configures its dependencies and owns the driver exactly once. Conflicting USB components are rejected.

For an ESP32 powered separately from the PC, configure `vbus_monitor_pin` and connect a correctly conditioned host VBUS sense signal to a free input GPIO. Never connect USB 5 V directly to a GPIO. This selects self-powered PHY operation and a corresponding USB configuration descriptor. Without the pin, the descriptor declares bus power; cable loss may appear as suspend. Both events cancel typing, but accurate detach detection for a separately powered KVM needs VBUS sensing. Check the board schematic and power paths before powering both ports; do not backfeed the PC.

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

## Scheduling and failures

The queue defaults to four requests and can contain at most eight, including active work. Text defaults to 256 bytes per request and is limited to 1024. Accepted text is owned by the component; ESPHome API `StringRef` arguments and lambda temporaries are never retained. Request strings are overwritten when completed or cancelled. This is not a guarantee that all other API or host memory copies are erased.

Actions return after submission. Accepted requests run FIFO; concurrent callers share this queue. Queue overflow rejects the new request without changing existing work. Timing is component-wide: press duration 1 ms–5 s and inter-key delay 0–5 s. Both are minimum durations; ESPHome loop scheduling can make them longer. The default is 30 ms for each. USB sends run on TinyUSB's servicing task, use endpoint readiness, and wait for transfer completion before advancing the scheduler. The main loop never sleeps while typing. HID idle repeats run from SOF callbacks and honor four-millisecond units independently of the main loop.

`release_all` has priority over queued work. It cancels unsent input and schedules a neutral report after any already submitted endpoint transfer. A press already accepted by the USB controller cannot be recalled. Releases remain pending under endpoint backpressure. Transfer failure or two seconds without progress cancels the request; recovery sends a neutral report. A host that is not polling cannot receive a release until it resumes.

Reset, detach, suspend, and protocol switching cancel active and queued requests. The next usable session starts neutral. No partial passphrase is resumed or automatically retried. Starting the ESP32 before the PC is supported: input is rejected until the host configures the device and is awake. Remote wakeup is not advertised.

Conditions: `hid_keyboard.is_connected`, `hid_keyboard.is_busy`, and `hid_keyboard.last_request_accepted`. Equivalent C++ methods are available, along with `last_result()`, `last_result_message()`, and `leds()`. Busy describes queued/transferring work and pending neutral synchronization; a deliberately held key is not busy. Busy may remain true while disconnected because a neutral report is pending. Queue acceptance does not prove host application delivery.

## Home Assistant

[examples/keyboard.yaml](examples/keyboard.yaml) exposes `keyboard_type`, `keyboard_tap`, `keyboard_press`, and `keyboard_release_all` API actions and connection/busy/last-acceptance sensors. ESPHome advertises the device-specific action names to Home Assistant; use the names shown under Developer Tools → Actions. Type takes `input_text`; key actions take `key` and an integer `modifiers` mask. Type/press/tap immediately return an API error status if submission fails, including unsupported input, unavailable USB, and queue overflow. A successful response means queued, not fully typed.

For a passphrase, wait for USB Connected and the intended prompt, submit text once, observe Busy clearing, then submit Enter. Do not automatically retry after interruption: a prefix may remain in the host's input field. Clear the field or restart the prompt before sending a complete passphrase again. `release_all` releases keys but does not erase text already entered on the PC.

The component logs rejection reasons without logging input text or individual keys. Keep passphrases out of saved example YAML, automation traces, and verbose API logs. Use a private API encryption key; the example secrets contain a public compile-test value which must be replaced.

## Maintenance and validation

```bash
mise exec -- uv run ruff check components tests
mise exec -- uv run ruff format --check components tests
mise exec -- uv run clang-format --dry-run --Werror components/hid_keyboard/*.h components/hid_keyboard/*.cpp tests/*.cpp tests/stubs/*.h tests/stubs/esphome/core/*.h
mise exec -- uv run esphome compile examples/keyboard.yaml
mise exec -- uv run pytest -q
```

Tests compile and execute the actual C++ scheduler and USB callback implementation using a fake host and the pinned TinyUSB headers. They cover whole-input rejection, owned text, bounded FIFO requests, repeated characters, minimum timing, backpressure, cancellation, clock rollover, Caps Lock, protocol changes, reset/remount, suspend/resume, disconnect, transfer failure, idle reports, and boot descriptors. Transport tests require the example's downloaded managed component; without it they report a skip. CI compiles firmware before running all tests.

The architecture and versioned primary sources are in [docs/architecture.md](docs/architecture.md) and [docs/usb-research.md](docs/usb-research.md). A reset observer registered through TinyUSB's class-driver extension hook claims no interfaces and leaves the built-in HID driver in place. It fences actual reset processing as well as interrupt notification, including an older mount event ahead of reset in the task queue. This extension table is declared in `device/usbd_pvt.h`; its shape is one reason the TinyUSB version is pinned. Dependency upgrades must recheck that table, callbacks, descriptor macros, ISR atomics, and lifecycle behavior, followed by the hardware matrix. The standalone scheduler is independent of ESPHome and TinyUSB, so a future native USB manager API can replace the transport without replacing keyboard behavior.
