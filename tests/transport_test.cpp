#include "hid_keyboard.h"
#include "usb_descriptors.h"
#include "device/dcd.h"
#include "device/usbd_pvt.h"
#include "esphome/core/hal.h"
#include <cassert>
#include <cstring>
#include <iostream>
#include <vector>
using namespace esphome;
using namespace esphome::hid_keyboard;

static uint32_t clock_ms;
static bool mounted, suspended, endpoint_busy, block_endpoint, sof_enabled;
static tinyusb_config_t installed;
static unsigned installs;
static const usbd_class_driver_t* lifecycle;
static std::vector<Report> wire;
uint32_t esphome::millis() {
  return clock_ms;
}
esp_err_t tinyusb_driver_install(const tinyusb_config_t* config) {
  installed = *config;
  uint8_t count = 0;
  lifecycle = usbd_app_driver_get_cb(&count);
  assert(count == 1 && lifecycle);
  lifecycle->init();
  lifecycle->reset(0);
  tusb_desc_interface_t interface{};
  assert(lifecycle->open(0, &interface, sizeof(interface)) == 0);
  installs++;
  return ESP_OK;
}
extern "C" {
bool tud_mounted() {
  return mounted;
}
bool tud_suspended() {
  return suspended;
}
bool tud_hid_n_ready(uint8_t) {
  return mounted && !suspended && !endpoint_busy && !block_endpoint;
}
void tud_sof_cb_enable(bool enabled) {
  sof_enabled = enabled;
}
bool tud_hid_n_keyboard_report(uint8_t instance, uint8_t id, uint8_t modifiers, const uint8_t keys[6]) {
  assert(instance == 0 && id == 0 && tud_hid_n_ready(0));
  Report report;
  report.modifiers = modifiers;
  std::memcpy(report.keys.data(), keys, 6);
  wire.push_back(report);
  endpoint_busy = true;
  return true;
}
}
static void event(tinyusb_event_id_t id) {
  tinyusb_event_t event{id};
  installed.event_cb(&event, nullptr);
}
static void frame(HIDKeyboard &keyboard, bool complete = true) {
  if (complete && endpoint_busy) {
    endpoint_busy = false;
    tud_hid_report_complete_cb(0, nullptr, 8);
  }
  if (sof_enabled) tud_sof_cb(clock_ms);
  keyboard.loop();
  clock_ms++;
}
static void run(HIDKeyboard &keyboard, unsigned ticks = 300) {
  for (unsigned i = 0; i < ticks; i++) frame(keyboard);
}

