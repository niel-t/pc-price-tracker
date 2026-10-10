"""Checks every shop link in products.json, updates data/*.json and sends ntfy alerts on drops.

Run by GitHub Actions on a schedule; can also be run locally: python check.py
"""
import json
import logging
import os
import random
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

from tracker.alerts import send_ntfy
from tracker.drops import detect_drops
from tracker.shop import USER_AGENT, VAT, Offer, extract_price, shop_info

ROOT = Path(__file__).parent
DATA = ROOT / "data"
MAX_ALERTS = 100

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("check")


def load(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save(path: Path, data, compact=False):
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(data, ensure_ascii=False, indent=1)
    path.write_text(text + "\n", encoding="utf-8")


def fetch_offer(client: httpx.Client, link: dict) -> dict:
    """Reads one shop page. Always returns a row, with status ok | blocked | no-price | error."""
    url = link["url"]
    info = shop_info(url)
    row = {"shop": info["name"], "url": url, "price": None, "status": "ok", "detail": ""}
    try:
        r = client.get(url)
    except httpx.HTTPError as e:
        return row | {"status": "error", "detail": type(e).__name__}
    if r.status_code in (401, 403, 429, 503):
        return row | {"status": "blocked", "detail": f"HTTP {r.status_code}"}
    if r.status_code != 200:
        return row | {"status": "error", "detail": f"HTTP {r.status_code}"}
    price, _ = extract_price(r.text)
    if price is None:
        return row | {"status": "no-price", "detail": "No price found on page"}
    if link.get("excl_vat", info.get("excl_vat", False)):
        price = round(price * VAT, 2)
    return row | {"price": price}


def main() -> int:
    config = load(ROOT / "products.json", {})
    settings = config.get("settings", {})
    threshold = float(settings.get("drop_threshold_pct", 5))
    ntfy_server = settings.get("ntfy_server", "https://ntfy.sh")
    ntfy_topic = os.environ.get("NTFY_TOPIC", "")

    DATA.mkdir(exist_ok=True)
    latest = load(DATA / "latest.json", {})    # id -> {name, checked_at, offers: [row, ...]}
    history = load(DATA / "history.json", {})  # id -> {shop: [[time, price], ...]} (only when the price changes)
    alerts = load(DATA / "alerts.json", [])

    products = config.get("products", [])
    # Drop data for parts that were removed from products.json.
    for store in (latest, history):
        for pid in set(store) - {p["id"] for p in products}:
            del store[pid]

    client = httpx.Client(headers={"User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9"},
                          follow_redirects=True, timeout=25)
    total_links = failed_links = 0
    try:
        for product in products:
            pid = product["id"]
            rows = []
            for link in product.get("shops", []):
                if rows:
                    time.sleep(random.uniform(1, 3))
                rows.append(fetch_offer(client, link))
            total_links += len(rows)
            failed_links += sum(r["status"] != "ok" for r in rows)

            now = datetime.now(timezone.utc).isoformat(timespec="seconds")
            ok = [r for r in rows if r["status"] == "ok"]
            prev = {o["shop"]: o["price"] for o in latest.get(pid, {}).get("offers", []) if o.get("price")}
            shop_hist = history.setdefault(pid, {})
            all_time_low = min((p[1] for pts in shop_hist.values() for p in pts), default=None)

            for r in ok:
                pts = shop_hist.setdefault(r["shop"], [])
                if not pts or pts[-1][1] != r["price"]:
                    pts.append([now, r["price"]])
            latest[pid] = {"name": product["name"], "checked_at": now,
                           "offers": sorted(rows, key=lambda r: (r["price"] is None, r["price"] or 0))}

            for r in rows:
                log.info("%-28s %-20s %s", product["name"][:28], r["shop"][:20],
                         f"€{r['price']:.2f}" if r["price"] else f"{r['status']} ({r['detail']})")
            if not ok:
                continue
            offers = [Offer(r["shop"], r["price"], r["url"]) for r in ok]
            reasons = detect_drops(product, offers, prev, all_time_low, threshold)
            if reasons:
                cheapest = min(offers, key=lambda o: o.price)
                message = "\n".join(reasons)
                alerts.insert(0, {"time": now, "id": pid, "name": product["name"], "url": cheapest.url, "message": message})
                log.info("ALERT %s\n%s", product["name"], message)
                try:
                    send_ntfy(ntfy_server, ntfy_topic, f"Price drop: {product['name']}", message, cheapest.url)
                except Exception as e:
                    log.error("ntfy failed: %s", e)
    finally:
        client.close()

    save(DATA / "latest.json", latest)
    save(DATA / "history.json", history, compact=True)
    save(DATA / "alerts.json", alerts[:MAX_ALERTS])
    # Fail the run (so GitHub emails you) only if every shop link failed; single blocked shops show on the dashboard.
    return 1 if total_links and failed_links == total_links else 0


if __name__ == "__main__":
    raise SystemExit(main())
