#pragma once
#include <string>
namespace esphome {
class Application {
 public:
  const std::string &get_name() const { return name; }
  std::string name;
};
inline Application App;
}  // namespace esphome
