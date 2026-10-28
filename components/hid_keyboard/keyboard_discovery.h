#pragma once

#ifdef USE_TEXT_SENSOR

#include "esphome/components/text_sensor/text_sensor.h"
#include "esphome/core/application.h"
#include "hid_keyboard.h"

namespace esphome::hid_keyboard {

class KeyboardDiscovery : public text_sensor::TextSensor, public Component {
 public:
  void set_keyboard(HIDKeyboard* keyboard) { this->keyboard_ = keyboard; }
  void set_metadata(const std::string &metadata) { this->metadata_ = metadata; }
  void loop() override {
    const bool connected = this->keyboard_->is_connected();
    const bool busy = this->keyboard_->is_busy();
    if (this->published_ && connected == this->connected_ && busy == this->busy_) return;
    this->connected_ = connected;
    this->busy_ = busy;
    this->published_ = true;
    // ESPHome resolves name_add_mac_suffix at runtime, before component setup.
    this->publish_state(this->metadata_ + ",\"node\":\"" + App.get_name().c_str() + "\",\"connected\":" +
                        (connected ? "true" : "false") + ",\"busy\":" + (busy ? "true" : "false") + "}");
  }

 protected:
  HIDKeyboard* keyboard_{};
  std::string metadata_;
  bool published_{false}, connected_{false}, busy_{false};
};

}  // namespace esphome::hid_keyboard

#endif
