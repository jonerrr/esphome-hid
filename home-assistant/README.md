# PC keyboard dashboard card

Type text and control an ESPHome USB keyboard from Home Assistant.

## Installation

1. Set up the ESPHome keyboard using the [main README](../README.md#build-and-connect)
   and [example configuration](../examples/keyboard.yaml), then add it to Home
   Assistant through the ESPHome integration.
2. In **HACS → ⋮ → Custom repositories**, add
   `https://github.com/jonerrr/esphome-hid` with type **Dashboard**.
3. Download **PC Keyboard (ESPHome HID)** and refresh your browser.
4. Add **PC keyboard** to your dashboard, choose your keyboard, and save.

Leave **Advanced overrides** unchanged unless you use custom action or sensor names.
For YAML dashboards, see [dashboard-card.yaml](dashboard-card.yaml).

## Usage

Wait for the keyboard to show ready and focus the intended field on the PC.
Enter the text, press **Send text**, then use **Enter** to submit it on the PC.
Text uses the US QWERTY layout and supports printable ASCII.

- **Clear draft** clears the dashboard input.
- **Backspace**, **Delete**, and **Tab** send those keys to the PC.
- **Clear PC input** cancels typing and sends Ctrl+U. Support depends on the PC's
  prompt or application; use Backspace if Ctrl+U does not clear it.
- **Cancel typing** stops pending input and releases keys. It does not erase
  characters already entered on the PC.

If typing is interrupted, check and clear the PC's input before sending again.

## Troubleshooting

**No keyboards listed:** Update the firmware with the example's `hid_keyboard`
text sensor, check that its entity is enabled and available, and let the
ESPHome integration reconnect.

**Card missing after installation:** Refresh the browser and check
**Settings → Dashboards → Resources** for this JavaScript module:

```text
/hacsfiles/esphome-hid/esphome-hid.js
```

Add it if missing. Remove older resources for the same card to avoid loading
multiple versions.

## Passwords

Unsent text stays in the browser and is cleared after sending or leaving the
page. Submitted text passes through Home Assistant and the encrypted ESPHome
connection. Use HTTPS for remote access and avoid automations or logging that
record passphrases.
