#pragma once
#include "tusb.h"
#define ESP_OK 0
using esp_err_t = int;
inline const char* esp_err_to_name(int) {
  return "test";
}
enum tinyusb_event_id_t {
  TINYUSB_EVENT_ATTACHED,
  TINYUSB_EVENT_DETACHED,
  TINYUSB_EVENT_SUSPENDED,
  TINYUSB_EVENT_RESUMED
};
struct tinyusb_event_t {
  tinyusb_event_id_t id;
};
inline constexpr int TINYUSB_PORT_FULL_SPEED_0 = 0;
struct tinyusb_config_t {
  int port{0};
  struct {
    bool self_powered{false};
    int vbus_monitor_io{-1};
  } phy;
  struct {
    const tusb_desc_device_t* device{nullptr};
    const char** string{nullptr};
    int string_count{0};
    const uint8_t* full_speed_config{nullptr};
  } descriptor;
  void (*event_cb)(tinyusb_event_t*, void*){nullptr};
};
esp_err_t tinyusb_driver_install(const tinyusb_config_t* config);
