"""Builds catalog.json: the product suggestions for the dashboard's "Add part" form.

Reads Tweakers Pricewatch category listings (only products currently sold in NL).
Tweakers blocks GitHub's servers, so run this on your own PC now and then, then commit catalog.json:

    .venv\\Scripts\\python tools\\build_catalog.py

Which products are included:
- GPU: NVIDIA GeForce RTX 3000 series and newer, AMD Radeon RX 5000 series and newer (any age).
- Everything else: released in the last 36 months. Tweakers product IDs increase over time, so
  "ID >= the ID of a product released 36 months ago" is used as the release-date test.
- CPU: desktop sockets only (no server/workstation chips).
"""
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote

import httpx
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tracker.shop import USER_AGENT, _to_float  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "catalog.json"

# Tweakers ID of a product launched ~36 months before today. Anchor: Intel Core i9-14900K
# (ID 1993248, released 2023-10-17). Tweakers adds ~200k IDs per year; move this forward
# by ~17k per month to keep the window at 36 months.
ANCHOR_ID, ANCHOR_DATE = 1_990_000, datetime(2023, 10, 10, tzinfo=timezone.utc)
IDS_PER_MONTH = 17_000

GPU_RE = re.compile(r"\b(?:RTX\s?(?:30|40|50)[5-9]0|RX\s?(?:5|6|7|9)\d{3})\b", re.I)
GPU_EXCLUDE = re.compile(r"\b(?:Ada|Quadro|Radeon Pro|RTX A\d|Blackwell)\b", re.I)
CPU_SOCKETS = re.compile(r"\b(?:AM4|AM5|1700|1851) socket", re.I)
# Server/OEM parts don't belong in a PC build. (Not applied to monitors: Dell and Lenovo make consumer monitors.)
SERVER_PARTS = re.compile(r"\b(?:HPE|Dell|Lenovo|Fujitsu|Supermicro|ASRock Rack|ThinkSystem|Enterprise|RDIMM|LRDIMM|Registered|ECC|SAS|U\.[23]|E[13]\.[SL])\b", re.I)
# Consumer SSDs list their interface (M.2 / SATA / PCIe).
SSD_CONSUMER = re.compile(r"M\.2|SATA|PCI-?e", re.I)

CATEGORIES = {
    # dashboard category: (tweakers listing slug, filter mode)
    "GPU": ("videokaarten", "series"),
    "CPU": ("processors", "recent"),
    "Motherboard": ("moederborden", "recent"),
    "RAM": ("geheugen-intern", "recent"),
    "Storage": ("interne-ssds", "recent"),
    "PSU": ("voedingen", "recent"),
    "Case": ("behuizingen", "recent"),
    "Cooler": ("processorkoeling", "recent"),
    "Monitor": ("monitoren", "recent"),
}
DELAY = 5  # seconds between requests; Tweakers rate-limits fast clients


def cutoff_id(now: datetime) -> int:
    months = (now.year - ANCHOR_DATE.year) * 12 + now.month - ANCHOR_DATE.month - 36
    return ANCHOR_ID + max(0, months) * IDS_PER_MONTH


class Tweakers:
    def __init__(self):
        self.c = httpx.Client(headers={"User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9"},
                              follow_redirects=True, timeout=30)
        self.last = 0.0

    def get(self, url: str) -> str:
        for attempt in range(4):
            wait = self.last + DELAY - time.time()
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            r = self.c.get(url)
            if "privacygate-confirm" in r.text and "editionName" not in r.text:
                m = re.search(r"decodeURIComponent\('([^']+)'\)", r.text)
                r = self.c.get(unquote(m.group(1)))
            if r.status_code == 429:
                print(f"    rate limited, waiting {60 * (attempt + 1)}s…", flush=True)
                time.sleep(60 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.text
        raise RuntimeError(f"Still rate limited: {url}")


def tweakers_price(text: str) -> float | None:
    """Tweakers shows Dutch notation: '€ 889,-', '€ 1.234,56', '€ 15.949' (dots are thousands separators)."""
    s = re.sub(r"[^\d.,]", "", text.replace(",-", ""))
    return _to_float(s.replace(".", "")) if s else None


def parse_listing(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    items = []
    for li in soup.select("li"):
        a = li.select_one("a.editionName")
        if not a:
            continue
        m = re.search(r"pricewatch/(\d+)/", a["href"])
        spec = li.select_one("p.specline")
        price = li.select_one(".item-price .amount")
        shops = re.search(r"bij (\d+) winkel", li.select_one(".item-price").get_text(" ") if li.select_one(".item-price") else "")
        items.append({
            "id": int(m.group(1)),
            "name": a.get("title") or a.get_text(strip=True),
            "spec": spec.get_text(" ", strip=True) if spec else "",
            "price": tweakers_price(price.get_text()) if price else None,
            "shops": int(shops.group(1)) if shops else 0,
        })
    return items


def keep(cat: str, item: dict, min_id: int) -> bool:
    if cat == "GPU":
        return bool(GPU_RE.search(item["name"])) and not GPU_EXCLUDE.search(item["name"])
    if item["id"] < min_id:
        return False
    if cat == "CPU":
        return bool(CPU_SOCKETS.search(item["spec"]))
    if cat in ("Storage", "RAM", "Motherboard") and SERVER_PARTS.search(f"{item['name']} {item['spec']}"):
        return False
    if cat == "Storage":
        return bool(SSD_CONSUMER.search(item["spec"]))
    return True


def main():
    now = datetime.now(timezone.utc)
    min_id = cutoff_id(now)
    tw = Tweakers()
    catalog = {}
    only = set(sys.argv[1:])  # optionally limit to some categories, e.g. "GPU CPU"
    if only and OUT.exists():
        catalog = json.loads(OUT.read_text(encoding="utf-8"))["categories"]

    for cat, (slug, mode) in CATEGORIES.items():
        if only and cat not in only:
            continue
        # "recent" categories: newest first, stop once a whole page is older than the cutoff.
        order = "" if mode == "series" else "&orderField=time&orderSort=desc"
        kept, page = [], 1
        print(f"{cat}: ", end="", flush=True)
        while True:
            items = parse_listing(tw.get(f"https://tweakers.net/{slug}/vergelijken/?page={page}{order}"))
            print(".", end="", flush=True)
            kept += [i for i in items if keep(cat, i, min_id)]
            if len(items) < 40 or (mode == "recent" and all(i["id"] < min_id for i in items)) or page >= 60:
                break
            page += 1
        # Most-offered first: the number of shops is a good popularity signal.
        kept.sort(key=lambda i: (-i["shops"], i["name"]))
        catalog[cat] = [[i["name"], i["spec"], i["price"], i["shops"], i["id"]] for i in kept]
        print(f" {len(kept)} products ({page} pages)", flush=True)

    OUT.write_text(json.dumps({
        "generated": now.isoformat(timespec="seconds"),
        "source": "Tweakers Pricewatch",
        "rules": {"GPU": "RTX 3000+ / RX 5000+", "other": "released in the last 36 months", "min_tweakers_id": min_id},
        "fields": ["name", "spec", "price", "shops", "tweakers_id"],
        "categories": catalog,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB, {sum(len(v) for v in catalog.values())} products)")


if __name__ == "__main__":
    main()
