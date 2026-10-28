// Standalone Home Assistant card. Draft text lives in this browser element only:
// no helper state, localStorage, sessionStorage, automatic send, or retry.
const PC_KEYBOARD_DEFAULTS = {
  title: "PC keyboard",
  max_length: 256,
};

// A public, versioned firmware contract. Never infer a target from entity names.
function keyboardInfo(state) {
  if (typeof state !== "string" || state.length > 255) return null;
  try {
    const info = JSON.parse(state);
    return info?.hid_keyboard === 1 && typeof info.node === "string"
      && /^[a-z0-9][a-z0-9_-]{0,62}$/.test(info.node)
      && Number.isInteger(info.max_length) && info.max_length >= 1 && info.max_length <= 1024
      && typeof info.connected === "boolean" && typeof info.busy === "boolean" ? info : null;
  } catch { return null; }
}

function keyboardChoices(hass) {
  return Object.entries(hass?.states || {})
    .filter(([id, state]) => id.startsWith("sensor.") && keyboardInfo(state.state))
    .map(([id, state]) => [id, state.attributes?.friendly_name || keyboardInfo(state.state).node]);
}

class PCKeyboardCard extends HTMLElement {
  static getStubConfig() { return { type: "custom:pc-keyboard-card" }; }
  static getConfigElement() { return document.createElement("pc-keyboard-card-editor"); }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._pending = false;
    this._cancelPending = false;
    this._onHidden = () => {
      if (document.hidden) this._clearDraft();
    };
    this._onPageHide = () => this._clearDraft();
  }

  setConfig(config) {
    const next = { ...PC_KEYBOARD_DEFAULTS, ...config };
    for (const key of ["type_text_action", "key_action", "clear_action", "cancel_action"]) {
      if (next[key] !== undefined && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(next[key])) {
        throw new Error(`${key} must be an action name such as esphome.keyboard_type_text`);
      }
    }
    if (next.keyboard_entity !== undefined && !/^sensor\.[a-z0-9_]+$/.test(next.keyboard_entity)) {
      throw new Error("keyboard_entity must be a keyboard discovery sensor");
    }
    if (!Number.isInteger(next.max_length) || next.max_length < 1 || next.max_length > 1024) {
      throw new Error("max_length must be an integer from 1 to 1024");
    }
    this._clearDraft();
    this._options = { ...config };
    this._config = next;
    if (!this._input) this._build();
    this.shadowRoot.querySelector("h2").textContent = next.title;
    this._input.maxLength = next.max_length;
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update(); // Preserve the input element across unrelated HA updates.
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this._onHidden);
    window.addEventListener("pagehide", this._onPageHide);
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this._onHidden);
    window.removeEventListener("pagehide", this._onPageHide);
    this._clearDraft();
  }

  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6 }; }

  _build() {
    const icons = {
      eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
      "eye-off": '<path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.8M6.2 6.2A22 22 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M10 10a3 3 0 0 0 4 4"/>',
      backspace: '<path d="M9 5h12v14H9l-7-7 7-7Zm3 4 6 6m0-6-6 6"/>',
      delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
      enter: '<path d="M20 4v9H4m5-5-5 5 5 5"/>',
      tab: '<path d="M3 12h14m-5-5 5 5-5 5m9-13v16"/>',
      clear: '<path d="m4 8 4-4 12 12-4 4H8l-6-6 2-6Zm1 9 8-8m3 11h6"/>',
      stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
      send: '<path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
    };
    const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
    // Static markup only. Neither configuration strings nor draft text are
    // interpolated into HTML, attributes, status messages, or error output.
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .content { padding: 20px; color: var(--primary-text-color, #212121); }
        h2 { font-size: 20px; margin: 0 0 12px; font-weight: 500; }
        p { margin: 8px 0; font-size: 13px; color: var(--secondary-text-color, #606060); }
        label { display: block; font-size: 14px; margin-bottom: 6px; }
        .entry { position: relative; }
        input { box-sizing: border-box; min-width: 0; width: 100%; padding: 14px 56px 14px 14px;
          font: inherit; color: var(--primary-text-color, #212121);
          background: var(--card-background-color, white);
          border: 1px solid var(--divider-color, #aaa); border-radius: 8px; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          min-width: 0; min-height: 44px; padding: 10px 8px; cursor: pointer;
          font: inherit; font-size: 14px; border-radius: 8px;
          border: 1px solid var(--divider-color, #aaa);
          color: var(--primary-text-color, #212121); background: transparent; }
        button.primary { background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, white); border-color: transparent; }
        svg { width: 20px; height: 20px; flex: 0 0 auto; }
        #reveal { position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
          width: 44px; padding: 0; border: 0; border-radius: 6px; }
        button:hover:not(:disabled) { filter: brightness(.92); background-color: var(--secondary-background-color, #f1f3f5); }
        button.primary:hover:not(:disabled) { background-color: var(--primary-color, #03a9f4); }
        button:disabled { opacity: .45; cursor: not-allowed; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: 2px; }
        .buttons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
        .key-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .key-row button { flex-direction: column; gap: 6px; min-height: 68px; }
        .utility-row button { min-height: 56px; }
        #cancel { width: 100%; margin-top: 8px; min-height: 48px;
          color: var(--error-color, #c62828); }
        .section { border-top: 1px solid var(--divider-color, #ddd); padding-top: 12px; margin-top: 16px; }
        #message { overflow-wrap: anywhere; }
        #message:empty { display: none; }
        #message.error { color: var(--error-color, #c62828); }
      </style>
      <ha-card><div class="content">
        <h2></h2>
        <p id="connection"></p>
        <label for="draft">Text / passphrase</label>
        <div class="entry">
          <input id="draft" type="password" autocomplete="off" autocapitalize="off"
            autocorrect="off" spellcheck="false">
          <button id="reveal" type="button" aria-label="Show text" title="Show text" aria-controls="draft" aria-pressed="false">${icon("eye")}</button>
        </div>
        <div class="buttons">
          <button id="send" type="button" class="primary">${icon("send")}Send text</button>
          <button id="clear-draft" type="button">${icon("close")}Clear draft</button>
        </div>
        <div class="section">
          <label>PC keyboard controls</label>
          <div class="buttons key-row">
            <button data-key="BACKSPACE" type="button">${icon("backspace")}Backspace</button>
            <button data-key="DELETE" type="button">${icon("delete")}Delete</button>
            <button data-key="ENTER" type="button">${icon("enter")}Enter</button>
          </div>
          <div class="buttons utility-row">
            <button id="clear-pc" type="button" title="Clear PC input (Ctrl+U)">${icon("clear")}Clear PC input</button>
            <button data-key="TAB" type="button">${icon("tab")}Tab</button>
          </div>
          <button id="cancel" type="button" title="Cancel typing and release all keys">${icon("stop")}Cancel typing</button>
        </div>
        <p id="message" role="status" aria-live="polite"></p>
      </div></ha-card>`;
    const query = (selector) => this.shadowRoot.querySelector(selector);
    this._input = query("#draft");
    this._reveal = query("#reveal");
    this._visibilityIcons = { show: icon("eye"), hide: icon("eye-off") };
    this._input.addEventListener("input", () => this._update());
    this._input.addEventListener("keydown", (event) => {
      // Do not let the browser's Enter key accidentally submit a LUKS attempt.
      if (event.key === "Enter") event.preventDefault();
      if (event.key === "Escape") this._clearDraft();
    });
    this._reveal.addEventListener("click", () => {
      this._setRevealed(this._input.type === "password");
    });
    query("#clear-draft").addEventListener("click", () => {
      this._clearDraft();
      this._message("");
    });
    query("#send").addEventListener("click", () => this._sendText());
    for (const button of this.shadowRoot.querySelectorAll("[data-key]")) {
      button.addEventListener("click", () => this._tap(button.dataset.key));
    }
    query("#clear-pc").addEventListener("click", () => this._run(
      this._config.clear_action, {}, { allowBusy: true },
    ));
    query("#cancel").addEventListener("click", () => this._run(
      this._config.cancel_action, {}, { allowBusy: true, allowDisconnected: true, isCancellation: true },
    ));
  }

  _clearDraft() {
    if (!this._input) return;
    this._input.value = "";
    this._setRevealed(false);
    this._update();
  }

  _setRevealed(showing) {
    this._input.type = showing ? "text" : "password";
    this._reveal.innerHTML = this._visibilityIcons[showing ? "hide" : "show"];
    this._reveal.setAttribute("aria-label", showing ? "Hide text" : "Show text");
    this._reveal.title = showing ? "Hide text" : "Show text";
    this._reveal.setAttribute("aria-pressed", String(showing));
  }

  _exists(action) {
    if (!action || !this._hass) return false;
    const [domain, service] = action.split(".");
    return Boolean(this._hass.services?.[domain]?.[service]);
  }

  _state(entity) { return this._hass?.states?.[entity]?.state; }
  _connected() {
    if (this._config.keyboard_entity && !this._info) return false;
    return this._config.connected_entity ? this._state(this._config.connected_entity) === "on" : this._info?.connected === true;
  }
  _idle() {
    if (this._config.keyboard_entity && !this._info) return false;
    return this._config.busy_entity ? this._state(this._config.busy_entity) === "off" : this._info?.busy === false;
  }

  _resolve() {
    this._info = this._options.keyboard_entity ? keyboardInfo(this._state(this._options.keyboard_entity)) : null;
    const actions = {};
    if (this._info) {
      const prefix = `esphome.${this._info.node.replaceAll("-", "_")}_`;
      for (const [setting, action] of Object.entries({ type_text_action: "type_text", key_action: "keyboard_tap", clear_action: "clear_input", cancel_action: "release_all_keys" })) {
        actions[setting] = prefix + action;
      }
    }
    this._config = { ...PC_KEYBOARD_DEFAULTS, ...actions, ...this._options };
    if (this._info) this._config.max_length = Math.min(this._options.max_length ?? this._info.max_length, this._info.max_length);
    this._input.maxLength = this._config.max_length;
  }

  _update() {
    if (!this._input || !this._config) return;
    this._resolve();
    const query = (selector) => this.shadowRoot.querySelector(selector);
    const connected = this._connected();
    const pending = this._pending || this._cancelPending;
    const ready = connected && this._idle() && !pending;
    const configured = this._config.keyboard_entity || this._config.connected_entity;
    query("#connection").textContent = !configured
      ? "Choose a keyboard in the card settings."
      : this._config.keyboard_entity && !this._info
      ? "Keyboard unavailable or discovery data unsupported."
      : !connected ? "USB keyboard not connected / host not awake."
      : !this._idle() ? "USB connected · keyboard busy or status unavailable"
      : "USB connected · keyboard ready";
    this._input.disabled = pending;
    query("#send").disabled = !ready || !this._input.value || !this._exists(this._config.type_text_action);
    for (const button of this.shadowRoot.querySelectorAll("[data-key]")) {
      button.disabled = !ready || !this._exists(this._config.key_action);
    }
    query("#clear-pc").disabled = pending || !connected || !this._exists(this._config.clear_action);
    query("#cancel").disabled = this._cancelPending || Boolean(this._config.keyboard_entity && !this._info) || !this._exists(this._config.cancel_action);
  }

  _message(text, error = false) {
    const message = this.shadowRoot.querySelector("#message");
    message.textContent = text;
    message.classList.toggle("error", error);
  }

  async _sendText() {
    if (this._pending || this._cancelPending || !this._connected() || !this._idle() || !this._exists(this._config.type_text_action)) return;
    const text = this._input.value;
    if (!text || text.length > this._config.max_length || !/^[\x20-\x7e]+$/.test(text)) {
      this._message("Use printable US QWERTY ASCII within the configured length limit. No text was sent.", true);
      return;
    }
    // Clear on submission, including ambiguous errors, to avoid an accidental
    // retry of a passphrase which may already have reached the host.
    this._clearDraft();
    await this._run(this._config.type_text_action, { input_text: text });
  }

  async _tap(key) {
    await this._run(this._config.key_action, { key, modifiers: 0 });
  }

  async _run(action, data, { allowBusy = false, allowDisconnected = false, isCancellation = false } = {}) {
    if (this._cancelPending || (!isCancellation && this._pending) || (this._config.keyboard_entity && !this._info) || !this._exists(action) || (!allowDisconnected && !this._connected()) || (!allowBusy && !this._idle())) return;
    const pending = isCancellation ? "_cancelPending" : "_pending";
    this[pending] = true;
    this._message("");
    this._update();
    try {
      const [domain, service] = action.split(".");
      await this._hass.callService(domain, service, data);
    } catch {
      // Do not echo server errors: a validation error could contain the payload.
      this._message("Request failed. Check the PC before retrying; some input may have arrived.", true);
    } finally {
      this[pending] = false;
      this._update();
    }
  }
}

class PCKeyboardCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._fields = [
      ["keyboard_entity", "Keyboard", "keyboard"],
      ["title", "Title", "text"],
      ["connected_entity", "USB connected sensor", "entity"],
      ["busy_entity", "Keyboard busy sensor", "entity"],
      ["type_text_action", "Send text action", "action"],
      ["key_action", "Tap key action", "action"],
      ["clear_action", "Clear PC input action", "action"],
      ["cancel_action", "Cancel typing action", "action"],
      ["max_length", "Maximum text length", "number"],
    ];
    this.shadowRoot.innerHTML = `<style>
      :host { display: block; color: var(--primary-text-color); }
      label { display: block; margin: 12px 0; font-size: 14px; }
      input, select { display: block; box-sizing: border-box; width: 100%; margin-top: 6px;
        min-height: 44px; padding: 10px; font: inherit; border-radius: 8px;
        border: 1px solid var(--divider-color, #aaa); color: var(--primary-text-color, #212121);
        background: var(--card-background-color, white); }
      details { margin-top: 20px; }
      summary { cursor: pointer; padding: 8px 0; }
    </style>`;
    const advanced = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Advanced overrides";
    advanced.append(summary);
    for (const [key, title, kind] of this._fields) {
      const label = document.createElement("label");
      label.textContent = title;
      const control = document.createElement(["keyboard", "entity", "action"].includes(kind) ? "select" : "input");
      control.id = key;
      if (kind === "text" || kind === "number") control.type = kind;
      if (kind === "number") { control.min = "1"; control.max = "1024"; control.step = "1"; }
      control.addEventListener("change", () => {
        if (!control.checkValidity()) return;
        this._config = { ...this._config };
        if (control.value === "") delete this._config[key];
        else this._config[key] = kind === "number" ? Number(control.value) : control.value;
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: { ...this._config } }, bubbles: true, composed: true,
        }));
      });
      label.append(control);
      (key === "keyboard_entity" || key === "title" ? this.shadowRoot : advanced).append(label);
    }
    this.shadowRoot.append(advanced);
  }

  setConfig(config) {
    this._config = { ...config };
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  _update() {
    if (!this._config) return;
    const config = { title: PC_KEYBOARD_DEFAULTS.title, ...this._config };
    const entities = Object.entries(this._hass?.states || {})
      .filter(([id]) => id.startsWith("binary_sensor."))
      .map(([id, state]) => [id, `${state.attributes?.friendly_name || id} (${id})`]);
    const actions = Object.entries(this._hass?.services?.esphome || {})
      .map(([id, action]) => [`esphome.${id}`, `${action.name || id} (esphome.${id})`]);
    for (const [key, , kind] of this._fields) {
      const control = this.shadowRoot.getElementById(key);
      if (["keyboard", "entity", "action"].includes(kind)) {
        const choices = kind === "keyboard" ? keyboardChoices(this._hass) : kind === "entity" ? entities : actions;
        const options = [...choices].sort((a, b) => a[1].localeCompare(b[1]));
        // Retain configured values while a device or its actions are unavailable.
        if (config[key] && !options.some(([value]) => value === config[key])) {
          options.unshift([config[key], `${config[key]} (unavailable)`]);
        }
        options.unshift(["", kind === "keyboard" ? "Choose a keyboard" : "Automatic"]);
        const signature = JSON.stringify(options);
        if (control.dataset.options !== signature) {
          control.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
          control.dataset.options = signature;
        }
      }
      if (control.value !== String(config[key] ?? "")) control.value = config[key] ?? "";
    }
  }
}

if (!customElements.get("pc-keyboard-card-editor")) customElements.define("pc-keyboard-card-editor", PCKeyboardCardEditor);
if (!customElements.get("pc-keyboard-card")) customElements.define("pc-keyboard-card", PCKeyboardCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "pc-keyboard-card")) {
  window.customCards.push({ type: "pc-keyboard-card", name: "PC keyboard", description: "Masked browser-local text input and remote USB keyboard controls" });
}
