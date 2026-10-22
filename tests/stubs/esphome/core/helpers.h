#pragma once
#include <cstring>
#include <string>
namespace esphome {
inline constexpr int MAC_ADDRESS_BUFFER_SIZE = 13;
inline void get_mac_address_into_buffer(char* buffer) {
  std::memcpy(buffer, "001122334455", 13);
}
class StringRef {
 public:
  explicit StringRef(const char* value) : data_(value), size_(std::strlen(value)) {}
  explicit StringRef(const std::string &value) : data_(value.c_str()), size_(value.size()) {}
  const char* c_str() const { return data_; }
  size_t size() const { return size_; }

 protected:
  const char* data_;
  size_t size_;
};
}  // namespace esphome
