"""Keyboard identity and live status for automatic dashboard configuration."""

import json

import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components import text_sensor
from esphome.const import ENTITY_CATEGORY_DIAGNOSTIC
from esphome.core import CORE

from . import HIDKeyboard, ns

DEPENDENCIES = ["hid_keyboard"]

KeyboardDiscovery = ns.class_("KeyboardDiscovery", text_sensor.TextSensor, cg.Component)

CONFIG_SCHEMA = (
    text_sensor.text_sensor_schema(
        KeyboardDiscovery,
        icon="mdi:keyboard",
        entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
    )
    .extend({cv.Required("hid_keyboard_id"): cv.use_id(HIDKeyboard)})
    .extend(cv.COMPONENT_SCHEMA)
)


async def to_code(config):
    var = await text_sensor.new_text_sensor(config)
    await cg.register_component(var, config)
    parent = await cg.get_variable(config["hid_keyboard_id"])
    cg.add(var.set_keyboard(parent))
    # All metadata is public configuration. No typed text is retained here.
    metadata = json.dumps(
        {
            "hid_keyboard": 1,
            "max_length": CORE.config["hid_keyboard"]["max_text_length"],
        },
        separators=(",", ":"),
    )
    cg.add(var.set_metadata(metadata[:-1]))
