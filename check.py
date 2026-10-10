"""Checks every product in products.json, updates data/*.json and sends ntfy alerts on drops.

Run by GitHub Actions on a schedule; can also be run locally: python check.py
"""
import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path

from tracker.alerts import send_ntfy
from tracker.drops import detect_drops
from tracker.scraper import PRODUCT_URL, TweakersClient

ROOT = Path(__file__).parent
DATA = ROOT / "data"
MAX_ALERTS = 100

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("check")


def load(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def product_id(url: str) -> str:
    m = PRODUCT_URL.match(url)
    if not m:
        raise ValueError(f"Not a Tweakers Pricewatch product URL: {url}")
    return m.group(1)


def main() -> int:
    config = load(ROOT / "products.json", {})
    settings = config.get("settings", {})
    threshold = float(settings.get("drop_threshold_pct", 5))
    ntfy_server = settings.get("ntfy_server", "https://ntfy.sh")
    ntfy_topic = os.environ.get("NTFY_TOPIC", "")

    DATA.mkdir(exist_ok=True)
    latest = load(DATA / "latest.json", {})    # id -> {name, url, checked_at, offers: [...]}
    history = load(DATA / "history.json", {})  # id -> [[time, lowest, shop], ...] (only when lowest changes)
    alerts = load(DATA / "alerts.json", [])

    client = TweakersClient()
    failures = 0
    try:
        for i, product in enumerate(config.get("products", [])):
            if i:
                time.sleep(random.uniform(3, 7))  # be polite to Tweakers
            url = product["url"]
            try:
                pid = product_id(url)
                page = client.fetch(url)
            except Exception as e:
                failures += 1
                log.error("Failed %s: %s", url, e)
                continue
            if not page.offers:
                log.warning("No offers for %s", page.name)
                continue

            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            prev = {o["shop"]: o["price"] for o in latest.get(pid, {}).get("offers", [])}
            points = history.setdefault(pid, [])
            all_time_low = min((p[1] for p in points), default=None)

            reasons = detect_drops(product, page.offers, prev, all_time_low, threshold)
            cheapest = min(page.offers, key=lambda o: o.price)
            if not points or points[-1][1] != cheapest.price:
                points.append([now, cheapest.price, cheapest.shop])
            latest[pid] = {
                "name": page.name,
                "url": url,
                "checked_at": now,
                "offers": [{"shop": o.shop, "price": o.price, "total": o.total}
                           for o in sorted(page.offers, key=lambda o: o.price)],
            }
            log.info("%s: lowest %.2f at %s (%d shops)", page.name, cheapest.price, cheapest.shop, len(page.offers))

            if reasons:
                message = "\n".join(reasons)
                alerts.insert(0, {"time": now, "id": pid, "name": page.name, "url": url, "message": message})
                log.info("ALERT %s\n%s", page.name, message)
                try:
                    send_ntfy(ntfy_server, ntfy_topic, f"Price drop: {page.name}", message, url)
                except Exception as e:
                    log.error("ntfy failed: %s", e)
    finally:
        client.close()

    save(DATA / "latest.json", latest)
    save(DATA / "history.json", history)
    save(DATA / "alerts.json", alerts[:MAX_ALERTS])
    # Fail the run (so GitHub emails you) only if every product failed, e.g. Tweakers blocking us.
    return 1 if failures and failures == len(config.get("products", [])) else 0


if __name__ == "__main__":
    raise SystemExit(main())
