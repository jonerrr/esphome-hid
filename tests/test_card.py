"""Run the existing dashboard regression suite in a real browser."""

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def test_dashboard_card():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        try:
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto((ROOT / "home-assistant/tests/index.html").as_uri())
            page.wait_for_function("document.querySelector('#result').textContent !== 'Running…'")
            result = page.locator("#result").inner_text()
            assert not errors, errors
            assert result.endswith(" checks passed"), result
        finally:
            browser.close()