int main() {
  HIDKeyboard keyboard;
  keyboard.configure(5, 5, 256, 4);
  keyboard.set_usb_ids(0x303a, 0x4003);
  keyboard.setup();
  assert(installs == 1 && !keyboard.failed);
  keyboard.type(StringRef("before host"));
  assert(!keyboard.last_request_accepted());
  mounted = true;
  event(TINYUSB_EVENT_ATTACHED);
  run(keyboard, 20);
  assert(!wire.empty() && wire.back() == Report{});

  // Check descriptors produced by the real TinyUSB macros.
  assert(sizeof(CONFIG_DESCRIPTOR) == 34);
  assert(CONFIG_DESCRIPTOR[9 + 5] == 3);   // HID class
  assert(CONFIG_DESCRIPTOR[9 + 6] == 1);   // boot subclass
  assert(CONFIG_DESCRIPTOR[9 + 7] == 1);   // keyboard protocol
  assert(CONFIG_DESCRIPTOR[27 + 4] == 8);  // endpoint packet length
  assert(CONFIG_DESCRIPTOR[7] == 0x80);
  assert(SELF_POWERED_CONFIG_DESCRIPTOR[7] == 0xc0);
  for (size_t pos = 0; pos < sizeof(REPORT_DESCRIPTOR);) {
    uint8_t prefix = REPORT_DESCRIPTOR[pos++];
    assert(prefix != 0x85);  // no report-ID item
    assert(prefix != 0xfe);  // no long items
    size_t length = prefix & 3;
    pos += length == 3 ? 4 : length;
    assert(pos <= sizeof(REPORT_DESCRIPTOR));
  }

  // Backpressure retains transitions and copies API input storage.
  auto start = wire.size();
  block_endpoint = true;
  std::string input = "aa!";
  keyboard.type(StringRef(input));
  input.assign("zzz");
  run(keyboard, 20);
  assert(wire.size() == start);
  block_endpoint = false;
  run(keyboard);
  std::vector<uint8_t> codes;
  for (size_t i = start; i < wire.size(); i++)
    if (wire[i].keys[0]) codes.push_back(wire[i].keys[0]);
  assert((codes == std::vector<uint8_t>{4, 4, 0x1e}));
  assert(!keyboard.is_busy());

  // Cancellation before the USB task accepts a queued press.
  start = wire.size();
  keyboard.type(StringRef("secret"));
  frame(keyboard);
  frame(keyboard);
  frame(keyboard);  // baseline then pending press
  keyboard.release_all();
  run(keyboard);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});

  // A new request accepted after cancellation survives retirement of the old
  // USB mailbox. Cancellation must not spill over into the next request.
  keyboard.type(StringRef("old"));
  frame(keyboard);
  keyboard.release_all();
  keyboard.type(StringRef("x"));
  assert(keyboard.last_request_accepted());
  start = wire.size();
  run(keyboard);
  unsigned new_presses = 0;
  for (size_t i = start; i < wire.size(); i++) {
    if (wire[i].keys[0]) {
      assert(wire[i].keys[0] == 0x1b);
      new_presses++;
    }
  }
  assert(new_presses == 1);

  // SET_PROTOCOL cancels active typing; wire format remains the same.
  for (uint8_t protocol : {0, 1}) {
    keyboard.type(StringRef("secret"));
    run(keyboard, 6);
    tud_hid_set_protocol_cb(0, protocol);
    start = wire.size();
    run(keyboard);
    for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});
  }

  // Fast reset+remount with no main-loop observation of unmounted state.
  keyboard.type(StringRef("secret"));
  run(keyboard, 6);
  tud_event_hook_cb(0, DCD_EVENT_BUS_RESET, true);
  // Event hook runs before the USB task clears tud_mounted(). No input may be
  // accepted in that interval, despite the old configured flag still being set.
  keyboard.type(StringRef("reset window"));
  assert(!keyboard.last_request_accepted());
  lifecycle->reset(0);
  endpoint_busy = false;  // controller flushes old transfer
  event(TINYUSB_EVENT_ATTACHED);
  start = wire.size();
  run(keyboard);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});

  // Suspend cancels; resume never replays the remaining text.
  keyboard.type(StringRef("secret"));
  run(keyboard, 6);
  suspended = true;
  tud_event_hook_cb(0, DCD_EVENT_SUSPEND, true);
  event(TINYUSB_EVENT_SUSPENDED);
  keyboard.loop();
  keyboard.type(StringRef("not queued"));
  assert(!keyboard.last_request_accepted());
  suspended = false;
  event(TINYUSB_EVENT_RESUMED);
  start = wire.size();
  run(keyboard);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});

  // Timeout while unsent must not emit a late key when endpoint recovers.
  block_endpoint = true;
  keyboard.tap(StringRef("a"), 0);
  run(keyboard, 2100);
  start = wire.size();
  block_endpoint = false;
  run(keyboard);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});

  // GET_REPORT, host LEDs, idle repeat, and immediate rejection of bad modifiers.
  keyboard.press(StringRef("a"), 256);
  assert(!keyboard.last_request_accepted());
  keyboard.press(StringRef("a"), -1);
  assert(!keyboard.last_request_accepted());
  keyboard.press(StringRef("a"), 2);
  run(keyboard);
  uint8_t buffer[8]{};
  assert(tud_hid_get_report_cb(0, 0, HID_REPORT_TYPE_INPUT, buffer, 8) == 8);
  assert(buffer[0] == 2 && buffer[1] == 0 && buffer[2] == 4);
  assert(tud_hid_get_report_cb(0, 1, HID_REPORT_TYPE_INPUT, buffer, 8) == 0);
  uint8_t leds = 2;
  tud_hid_set_report_cb(0, 0, HID_REPORT_TYPE_OUTPUT, &leds, 1);
  assert(keyboard.leds() == 2);
  assert(tud_hid_get_report_cb(0, 0, HID_REPORT_TYPE_OUTPUT, buffer, 8) == 1 && buffer[0] == 2);
  tud_hid_set_idle_cb(0, 1);
  start = wire.size();
  for (unsigned i = 0; i < 40; i++) {
    if (endpoint_busy) {
      endpoint_busy = false;
      tud_hid_report_complete_cb(0, nullptr, 8);
    }
    tud_sof_cb(clock_ms++);  // main loop may be busy; idle remains USB-task driven
  }
  assert(wire.size() >= start + 8);
  tud_hid_set_idle_cb(0, 5);
  start = wire.size();
  run(keyboard, 80);
  assert(wire.size() > start);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i].keys[0] == 4 && wire[i].modifiers == 2);
  tud_hid_set_idle_cb(0, 0);
  run(keyboard, 5);
  start = wire.size();
  run(keyboard, 80);
  assert(wire.size() == start);
  keyboard.release_all();
  run(keyboard);
  assert(wire.back() == Report{});

  // GET_REPORT immediately after reset must be neutral, even before loop().
  keyboard.press(StringRef("b"), 0);
  run(keyboard, 20);
  tud_event_hook_cb(0, DCD_EVENT_BUS_RESET, true);
  lifecycle->reset(0);
  std::memset(buffer, 0xff, 8);
  assert(tud_hid_get_report_cb(0, 0, HID_REPORT_TYPE_INPUT, buffer, 8) == 8);
  for (auto byte : buffer) assert(byte == 0);
  endpoint_busy = false;
  event(TINYUSB_EVENT_ATTACHED);
  run(keyboard);

  // USB transfer failure cancels the entire request and recovers neutral.
  keyboard.type(StringRef("secret"));
  for (unsigned i = 0; i < 20; i++) {
    frame(keyboard);
    if (endpoint_busy && wire.back().keys[0]) break;
  }
  assert(endpoint_busy && wire.back().keys[0]);
  endpoint_busy = false;
  tud_hid_report_failed_cb(0, HID_REPORT_TYPE_INPUT, nullptr, 0);
  start = wire.size();
  run(keyboard);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});

  // A mount event already queued before the reset must not revive the old
  // session after the reset task fence runs. GET_REPORT is neutral immediately.
  keyboard.press(StringRef("b"), 0);
  run(keyboard, 20);
  tud_event_hook_cb(0, DCD_EVENT_BUS_RESET, true);
  event(TINYUSB_EVENT_ATTACHED);  // older SET_CONFIGURATION ahead of reset
  keyboard.type(StringRef("must not replay"));
  lifecycle->reset(0);  // reset now processed by the TinyUSB task
  std::memset(buffer, 0xff, 8);
  assert(tud_hid_get_report_cb(0, 0, HID_REPORT_TYPE_INPUT, buffer, 8) == 8);
  for (auto byte : buffer) assert(byte == 0);
  endpoint_busy = false;
  event(TINYUSB_EVENT_ATTACHED);
  start = wire.size();
  run(keyboard);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});

  // Detach/reconnect: no old queued input is replayed.
  keyboard.type(StringRef("secret"));
  run(keyboard, 6);
  mounted = false;
  tud_event_hook_cb(0, DCD_EVENT_UNPLUGGED, true);
  event(TINYUSB_EVENT_DETACHED);
  keyboard.loop();
  endpoint_busy = false;
  mounted = true;
  event(TINYUSB_EVENT_ATTACHED);
  start = wire.size();
  run(keyboard);
  for (size_t i = start; i < wire.size(); i++) assert(wire[i] == Report{});
  std::cout << "transport and descriptor scenarios passed\n";
}
