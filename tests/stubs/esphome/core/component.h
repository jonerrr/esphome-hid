#pragma once
namespace esphome {
namespace setup_priority {
inline constexpr float BUS = 1000;
}
class Component {
 public:
  virtual ~Component() = default;
  virtual void setup() {}
  virtual void loop() {}
  virtual void dump_config() {}
  virtual float get_setup_priority() const { return 0; }
  void mark_failed() { failed = true; }
  bool failed{false};
};
}  // namespace esphome
