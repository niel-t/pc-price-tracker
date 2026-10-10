"""Fetches shop prices for a product from Tweakers Pricewatch."""
import html
import re
from dataclasses import dataclass
from urllib.parse import quote_plus, unquote

import httpx
from bs4 import BeautifulSoup

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
GATE_CALLBACK = re.compile(r"decodeURIComponent\('([^']+)'\)")
PRODUCT_URL = re.compile(r"https?://tweakers\.net/pricewatch/(\d+)/")


@dataclass
class Offer:
    shop: str
    price: float
    total: float | None  # price incl. shipping/payment costs, when Tweakers lists it


@dataclass
class ProductPage:
    name: str
    url: str
    offers: list[Offer]


def parse_euro(text: str) -> float | None:
    """'€ 1.234,56' / '€ 299,-' -> float."""
    m = re.search(r"([\d.]+),(\d{2}|-)", text)
    if not m:
        return None
    whole = m.group(1).replace(".", "")
    cents = "00" if m.group(2) == "-" else m.group(2)
    return float(f"{whole}.{cents}")


def normalize_url(url: str) -> str:
    m = PRODUCT_URL.match(url.strip())
    if not m:
        raise ValueError("Not a Tweakers Pricewatch product URL (expected https://tweakers.net/pricewatch/<id>/...)")
    return url.strip()


class TweakersClient:
    def __init__(self):
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9"},
            follow_redirects=True,
            timeout=30,
        )

    def _get(self, url: str) -> str:
        r = self.client.get(url)
        r.raise_for_status()
        # DPG Media privacy gate: confirming the callback sets the cookies and redirects to the page.
        if "privacygate-confirm" in r.text and "price-listing" not in r.text:
            m = GATE_CALLBACK.search(r.text)
            if not m:
                raise RuntimeError("Hit Tweakers privacy gate but could not find callback URL")
            r = self.client.get(unquote(m.group(1)))
            r.raise_for_status()
        return r.text

    def fetch(self, url: str) -> ProductPage:
        soup = BeautifulSoup(self._get(url), "html.parser")
        h1 = soup.select_one("h1 a") or soup.select_one("h1")
        name = h1.get_text(strip=True) if h1 else url

        offers = []
        for li in soup.select("li.price-listing-item"):
            shop_el = li.select_one(".shop-name a") or li.select_one(".shop-name")
            price_el = li.select_one(".shop-price")
            if not shop_el or not price_el:
                continue
            price = parse_euro(price_el.get_text())
            if price is None:
                continue
            total = None
            delivery = li.select_one("twk-delivery-info")
            if delivery and delivery.get("data-tooltip-html"):
                tip = html.unescape(delivery["data-tooltip-html"])
                m = re.search(r"Totaal.*?<dd>([^<]+)</dd>", tip, re.S)
                if m:
                    total = parse_euro(m.group(1))
            offers.append(Offer(shop=shop_el.get_text(strip=True), price=price, total=total))
        return ProductPage(name=name, url=url, offers=offers)

    def search(self, keyword: str) -> list[dict]:
        soup = BeautifulSoup(
            self._get(f"https://tweakers.net/pricewatch/zoeken/?keyword={quote_plus(keyword)}"), "html.parser"
        )
        results = []
        for td in soup.select("td.itemname[data-product-edition-id]"):
            a = td.select_one("a.editionName")
            if not a:
                continue
            row = td.find_parent("tr")
            price_el = row.select_one("p.price") if row else None
            spec_el = td.select_one("p.specline")
            img = row.select_one("td.pwimage img") if row else None
            results.append({
                "name": a.get("title") or a.get_text(strip=True),
                "url": a["href"],
                "spec": spec_el.get_text(strip=True) if spec_el else "",
                "price": parse_euro(price_el.get_text()) if price_el else None,
                "image": img["src"] if img else None,
            })
        return results

    def close(self):
        self.client.close()
