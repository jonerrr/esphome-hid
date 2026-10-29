"""Dedicated ESP32-S3 USB boot keyboard. ESPHome 2026.10.0+."""

import esphome.codegen as cg
import esphome.config_validation as cv
import esphome.final_validate as fv
from esphome import automation, pins
from esphome.components import esp32
from esphome.const import CONF_ID

DEPENDENCIES = ["esp32"]
CONFLICTS_WITH = [
    "tinyusb",
    "tinyusb_keyboard",
    "usb_cdc_acm",
    "usb_host",
    "hid_mouse",
    "hid_composite",
    "hid_telephony",
]

ns = cg.esphome_ns.namespace("hid_keyboard")
HIDKeyboard = ns.class_("HIDKeyboard", cg.Component)

MODIFIERS = {
    "NONE": 0,
    "CTRL": 1,
    "SHIFT": 2,
    "ALT": 4,
    "GUI": 8,
    "WIN": 8,
    "CMD": 8,
    "LEFT_CTRL": 1,
    "LEFT_SHIFT": 2,
    "LEFT_ALT": 4,
    "LEFT_GUI": 8,
    "RIGHT_CTRL": 16,
    "RIGHT_SHIFT": 32,
    "RIGHT_ALT": 64,
    "RIGHT_GUI": 128,
}
SPECIAL_KEYS = {
    "ENTER",
    "RETURN",
    "ESC",
    "ESCAPE",
    "BACKSPACE",
    "TAB",
    "SPACE",
    "CAPS_LOCK",
    "PRINT_SCREEN",
    "SCROLL_LOCK",
    "PAUSE",
    "INSERT",
    "HOME",
    "PAGEUP",
    "DELETE",
    "END",
    "PAGEDOWN",
    "RIGHT",
    "LEFT",
    "DOWN",
    "UP",
    *(f"F{i}" for i in range(1, 13)),
    *(f"{side}_{key}" for side in ("LEFT", "RIGHT") for key in ("CTRL", "SHIFT", "ALT", "GUI")),
}


def text(value):
    value = cv.string_strict(value)
    if len(value) > 1024:
        raise cv.Invalid(
            "Text is limited to 1024 ASCII bytes (also checked against max_text_length at runtime)"
        )
    if any(not (32 <= ord(c) <= 126 or c in "\n\t") for c in value):
        raise cv.Invalid(
            "US QWERTY supports printable ASCII, newline and tab only; entire input rejected"
        )
    return value


def key(value):
    value = cv.string_strict(value)
    if len(value) == 1:
        return text(value)
    if value.upper() not in SPECIAL_KEYS:
        raise cv.Invalid("Unknown keyboard key")
    return value.upper()


def modifiers(value):
    if isinstance(value, list):
        result = 0
        for item in value:
            result |= MODIFIERS[cv.one_of(*MODIFIERS, upper=True)(item)]
        return result
    if isinstance(value, str):
        result = 0
        for item in value.upper().split("_") if value.upper() not in MODIFIERS else [value]:
            result |= MODIFIERS[cv.one_of(*MODIFIERS, upper=True)(item)]
        return result
    return cv.uint8_t(value)


CONFIG_SCHEMA = cv.All(
    cv.Schema(
        {
            cv.GenerateID(): cv.declare_id(HIDKeyboard),
            cv.Optional("layout", default="QWERTY_US"): cv.one_of("QWERTY_US", upper=True),
            cv.Optional("keypress_duration", default="30ms"): cv.All(
                cv.positive_time_period_milliseconds,
                cv.Range(min=cv.TimePeriod(milliseconds=1), max=cv.TimePeriod(seconds=5)),
            ),
            cv.Optional("inter_key_delay", default="30ms"): cv.All(
                cv.positive_time_period_milliseconds, cv.Range(max=cv.TimePeriod(seconds=5))
            ),
            cv.Optional("max_text_length", default=256): cv.int_range(min=1, max=1024),
            cv.Optional("queue_size", default=4): cv.int_range(min=1, max=8),
            cv.Optional("vbus_monitor_pin"): pins.internal_gpio_input_pin_number,
            cv.Optional("usb_vendor_id", default=0x303A): cv.uint16_t,
            cv.Optional("usb_product_id", default=0x4003): cv.uint16_t,
        }
    ).extend(cv.COMPONENT_SCHEMA),
    cv.require_esphome_version(2026, 10, 0),
    esp32.only_on_variant(supported=[esp32.VARIANT_ESP32S3]),
    cv.only_with_framework("esp-idf"),
)


def final_validate(config):
    full = fv.full_config.get()
    logger = full.get("logger", {})
    if logger.get("hardware_uart") in ("USB_CDC", "USB_SERIAL_JTAG"):
        raise cv.Invalid("Use logger.hardware_uart: UART0; native USB pins belong to hid_keyboard")
    pin = config.get("vbus_monitor_pin")
    if pin in (19, 20):
        raise cv.Invalid("VBUS sense must not use USB D-/D+ (GPIO19/GPIO20)")


FINAL_VALIDATE_SCHEMA = final_validate


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(
        var.configure(
            config["keypress_duration"].total_milliseconds,
            config["inter_key_delay"].total_milliseconds,
            config["max_text_length"],
            config["queue_size"],
        )
    )
    cg.add(var.set_usb_ids(config["usb_vendor_id"], config["usb_product_id"]))
    if "vbus_monitor_pin" in config:
        cg.add(var.set_vbus_monitor_pin(config["vbus_monitor_pin"]))
    esp32.add_idf_component(name="espressif/esp_tinyusb", ref="3.0.0")
    # Pin TinyUSB too: esp_tinyusb's open minimum otherwise changes the USB core
    # independently of the tested ESPHome release.
    esp32.add_idf_component(name="espressif/tinyusb", ref="0.21.0~2")
    for name, value in {
        "CONFIG_TINYUSB_HID_COUNT": 1,
        "CONFIG_TINYUSB_SUSPEND_CALLBACK": True,
        "CONFIG_TINYUSB_RESUME_CALLBACK": True,
    }.items():
        esp32.add_idf_sdkconfig_option(name, value)


ID_SCHEMA = {cv.GenerateID(): cv.use_id(HIDKeyboard)}
for action in ("press", "tap"):
    automation.register_apply_action(
        f"hid_keyboard.{action}",
        cv.Schema(
            {
                **ID_SCHEMA,
                cv.Required("key"): cv.templatable(key),
                cv.Optional("modifiers", default=0): cv.templatable(modifiers),
            }
        ),
        automation.ApplyCall(
            f"{action}(StringRef({{}}), {{}})", (("key", cg.std_string), ("modifiers", cg.int_))
        ),
    )
for action in ("release", "release_all"):
    automation.register_apply_action(
        f"hid_keyboard.{action}",
        automation.maybe_simple_id(ID_SCHEMA),
        automation.ApplyCall("release_all()"),
    )
automation.register_apply_action(
    "hid_keyboard.type",
    cv.Schema({**ID_SCHEMA, cv.Required("text"): cv.templatable(text)}),
    automation.ApplyCall("type(StringRef({}))", (("text", cg.std_string),)),
)
for condition, method in (
    ("is_connected", "is_connected"),
    ("is_busy", "is_busy"),
    ("last_request_accepted", "last_request_accepted"),
):
    automation.register_apply_condition(
        f"hid_keyboard.{condition}", cv.Schema(ID_SCHEMA), f"{method}()"
    )
