"""Generic price reader for shop product pages.

Most shops embed schema.org Product data (JSON-LD or microdata) or Open Graph price tags
for search engines, so one parser covers many shops without per-shop code.
"""
import json
import re

from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)


def _to_float(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("€", "").replace(" ", "")
    if re.fullmatch(r"\d{1,3}(\.\d{3})*,\d{1,2}|\d+,\d{1,2}", s):  # Dutch notation 1.234,56
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _walk(node):
    if isinstance(node, list):
        for x in node:
            yield from _walk(x)
    elif isinstance(node, dict):
        yield node
        for k in ("@graph", "offers", "mainEntity", "itemListElement"):
            if k in node:
                yield from _walk(node[k])


def extract_price(html: str) -> tuple[float | None, str | None]:
    """Returns (price, method) or (None, None)."""
    soup = BeautifulSoup(html, "html.parser")
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        for node in _walk(data):
            t = node.get("@type")
            types = t if isinstance(t, list) else [t]
            if any(x in ("Offer", "AggregateOffer") for x in types):
                price = _to_float(node.get("price") or node.get("lowPrice"))
                if price:
                    return price, "json-ld"
    for sel, attr in [('[itemprop="price"]', "content"), ('meta[property="product:price:amount"]', "content"),
                      ('meta[property="og:price:amount"]', "content")]:
        el = soup.select_one(sel)
        if el:
            price = _to_float(el.get(attr) or el.get_text())
            if price:
                return price, sel
    return None, None
