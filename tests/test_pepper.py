from datetime import datetime, timezone

from tools.pepper import match_catalog, parse_feed, tweakers_lowest

CATALOG = [
    {"name": "XFX Mercury AMD Radeon RX 9070 XT White 16GB", "shops": 9, "id": 1},
    {"name": "XFX Mercury AMD Radeon RX 9070 White 16GB", "shops": 7, "id": 2},
    {"name": "AMD Ryzen 7 9800X3D Boxed", "shops": 29, "id": 3},
    {"name": "AMD Ryzen 7 9800X3D Tray", "shops": 15, "id": 4},
    {"name": "MSI GeForce RTX 5070 Ti 16G VENTUS 3X OC", "shops": 20, "id": 5},
    {"name": "MSI GeForce RTX 5070 12G VENTUS 2X OC", "shops": 25, "id": 6},
    {"name": "Gigabyte MO27Q28GR", "shops": 6, "id": 7},
    {"name": "Corsair RM750e (2025)", "shops": 18, "id": 8},
    {"name": "Montech King 15 PRO ARGB Wit", "shops": 8, "id": 9},
    {"name": "Montech King 15 ARGB Wit", "shops": 6, "id": 10},
]


def m(title):
    p = match_catalog(title, CATALOG)
    return p and p["id"]


def test_matches_real_pepper_titles():
    assert m("XFX Mercury White RX 9070 XT 16gb voor maar €810 bij Amazon NL") == 1
    assert m("AMD Ryzen 7 9800X3D 4,7/5,2 GHz") == 3  # boxed: most shops
    assert m("Gigabyte MO27Q28GR 27\" QHD 280Hz 0.03ms Tandem W-OLED Gaming Monitor") == 7


def test_years_and_products_without_model_numbers():
    assert m("Corsair rm750e voeding") == 8
    assert m("Montech King 15 PRO ARGB Wit") == 9
    assert m("Montech King 15 ARGB Wit @ Azerty") == 10
    assert m("Montech King 15 Wit") is None  # not every word of a model-less name


def test_variants_must_agree():
    assert m("MSI GeForce RTX 5070 Ti Ventus 3X OC 16GB @ Megekko") == 5
    assert m("MSI GeForce RTX 5070 Ventus 2X OC 12GB") == 6
    assert m("XFX Mercury White RX 9070 16gb") == 2


def test_no_match_for_unrelated_or_unknown():
    assert m("Mammut Mercury Iv Mid GTX en vibram maat 44") is None
    assert m("AMD Ryzen 7 5700X – €127,- @Aliexpress") is None  # not in catalog (too old)
    assert m("Samsung SSD T7 2TB") is None


FEED = '''<?xml version="1.0" encoding="UTF-8"?><rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:pepper="http://www.pepper.com/rss" version="2.0"><channel>
<item><pepper:merchant name="Megekko" price="€1.469"/><media:content medium="image" url="https://static.pepper.com/x.jpg"/>
<title><![CDATA[187° - Gigabyte MO27Q28GR voor €469]]></title><link>https://nl.pepper.com/aanbiedingen/x-1</link>
<pubDate>Sat, 10 Oct 2026 12:00:00 +0200</pubDate></item>
<item><pepper:merchant name="Bol" price="€79"/><title><![CDATA[Old deal]]></title><link>https://nl.pepper.com/aanbiedingen/x-2</link>
<pubDate>Sat, 01 Aug 2026 12:00:00 +0200</pubDate></item></channel></rss>'''


def test_parse_feed_strips_temperature_and_skips_old_items():
    [d] = parse_feed(FEED, datetime(2026, 10, 12, tzinfo=timezone.utc))
    assert d["title"] == "Gigabyte MO27Q28GR voor €469"
    assert (d["shop"], d["price"], d["image"]) == ("Megekko", 1469.0, "https://static.pepper.com/x.jpg")


def test_tweakers_lowest():
    html = '''<ul><li class="price-listing-item"><span class="shop-price"><a>€ 499,-</a></span></li>
              <li class="price-listing-item"><span class="shop-price"><a>€ 479,95</a></span></li></ul>'''
    assert tweakers_lowest(html) == 479.95
