#pragma once

#include "keyboard_engine.h"
#include "esphome/core/component.h"
#include "esphome/core/helpers.h"
#include "tinyusb.h"
#include <atomic>

namespace esphome::hid_keyboard {

class HIDKeyboard : public Component {
 public:
  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::BUS; }
  void configure(uint32_t press_ms, uint32_t gap_ms, size_t max_length, size_t queue_size) {
    engine_.configure(press_ms, gap_ms, max_length, queue_size);
  }
  void set_usb_ids(uint16_t vendor, uint16_t product) {
    device_descriptor_.idVendor = vendor;
    device_descriptor_.idProduct = product;
  }
  void set_vbus_monitor_pin(int pin) { vbus_pin_ = pin; }
  // StringRef is borrowed only for this call; engine copies text synchronously.
  void press(StringRef key, int modifiers) { submit_key_(Operation::PRESS, key, modifiers); }
  void tap(StringRef key, int modifiers) { submit_key_(Operation::TAP, key, modifiers); }
  void type(StringRef text) {
    sync_lifecycle_();
    accept_(engine_.submit_text({text.c_str(), text.size()}));
  }
  void release_all() {
    protocol_changed();
    sync_lifecycle_();
    engine_.cancel();
  }
  bool is_connected() const;
  bool is_busy() const { return engine_.busy(); }
  bool last_request_accepted() const { return engine_.last_result() == Result::ACCEPTED; }
  Result last_result() const { return engine_.last_result(); }
  const char* last_result_message() const;
  static uint8_t leds() { return leds_.load(); }

  // USB task/ISR entry points. No queue or automation access from callbacks.
  static void bus_event(uint32_t event);
  static void protocol_changed();
  static void transfer_complete();
  static void transfer_failed();
  static void set_idle(uint8_t rate);
  static void set_leds(uint8_t leds);
  static void usb_frame();
  static Report snapshot();

 protected:
  void sync_lifecycle_();
  void submit_key_(Operation operation, StringRef key, int modifiers) {
    sync_lifecycle_();
    if (modifiers < 0 || modifiers > 255) {
      engine_.reject_input();
      accept_(Result::INVALID_INPUT);
      return;
    }
    accept_(engine_.submit_key(operation, {key.c_str(), key.size()}, modifiers));
  }
  void accept_(Result result);
  bool send_(const Report &report);
  KeyboardEngine engine_;
  bool initialized_{false}, inflight_{false}, engine_transfer_{false};
  uint32_t observed_generation_{0}, sent_at_{0};
  int vbus_pin_{-1};
  char serial_[MAC_ADDRESS_BUFFER_SIZE]{};
  char language_[2]{0x09, 0x04};
  const char* strings_[4]{language_, "ESPHome", "ESPHome Boot Keyboard", serial_};
  tusb_desc_device_t device_descriptor_{};
  // A single atomic mailbox keeps all TinyUSB report operations on its own
  // servicing task. The main loop publishes only when the slot is FREE.
  enum Mailbox : uint32_t { FREE, REQUESTED, IN_FLIGHT, COMPLETE, RETRY, FAILED };
  static std::atomic<uint32_t> generation_, mailbox_, request_generation_, request_report_, snapshot_,
      snapshot_generation_;
  static std::atomic<uint8_t> idle_rate_, leds_;
  static std::atomic<bool> usb_available_;
  static uint32_t usb_last_report_at_;  // USB task only
};

}  // namespace esphome::hid_keyboard
