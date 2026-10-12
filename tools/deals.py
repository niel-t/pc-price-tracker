"""Collects today's best PC-part price drops from Tweakers Pricewatch Deals into data/deals.json.

Tweakers blocks GitHub's servers, so this runs on your own PC (e.g. daily via Windows Task Scheduler):

    .venv\\Scripts\\python tools\\deals.py                    # just write data/deals.json
    .venv\\Scripts\\python tools\\deals.py --push             # and commit + push it so the dashboard shows it
    .venv\\Scripts\\python tools\\deals.py --push --notify    # and send the #1 deal to your phone (ntfy topic in local.json)

Uses the same product rules as the suggestions catalog (GPU: RTX 3000+/RX 5000+; other parts:
released in the last 36 months; desktop CPUs only).
"""
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.build_catalog import CATEGORIES, Tweakers, cutoff_id, keep, tweakers_price  # noqa: E402
from tools import pepper  # noqa: E402
from tools.gitpush import local_config, push, setup_log  # noqa: E402
from tracker.alerts import send_ntfy  # noqa: E402
from tracker.drops import eur  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "deals.json"
STATE = ROOT / "logs" / "deals_state.json"  # what we last notified about (not committed)
DASHBOARD = "https://niel-t.github.io/pc-price-tracker/"
MAX_PAGES = 5      # per category; most categories have one page of deals per day
KEEP = 60          # deals stored (the dashboard shows the top 10, optionally per category)
MIN_PRICE = 15     # skip cables and other small stuff


def parse_deals(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    deals = []
    for tr in soup.select("tr"):
        a = tr.select_one("a.editionName")
        disc = tr.select_one("td.discountRow")
        if not a or not disc:
            continue
        before = tr.select_one(".beforePrice")
        price = tr.select_one("p.price")
        pct = re.search(r"(\d+)", disc.get_text())
        badge = tr.select_one(".lowestPriceBadge")
        spec = tr.select_one("p.specline")
        img = tr.select_one("td.pwimage img")
        deals.append({
            "id": int(re.search(r"pricewatch/(\d+)/", a["href"]).group(1)),
            "name": a.get("title") or a.get_text(strip=True),
            "spec": spec.get_text(" ", strip=True) if spec else "",
            "url": a["href"],
            "image": img["src"] if img else None,
            "price": tweakers_price(price.get_text()) if price else None,
            "before": tweakers_price(before.get_text()) if before else None,
            "discount_pct": int(pct.group(1)) if pct else 0,
            # Tweakers' lowest price over the last months; price/low > 1 means it has been cheaper recently.
            "low_6m": float(disc["data-lowest-price"]) if disc.get("data-lowest-price") else None,
            "badge": badge.get_text(" ", strip=True) if badge else None,
        })
    return deals


def score(d: dict) -> float:
    """Discount %, nudged by whether it's a genuine low: a 'lowest price in N months' badge earns
    a bonus; being well above the recent lowest price (an inflated 'before' price) costs points.
    Pepper deals are measured against Tweakers' lowest NL price today, which is already a real low."""
    s = d["discount_pct"]
    if d["badge"]:
        s += 8
    if d["price"] and d["low_6m"]:
        above = d["price"] / d["low_6m"] - 1
        s -= max(0.0, above) * 50
    if d.get("suspect"):
        s /= 2
    return round(s, 1)


def load_catalog() -> list[dict]:
    path = ROOT / "catalog.json"
    if not path.exists():
        return []
    c = json.loads(path.read_text(encoding="utf-8"))
    return [{"cat": cat, "name": n, "spec": s, "price": p, "shops": sh, "id": i}
            for cat, rows in c["categories"].items() for n, s, p, sh, i in rows]


def collect() -> list[dict]:
    tw = Tweakers()
    min_id = cutoff_id(datetime.now(timezone.utc))
    found = []
    for cat, (slug, _) in CATEGORIES.items():
        n = 0
        for page in range(1, MAX_PAGES + 1):
            html = tw.get(f"https://tweakers.net/{slug}/deals/?page={page}")
            rows = parse_deals(html)
            for d in rows:
                if d["price"] and d["price"] >= MIN_PRICE and d["before"] and keep(cat, d, min_id):
                    found.append(d | {"cat": cat, "source": "tweakers"})
                    n += 1
            if f"page={page + 1}" not in html:
                break
        print(f"{cat}: {n} deals", flush=True)

    try:
        found += pepper.collect(tw, load_catalog())
    except Exception as e:  # one source failing shouldn't cost us the other
        print(f"Pepper failed: {e}", flush=True)

    # Same product from both sources: keep the cheaper offer.
    best = {}
    for d in found:
        d["score"] = score(d)
        if d["id"] not in best or d["price"] < best[d["id"]]["price"]:
            best[d["id"]] = d
    return sorted(best.values(), key=lambda d: -d["score"])[:KEEP]


def notify(deals: list[dict]):
    """Sends the #1 deal to ntfy once per day, and not if it's the same product as last time."""
    cfg = local_config()
    topic = cfg.get("ntfy_topic")
    if not topic or not cfg.get("notify_deals", True):
        print("Notify: no ntfy_topic in local.json (or notify_deals is false), skipping")
        return
    d = deals[0] if deals else None
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    if not d or state.get("date") == date.today().isoformat() or state.get("id") == d["id"]:
        print("Notify: already sent today or same deal as last time, skipping")
        return
    where = f" at {d['shop']}" if d.get("shop") else ""
    lines = [f"{eur(d['price'])}{where} ({d.get('before_label', 'was').lower()} {eur(d['before'])}, -{d['discount_pct']}%)"]
    if d["badge"]:
        lines.append(d["badge"].replace("Laagste prijs sinds", "Lowest price in").replace("maanden", "months"))
    lines.append(f"{d['cat']} · {d['spec']}")
    send_ntfy(cfg.get("ntfy_server", "https://ntfy.sh"), topic, f"🔥 Deal of the day: {d['name']}", "\n".join(lines),
              click_url=DASHBOARD, priority=3)
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps({"date": date.today().isoformat(), "id": d["id"]}), encoding="utf-8")
    print(f"Notify: sent {d['name']}")


def main():
    setup_log("deals")
    deals = collect()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                               "source": "Tweakers Pricewatch Deals", "deals": deals},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(deals)} deals)")
    for i, d in enumerate(deals[:10], 1):
        src = f"{d['source']}/{d['shop']}" if d.get("shop") else d["source"]
        print(f"{i:>2}. -{d['discount_pct']}% {d['cat']:<11} €{d['price']:>8.2f}  {d['name'][:55]}  [{src}] (score {d['score']})")
    if "--push" in sys.argv:
        push("data/deals.json", f"Deals of the day {datetime.now():%Y-%m-%d}")
    if "--notify" in sys.argv:
        notify(deals)


if __name__ == "__main__":
    main()
