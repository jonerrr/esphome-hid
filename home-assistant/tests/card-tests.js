// Browser-only regression tests. No real HA connection or service calls.
window.runPCKeyboardCardTests = async () => {
  const checks = [];
  const assert = (condition, label) => {
    if (!condition) throw new Error(`Failed: ${label}`);
    checks.push(label);
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const calls = [];
  let handler = async () => {};
  const hass = {
    states: {
      "binary_sensor.pc_remote_usb_keyboard_connected": { state: "on" },
      "binary_sensor.pc_remote_usb_keyboard_busy": { state: "off" },
    },
    services: { esphome: {
      pc_remote_type_text: {}, pc_remote_keyboard_tap: {},
      pc_remote_clear_input: {}, pc_remote_release_all_keys: {},
    } },
    callService: async (domain, service, data) => {
      calls.push({ domain, service, data });
      await handler(domain, service, data);
    },
  };
  const legacyConfig = {
    type_text_action: "esphome.pc_remote_type_text",
    key_action: "esphome.pc_remote_keyboard_tap",
    clear_action: "esphome.pc_remote_clear_input",
    cancel_action: "esphome.pc_remote_release_all_keys",
    connected_entity: "binary_sensor.pc_remote_usb_keyboard_connected",
    busy_entity: "binary_sensor.pc_remote_usb_keyboard_busy",
  };
  const card = document.createElement("pc-keyboard-card");
  card.setConfig(legacyConfig);
  card.hass = hass;
  document.body.append(card);
  const query = (selector) => card.shadowRoot.querySelector(selector);
  const draft = (value) => {
    query("#draft").value = value;
    query("#draft").dispatchEvent(new Event("input"));
  };

  assert(query("#draft").type === "password", "masked by default");
  assert(calls.length === 0, "no send on load");
  draft("  Test-only-Aa!  ");
  query("#reveal").click();
  assert(query("#draft").type === "text" && query("#reveal").getAttribute("aria-label") === "Hide text" && query("#reveal svg"), "accessible eye toggle reveals text");
  const input = query("#draft");
  card.hass = { ...hass };
  assert(query("#draft") === input && input.value === "  Test-only-Aa!  ", "HA updates preserve the draft element");
  assert(!card.shadowRoot.innerHTML.includes(input.value), "draft never interpolated into HTML");
  query("#clear-draft").click();
  assert(input.value === "" && input.type === "password" && calls.length === 0, "clear draft is local and re-masks");

  draft("  Test-only-Aa!  ");
  query("#send").click(); await tick();
  assert(calls.length === 1 && calls[0].service === "pc_remote_type_text", "send calls only the typing action");
  assert(calls[0].data.input_text === "  Test-only-Aa!  ", "preserve leading/trailing whitespace and punctuation");
  assert(input.value === "" && input.type === "password", "clear and mask after submission");
  assert(!query("#message").textContent.includes("Test-only"), "no passphrase in success status");
  query('[data-key="ENTER"]').click(); await tick();
  assert(calls.length === 2 && calls[1].data.key === "ENTER", "Enter is an explicit separate action");

  for (const key of ["BACKSPACE", "DELETE", "TAB"]) {
    query(`[data-key="${key}"]`).click(); await tick();
    assert(calls.at(-1).service === "pc_remote_keyboard_tap" && calls.at(-1).data.key === key, `${key} sends the intended key`);
  }
  let count = calls.length;
  draft("non-ASCII-é");
  query("#send").click(); await tick();
  assert(calls.length === count && !query("#message").textContent.includes("non-ASCII-é"), "reject unsupported input without sending/echoing it");
  draft("x".repeat(257));
  query("#send").click(); await tick();
  assert(calls.length === count, "reject whole overlong draft");

  handler = async () => { throw new Error("server echoed Test-only-failure"); };
  draft("Test-only-failure");
  query("#send").click(); await tick();
  assert(input.value === "" && !query("#message").textContent.includes("Test-only-failure"), "failed request clears draft and suppresses echoed payload");
  count = calls.length;
  card.hass = { ...hass }; await tick();
  assert(calls.length === count, "never retry on HA refresh");

  let resolve;
  handler = () => new Promise((done) => { resolve = done; });
  draft("Test-only-pending");
  const sending = card._sendText();
  count = calls.length;
  await card._sendText();
  assert(calls.length === count && input.disabled, "prevent duplicate submission while request is in flight");
  resolve(); await sending;
  handler = async () => {};

  // Each completion order must keep the other in-flight operation locked.
  for (const cancelFirst of [true, false]) {
    let finishTyping, finishCancel;
    handler = (domain, service) => new Promise((done) => {
      if (service === "pc_remote_release_all_keys") finishCancel = done;
      else finishTyping = done;
    });
    draft("Test-only-cancel-pending");
    const typing = card._sendText();
    assert(!query("#cancel").disabled, "cancellation remains available before typing acknowledgement");
    count = calls.length;
    query("#cancel").click(); await tick();
    assert(calls.length === count + 1 && calls.at(-1).service === "pc_remote_release_all_keys", "cancel bypasses a pending typing request");
    query("#cancel").click(); await tick();
    assert(calls.length === count + 1, "prevent duplicate cancellation while its request is pending");
    if (cancelFirst) finishCancel();
    else { finishTyping(); await typing; }
    await tick();
    assert(input.disabled && query('[data-key="ENTER"]').disabled && query("#clear-pc").disabled, "one completed request cannot unlock the other pending request");
    count = calls.length;
    draft("Test-only-blocked"); await card._sendText(); await card._tap("ENTER");
    assert(calls.length === count, "ordinary submissions remain blocked until both requests finish");
    if (cancelFirst) { finishTyping(); await typing; }
    else finishCancel();
    await tick();
    assert(!input.disabled && !query("#cancel").disabled, "controls recover after typing and cancellation settle");
    query("#clear-draft").click();
  }
  handler = async () => {};

  hass.states["binary_sensor.pc_remote_usb_keyboard_busy"] = { state: "on" };
  card.hass = { ...hass };
  assert(query('[data-key="BACKSPACE"]').disabled && !query("#clear-pc").disabled, "typing locks ordinary controls but permits cancellation/clear");
  query("#clear-pc").click(); await tick();
  assert(calls.at(-1).service === "pc_remote_clear_input", "PC clear uses atomic device-side cancel plus Ctrl+U action");
  query("#cancel").click(); await tick();
  assert(calls.at(-1).service === "pc_remote_release_all_keys", "cancel releases keys without entering text");

  hass.states["binary_sensor.pc_remote_usb_keyboard_busy"] = { state: "off" };
  hass.states["binary_sensor.pc_remote_usb_keyboard_connected"] = { state: "off" };
  card.hass = { ...hass };
  draft("Test-only-offline"); count = calls.length;
  query("#send").click(); await card._sendText();
  assert(calls.length === count && query("#send").disabled, "no offline submission or replay queue");
  hass.states["binary_sensor.pc_remote_usb_keyboard_connected"] = { state: "on" };
  card.hass = { ...hass };
  assert(calls.length === count, "reconnect does not send the draft");
  const enter = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  input.dispatchEvent(enter);
  assert(enter.defaultPrevented && calls.length === count, "browser Enter never submits to the PC");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  assert(input.value === "" && calls.length === count, "Escape clears draft locally");

  draft("Test-only-background"); query("#reveal").click();
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  document.dispatchEvent(new Event("visibilitychange"));
  delete document.hidden;
  assert(input.value === "" && input.type === "password", "backgrounding clears and masks the draft");
  draft("Test-only-navigation"); card.remove();
  assert(input.value === "" && input.type === "password", "removing card clears draft");

  card.setConfig({ title: "<img src=x onerror=alert(1)>" });
  assert(!card.shadowRoot.querySelector("img"), "configuration title is text, never HTML");
  card.setConfig(legacyConfig); card.hass = hass;
  document.body.append(card); // Leave a clean, empty interactive preview.

  const editor = customElements.get("pc-keyboard-card").getConfigElement();
  editor.setConfig({ ...legacyConfig, type: "custom:pc-keyboard-card", title: "Office PC" });
  const customHass = {
    ...hass,
    states: { ...hass.states, "binary_sensor.office_usb": { state: "on", attributes: { friendly_name: "Office USB" } } },
    services: { esphome: { ...hass.services.esphome, office_type_text: {} } },
  };
  editor.hass = customHass;
  const field = (key) => editor.shadowRoot.getElementById(key);
  assert([...field("connected_entity").options].some((option) => option.value === "binary_sensor.office_usb"), "editor lists HA binary sensors");
  assert([...field("type_text_action").options].some((option) => option.value === "esphome.office_type_text"), "editor lists ESPHome actions");
  let saved;
  editor.addEventListener("config-changed", (event) => { saved = event.detail.config; });
  field("type_text_action").value = "esphome.office_type_text";
  field("type_text_action").dispatchEvent(new Event("change"));
  assert(saved.type_text_action === "esphome.office_type_text" && saved.title === "Office PC", "editor saves selections and preserves other settings");
  field("connected_entity").value = "binary_sensor.office_usb";
  field("connected_entity").dispatchEvent(new Event("change"));
  card.setConfig(saved); card.hass = customHass;
  draft("Test-only-office"); query("#send").click(); await tick();
  assert(calls.at(-1).service === "office_type_text", "chosen action routes text to another keyboard");
  customHass.states["binary_sensor.office_usb"].state = "off";
  card.hass = { ...customHass };
  assert(query("#send").disabled && query("#connection").textContent.includes("not connected"), "chosen sensor controls connection state");
  editor.hass = { ...customHass, services: { esphome: {} } };
  assert(field("type_text_action").value === "esphome.office_type_text", "editor retains configured actions during disconnection");
  field("max_length").value = "0";
  field("max_length").dispatchEvent(new Event("change"));
  assert(saved.max_length === undefined, "editor rejects invalid length without saving");
  card.setConfig(legacyConfig); card.hass = hass;
  card.setConfig({}); card.hass = hass;
  count = calls.length;
  assert(query("#send").disabled && query("#cancel").disabled, "unconfigured card never targets an example device");
  const discovery = (node, changes = {}) => JSON.stringify({ hid_keyboard: 1, node, max_length: 128, connected: true, busy: false, ...changes });
  const discoveredHass = {
    ...hass,
    states: {
      "sensor.office_keyboard": { state: discovery("office-pc"), attributes: { friendly_name: "Office keyboard" } },
      "sensor.bedroom_keyboard": { state: discovery("bedroom-pc") },
      "sensor.invalid_keyboard": { state: discovery("invalid", { hid_keyboard: 9 }) },
    },
    services: { esphome: {} },
  };
  for (const node of ["office_pc", "bedroom_pc"]) {
    for (const action of ["type_text", "keyboard_tap", "clear_input", "release_all_keys"]) {
      discoveredHass.services.esphome[`${node}_${action}`] = {};
    }
  }
  editor.setConfig({ type: "custom:pc-keyboard-card" }); editor.hass = discoveredHass;
  assert(field("keyboard_entity").options.length === 3, "picker lists only supported discovery entities plus placeholder");
  assert(!editor.shadowRoot.querySelector("details").open, "manual mappings are collapsed under Advanced");
  field("keyboard_entity").value = "sensor.office_keyboard";
  field("keyboard_entity").dispatchEvent(new Event("change"));
  assert(saved.keyboard_entity === "sensor.office_keyboard" && !saved.type_text_action, "one keyboard selection saves without manual mappings");
  card.setConfig(saved); card.hass = discoveredHass;
  assert(input.maxLength === 128 && query("#connection").textContent.includes("ready"), "discovery supplies live status and firmware text limit");
  assert(calls.length === count, "selecting a keyboard never sends a request");
  draft("Test-only-discovery"); query("#send").click(); await tick();
  assert(calls.at(-1).service === "office_pc_type_text", "node metadata resolves the chosen keyboard action");
  query('[data-key="TAB"]').click(); await tick();
  assert(calls.at(-1).service === "office_pc_keyboard_tap" && calls.at(-1).data.key === "TAB", "discovery resolves key action");
  discoveredHass.states["sensor.office_keyboard"].state = discovery("office-pc", { busy: true });
  card.hass = { ...discoveredHass };
  assert(query('[data-key="ENTER"]').disabled && !query("#cancel").disabled && query("#connection").textContent.includes("busy"), "discovery updates busy state while allowing cancellation");
  query("#clear-pc").click(); await tick();
  assert(calls.at(-1).service === "office_pc_clear_input", "discovery resolves clear action");
  query("#cancel").click(); await tick();
  assert(calls.at(-1).service === "office_pc_release_all_keys", "discovery resolves cancel action");
  count = calls.length;
  for (const state of ["unavailable", "{broken", discovery("office-pc", { hid_keyboard: 2 }), discovery("office-pc", { busy: "false" }), discovery("office-pc", { node: "invalid.node" })]) {
    discoveredHass.states["sensor.office_keyboard"].state = state;
    card.hass = { ...discoveredHass };
    await card._sendText(); await card._tap("ENTER");
    assert(query("#send").disabled && query("#cancel").disabled && calls.length === count, "invalid or unavailable discovery fails closed: " + state);
  }
  discoveredHass.states["sensor.office_keyboard"].state = discovery("office-pc", { connected: false });
  card.hass = { ...discoveredHass };
  assert(query("#send").disabled && query("#connection").textContent.includes("not connected"), "discovery reflects USB disconnect");
  editor.hass = discoveredHass;
  assert(field("keyboard_entity").value === "sensor.office_keyboard", "picker retains selected keyboard when disconnected");
  discoveredHass.states["sensor.office_keyboard"].state = discovery("office-pc");
  card.hass = { ...discoveredHass };
  assert(calls.length === count, "discovery recovery never replays input");
  draft("Test-only-old-target");
  card.setConfig({ keyboard_entity: "sensor.bedroom_keyboard" });
  assert(input.value === "" && calls.length === count, "switching keyboards clears the draft without sending");
  draft("Test-only-bedroom"); query("#send").click(); await tick();
  assert(calls.at(-1).service === "bedroom_pc_type_text", "multiple keyboards remain isolated");
  card.setConfig({ keyboard_entity: "sensor.office_keyboard", max_length: 1024 });
  assert(input.maxLength === 128, "advanced text limit cannot exceed advertised firmware limit");
  card.setConfig({ keyboard_entity: "sensor.office_keyboard", type_text_action: "esphome.pc_remote_type_text" });
  card.hass = { ...discoveredHass, services: { esphome: { ...discoveredHass.services.esphome, ...hass.services.esphome } } };
  draft("Test-only-override"); query("#send").click(); await tick();
  assert(calls.at(-1).service === "pc_remote_type_text", "explicit advanced action override is honored");
  card.setConfig({ keyboard_entity: "sensor.office_keyboard" }); card.hass = discoveredHass;
  return { passed: checks.length, checks };
};
