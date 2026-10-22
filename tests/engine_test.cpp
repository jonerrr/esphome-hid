#include "keyboard_engine.h"
#include <cassert>
#include <iostream>
#include <vector>
using namespace esphome::hid_keyboard;

struct Host {
  KeyboardEngine engine;
  uint32_t now{0};
  bool transfer{false};
  uint32_t due{0};
  std::vector<Report> reports;
  Host() { engine.set_available(true); }
  void tick(bool ready = true, uint32_t latency = 1) {
    if (transfer && static_cast<int32_t>(now - due) >= 0) {
      transfer = false;
      engine.report_completed(now);
    }
    Report report;
    if (ready && engine.next_report(now, report)) {
      reports.push_back(report);
      engine.report_submitted(now);
      transfer = true;
      due = now + latency;
    }
    now++;
  }
  void drain() {
    for (int i = 0; i < 20000 && engine.busy(); i++) tick();
    assert(!engine.busy());
  }
};

int main() {
  Key key;
  for (unsigned c = 0; c < 256; c++) {
    assert(ascii_key(c, key) == ((c >= 32 && c <= 126) || c == '\n' || c == '\t'));
  }
  assert(ascii_key('@', key) && key.code == 0x1f && key.modifiers == 2);
  assert(ascii_key('"', key) && key.code == 0x34 && key.modifiers == 2);
  assert(named_key("escape", key) && key.code == 0x29);
  assert(named_key("F12", key) && key.code == 0x45);
  assert(!named_key("F13", key));
  assert(named_key("RIGHT_ALT", key) && key.modifiers == 0x40 && key.code == 0);

  {  // Validate the entire request without emitting any prefix.
    Host host;
    host.drain();
    auto start = host.reports.size();
    assert(host.engine.submit_text("abc\xc3\xa9") == Result::INVALID_INPUT);
    assert(host.engine.submit_text(std::string("abc\0x", 5)) == Result::INVALID_INPUT);
    assert(host.engine.submit_text("\r") == Result::INVALID_INPUT);
    assert(host.engine.submit_text(std::string(257, 'x')) == Result::TOO_LONG);
    host.drain();
    assert(host.reports.size() == start);
  }
  {  // Copy text before caller storage changes; preserve FIFO and repeated keys.
    Host host;
    std::string input = "aa!";
    assert(host.engine.submit_text(input) == Result::ACCEPTED);
    input.assign("zzz");
    assert(host.engine.submit_key(Operation::TAP, "ENTER", 0) == Result::ACCEPTED);
    host.drain();
    std::vector<uint8_t> codes, mods;
    for (const auto &report : host.reports)
      if (report.keys[0]) {
        codes.push_back(report.keys[0]);
        mods.push_back(report.modifiers);
      }
    assert((codes == std::vector<uint8_t>{4, 4, 0x1e, 0x28}));
    assert((mods == std::vector<uint8_t>{0, 0, 2, 0}));
    for (size_t i = 1; i < host.reports.size(); i++) {
      if (host.reports[i].keys[0]) assert(host.reports[i - 1] == Report{});
    }
    assert(host.reports.back() == Report{});
  }
  {  // Endpoint backpressure cannot consume a transition; hold starts at ACK.
    Host host;
    host.engine.configure(30, 20, 256, 4);
    host.drain();
    host.engine.submit_key(Operation::TAP, "x", 1);
    host.tick();  // baseline queued
    host.tick();  // baseline ACK and press queued
    assert(host.reports.back().keys[0] == 0x1b);
    host.due = host.now + 100;
    auto size = host.reports.size();
    for (int i = 0; i < 100; i++) host.tick();
    assert(host.reports.size() == size);
    host.tick();  // press ACK
    for (int i = 0; i < 29; i++) host.tick();
    assert(host.reports.size() == size);
    host.tick(false);  // release due but endpoint unavailable
    assert(host.reports.size() == size);
    host.tick();
    assert(host.reports.back() == Report{});
    host.drain();
  }
  {  // Cancellation while press is in flight must still send a neutral report.
    Host host;
    host.drain();
    host.engine.submit_text("secret");
    host.tick();
    host.tick();
    assert(host.reports.back().keys[0] == 0x16);
    host.engine.cancel();
    host.tick();
    assert(host.reports.back() == Report{});
    host.drain();
    assert(host.reports.size() == 4);
  }
  {  // Reset+remount between ticks drops old request and old held state.
    Host host;
    host.engine.submit_text("secret");
    host.tick();
    host.tick();
    host.tick();
    host.engine.reset();
    host.transfer = false;
    auto start = host.reports.size();
    host.drain();
    assert(host.reports.size() == start + 1 && host.reports.back() == Report{});
    host.engine.set_available(false);
    assert(host.engine.submit_text("x") == Result::UNAVAILABLE);
    host.engine.set_available(true);
    host.drain();
    assert(host.reports.back() == Report{});
  }
  {  // Bounded queue rejects a whole request without modifying existing work.
    Host host;
    host.engine.configure(1, 1, 8, 2);
    assert(host.engine.submit_text("ab") == Result::ACCEPTED);
    assert(host.engine.submit_text("c") == Result::ACCEPTED);
    assert(host.engine.submit_text("d") == Result::QUEUE_FULL);
    host.drain();
    unsigned presses = 0;
    for (const auto &report : host.reports)
      if (report.keys[0]) presses++;
    assert(presses == 3);
  }
  {  // millis rollover and persistent press.
    Host host;
    host.now = UINT32_MAX - 10;
    host.engine.submit_key(Operation::TAP, "a", 8);
    host.drain();
    host.engine.submit_key(Operation::PRESS, "RIGHT_CTRL", 0);
    host.drain();
    assert(host.engine.current_report().modifiers == 16);
    host.engine.cancel();
    host.drain();
    assert(host.engine.current_report() == Report{});
  }
  {  // Text case follows the Caps Lock LED reported by the host.
    Host host;
    host.engine.set_caps_lock(true);
    host.engine.submit_text("aA!");
    host.drain();
    std::vector<uint8_t> mods;
    for (const auto &report : host.reports)
      if (report.keys[0]) mods.push_back(report.modifiers);
    assert((mods == std::vector<uint8_t>{2, 0, 2}));
  }
  std::cout << "engine scenarios passed\n";
}
