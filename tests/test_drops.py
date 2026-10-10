from tracker.drops import detect_drops
from tracker.shop import Offer, _to_float, extract_price, shop_info


def test_to_float():
    assert _to_float("€ 26,95") == 26.95
    assert _to_float("1.234,56") == 1234.56
    assert _to_float("299.00") == 299.0
    assert _to_float(369) == 369.0


def test_extract_price_json_ld():
    html = '''<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"Product","name":"CPU","offers":{"@type":"Offer","price":"369.00","priceCurrency":"EUR"}}]}</script>'''
    assert extract_price(html) == (369.0, "json-ld")


def test_extract_price_microdata():
    assert extract_price('<span itemprop="price" content="345.61">€ 345,61</span>')[0] == 345.61


def test_shop_info_matches_subdomain():
    assert shop_info("https://nl.nbb.com/nl/p/x/a1")["name"] == "NBB.com"
    assert shop_info("https://www.megekko.nl/product/1")["github"] == "ok"
    assert shop_info("https://unknown-shop.nl/p")["name"] == "unknown-shop.nl"


def test_no_alert_on_first_check():
    assert detect_drops({"target_price": None}, [Offer("A", 100)], {}, None, 5) == []


def test_lowest_drop_over_threshold():
    reasons = detect_drops({"target_price": None}, [Offer("A", 90), Offer("B", 110)], {"A": 100, "B": 110}, 100, 5)
    assert any("Lowest price" in r for r in reasons)
    assert any("all-time low" in r for r in reasons)


def test_small_drop_ignored():
    assert detect_drops({"target_price": None}, [Offer("A", 98)], {"A": 100}, 100, 5) == []


def test_single_shop_drop_when_not_cheapest():
    reasons = detect_drops({"target_price": None}, [Offer("A", 100), Offer("B", 108), Offer("C", 200)],
                           {"A": 100, "B": 150, "C": 300}, 100, 5)
    assert reasons == ["B: €150,00 → €108,00 (-28%)"]  # C dropped too, but isn't competitive


def test_target_crossed_only_once():
    p = {"target_price": 95}
    assert any("target" in r for r in detect_drops(p, [Offer("A", 94)], {"A": 96}, 96, 50))
    assert detect_drops(p, [Offer("A", 93)], {"A": 94}, 94, 50) == []
