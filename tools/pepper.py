"""Deals posted on Pepper.com (Dutch deals community) for PC parts, from Pepper's official RSS feeds.

A Pepper deal is kept only when it
  1. is from a Dutch retailer (no AliExpress & co),
  2. matches a product in catalog.json (so the same rules apply: RTX 3000+/RX 5000+, max. 36 months
     old, no server parts) — this also tells us the category, and
  3. is cheaper than Tweakers' lowest price today across all Dutch shops (checked live).
"""
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

from bs4 import BeautifulSoup

from tools.build_catalog import tweakers_price

GROUPS = ["computer-onderdelen", "grafische-kaart", "monitor", "ssd"]
NS = {"pepper": "http://www.pepper.com/rss", "media": "http://search.yahoo.com/mrss/"}
NOT_DUTCH = re.compile(r"aliexpress|joybuy|temu|banggood|geekbuying|shein|wish", re.I)
SUSPECT_PCT = 35  # % below Tweakers' lowest price
MAX_AGE = timedelta(days=10)  # PC-part deals are posted a few times a week and often run for days
# Variant words that change the product (an RTX 5070 is not an RTX 5070 Ti).
VARIANTS = {"ti", "super", "xt", "xtx", "gre", "pro", "plus", "max", "mini", "lite"}


def tokens(s: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", s.lower().replace("-", ""))


def is_model(t: str) -> bool:
    """Model numbers: '9070', '9800x3d', '27gr83q', 'sn850x' — tokens with ≥3 digits or letters+digits.
    Years ('2025' in 'Corsair RM750e (2025)') are not model numbers: deal titles usually leave them out."""
    if re.fullmatch(r"20[1-3]\d", t):
        return False
    return (sum(c.isdigit() for c in t) >= 3) or (any(c.isdigit() for c in t) and any(c.isalpha() for c in t) and len(t) >= 4)


def match_catalog(title: str, catalog: list[dict]) -> dict | None:
    """Best catalog product for a deal title, or None when nothing matches confidently.

    All model numbers of the product must appear in the title (or, for products without one, like
    many cases, every word of the name), its brand must appear, and variant words (Ti, Super, XT, …)
    must agree, so near-misses are rejected rather than guessed.
    """
    tt = set(tokens(title))
    title_variants = tt & VARIANTS
    best, best_key = None, None
    for p in catalog:
        pt = tokens(p["name"])
        if not pt or pt[0] not in tt or (set(pt) & VARIANTS) != title_variants:
            continue
        models = [t for t in pt if is_model(t)]
        overlap = sum(t in tt for t in pt) / len(pt)
        if models:
            if not all(m in tt for m in models) or overlap < 0.5:
                continue
        elif overlap < 1 or len(pt) < 3:
            continue
        key = (overlap, p["shops"])
        if best_key is None or key > best_key:
            best, best_key = p, key
    return best


def parse_feed(xml_text: str, now: datetime) -> list[dict]:
    items = []
    for it in ET.fromstring(xml_text).iter("item"):
        merchant = it.find("pepper:merchant", NS)
        if merchant is None or not merchant.get("price"):
            continue
        posted = parsedate_to_datetime(it.findtext("pubDate"))
        if now - posted > MAX_AGE:
            continue
        title = re.sub(r"^-?\d+°\s*-\s*", "", it.findtext("title", "")).strip()
        image = it.find("media:content", NS)
        items.append({
            "title": title,
            "shop": merchant.get("name"),
            "price": tweakers_price(merchant.get("price")),
            "url": it.findtext("link"),
            "image": image.get("url") if image is not None else None,
            "posted": posted.astimezone(timezone.utc).isoformat(timespec="seconds"),
        })
    return items


def tweakers_lowest(html: str) -> float | None:
    """Lowest shop price on a Tweakers Pricewatch product page."""
    soup = BeautifulSoup(html, "html.parser")
    prices = [tweakers_price(el.get_text()) for el in soup.select("li.price-listing-item .shop-price")]
    prices = [p for p in prices if p]
    return min(prices) if prices else None


def collect(tw, catalog: list[dict]) -> list[dict]:
    """tw: a build_catalog.Tweakers client (used for the feeds too, so all requests are paced)."""
    now = datetime.now(timezone.utc)
    seen, found = set(), []
    for group in GROUPS:
        for d in parse_feed(tw.get(f"https://nl.pepper.com/rss/groep/{group}"), now):
            if d["url"] in seen or not d["price"] or not d["shop"] or NOT_DUTCH.search(d["shop"]):
                continue
            seen.add(d["url"])
            p = match_catalog(d["title"], catalog)
            if not p:
                continue
            low = tweakers_lowest(tw.get(f"https://tweakers.net/pricewatch/{p['id']}/"))
            if not low or d["price"] >= low:
                continue
            pct = round((low - d["price"]) / low * 100)
            # Far below every Dutch shop is usually a pricing error that's already been fixed.
            suspect = pct > SUSPECT_PCT
            found.append({
                "source": "pepper", "id": p["id"], "name": p["name"], "spec": p["spec"], "cat": p["cat"],
                "shop": d["shop"], "url": d["url"], "image": d["image"], "posted": d["posted"],
                "price": d["price"], "before": low, "before_label": "Tweakers lowest",
                "discount_pct": pct, "low_6m": None, "badge": "Cheaper than all NL shops on Tweakers",
                "pepper_title": d["title"], "suspect": suspect,
            })
        print(f"Pepper {group}: {len(found)} deals so far", flush=True)
    return found
