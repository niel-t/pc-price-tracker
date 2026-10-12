"""Collects today's best PC-part price drops from Tweakers Pricewatch Deals into data/deals.json.

Tweakers blocks GitHub's servers, so this runs on your own PC (e.g. daily via Windows Task Scheduler):

    .venv\\Scripts\\python tools\\deals.py           # just write data/deals.json
    .venv\\Scripts\\python tools\\deals.py --push    # and commit + push it so the dashboard shows it

Uses the same product rules as the suggestions catalog (GPU: RTX 3000+/RX 5000+; other parts:
released in the last 36 months; desktop CPUs only).
"""
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.build_catalog import CATEGORIES, Tweakers, cutoff_id, keep, tweakers_price  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "deals.json"
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
    a bonus; being well above the recent lowest price (an inflated 'before' price) costs points."""
    s = d["discount_pct"]
    if d["badge"]:
        s += 8
    if d["price"] and d["low_6m"]:
        above = d["price"] / d["low_6m"] - 1
        s -= max(0.0, above) * 50
    return round(s, 1)


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
                    found.append(d | {"cat": cat, "score": score(d)})
                    n += 1
            if f"page={page + 1}" not in html:
                break
        print(f"{cat}: {n} deals", flush=True)
    found.sort(key=lambda d: -d["score"])
    return found[:KEEP]


def push():
    def git(*args):
        subprocess.run(["git", *args], cwd=ROOT, check=True)
    git("pull", "--rebase", "--autostash", "-q", "origin", "main")
    if subprocess.run(["git", "diff", "--quiet", "--", "data/deals.json"], cwd=ROOT).returncode == 0 and \
       subprocess.run(["git", "ls-files", "--error-unmatch", "data/deals.json"], cwd=ROOT, capture_output=True).returncode == 0:
        print("No changes to push")
        return
    git("add", "data/deals.json")
    git("commit", "-q", "-m", f"Deals of the day {datetime.now():%Y-%m-%d}", "--", "data/deals.json")
    git("push", "-q", "origin", "main")
    print("Pushed data/deals.json")


def main():
    deals = collect()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                               "source": "Tweakers Pricewatch Deals", "deals": deals},
                              ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({len(deals)} deals)")
    for i, d in enumerate(deals[:10], 1):
        print(f"{i:>2}. -{d['discount_pct']}% {d['cat']:<11} €{d['price']:>8.2f}  {d['name'][:60]}  (score {d['score']})")
    if "--push" in sys.argv:
        push()


if __name__ == "__main__":
    main()
