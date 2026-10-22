#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace esphome::hid_keyboard {

struct Report {
  uint8_t modifiers{0};
  uint8_t reserved{0};
  std::array<uint8_t, 6> keys{};
  bool operator==(const Report &other) const { return modifiers == other.modifiers && keys == other.keys; }
};
static_assert(sizeof(Report) == 8);

struct Key {
  uint8_t code{0};
  uint8_t modifiers{0};
};

// Physical US QWERTY mapping. Deliberately rejects every unspecified byte.
bool ascii_key(uint8_t character, Key &key);
bool named_key(std::string_view name, Key &key);

enum class Result : uint8_t { ACCEPTED, UNAVAILABLE, INVALID_INPUT, TOO_LONG, QUEUE_FULL, CANCELLED, USB_TIMEOUT };
enum class Operation : uint8_t { PRESS, TAP, TEXT };

// Main-loop-only scheduler. Transport completion, lifecycle and time are explicit
// inputs so the complete scheduling policy can be tested without ESPHome or USB.
class KeyboardEngine {
 public:
  static constexpr size_t QUEUE_CAPACITY = 8;
  static constexpr size_t MAX_TEXT_LENGTH = 1024;
  void configure(uint32_t press_ms, uint32_t gap_ms, size_t max_length, size_t queue_limit) {
    press_ms_ = press_ms;
    gap_ms_ = gap_ms;
    max_length_ = max_length;
    queue_limit_ = queue_limit;
  }
  Result submit_key(Operation operation, std::string_view name, uint8_t modifiers);
  Result submit_text(std::string_view text);
  void cancel(Result reason = Result::CANCELLED);
  void set_available(bool available);
  void set_caps_lock(bool enabled) { caps_lock_ = enabled; }
  // Called on every reset/detach/suspend/protocol change, even if mounted has
  // already become true again by the time the main loop observes the event.
  void reset();
  bool next_report(uint32_t now, Report &report);
  void report_submitted(uint32_t now);
  void report_completed(uint32_t now);
  bool busy() const { return count_ != 0 || neutral_pending_ || waiting_; }
  Result last_result() const { return last_result_; }
  void reject_input() { last_result_ = Result::INVALID_INPUT; }
  bool available() const { return available_; }
  const Report &current_report() const { return current_; }

 protected:
  enum class Stage : uint8_t { IDLE, BASELINE, PRESS, HOLD, RELEASE, GAP, HELD };
  struct Request {
    Operation operation{Operation::PRESS};
    Key key{};
    std::string text;
  };
  Result result_(Result result) { return last_result_ = result; }
  bool room_() const { return count_ < queue_limit_; }
  Request &front_() { return queue_[head_]; }
  Request &back_() { return queue_[(head_ + count_) % QUEUE_CAPACITY]; }
  void pop_();
  Key active_key_() const;
  std::array<Request, QUEUE_CAPACITY> queue_{};
  size_t head_{0}, count_{0}, character_{0};
  size_t max_length_{256}, queue_limit_{4};
  uint32_t press_ms_{30}, gap_ms_{30}, completed_at_{0};
  Stage stage_{Stage::IDLE};
  Report current_{}, proposed_{};
  bool available_{false}, neutral_pending_{true}, waiting_{false}, cancelled_inflight_{false}, caps_lock_{false};
  Result last_result_{Result::ACCEPTED};
};

}  // namespace esphome::hid_keyboard
