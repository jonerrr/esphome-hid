#pragma once
#include "tusb.h"
#include "class/hid/hid_device.h"

namespace esphome::hid_keyboard {
inline constexpr uint8_t REPORT_DESCRIPTOR[] = {TUD_HID_REPORT_DESC_KEYBOARD()};
inline constexpr uint8_t CONFIG_DESCRIPTOR[] = {
    // No remote wakeup advertised: suspend cancels rather than retaining input.
    TUD_CONFIG_DESCRIPTOR(1, 1, 0, TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN, 0, 100),
    TUD_HID_DESCRIPTOR(0, 0, HID_ITF_PROTOCOL_KEYBOARD, sizeof(REPORT_DESCRIPTOR), 0x81, 8, 1),
};
inline constexpr uint8_t SELF_POWERED_CONFIG_DESCRIPTOR[] = {
    TUD_CONFIG_DESCRIPTOR(1, 1, 0, TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN, TUSB_DESC_CONFIG_ATT_SELF_POWERED, 2),
    TUD_HID_DESCRIPTOR(0, 0, HID_ITF_PROTOCOL_KEYBOARD, sizeof(REPORT_DESCRIPTOR), 0x81, 8, 1),
};
}  // namespace esphome::hid_keyboard
