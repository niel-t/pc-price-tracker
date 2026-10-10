from tracker.drops import detect_drops
from tracker.scraper import Offer, parse_euro


def test_parse_euro():
    assert parse_euro("€ 26,95") == 26.95
    assert parse_euro("€ 1.234,56") == 1234.56
    assert parse_euro("€ 299,-") == 299.0


def test_no_alert_on_first_check():
    assert detect_drops({"target_price": None}, [Offer("A", 100, None)], {}, None, 5) == []


def test_lowest_drop_over_threshold():
    reasons = detect_drops({"target_price": None}, [Offer("A", 90, None), Offer("B", 110, None)],
                           {"A": 100, "B": 110}, 100, 5)
    assert any("Lowest price" in r for r in reasons)
    assert any("all-time low" in r for r in reasons)


def test_small_drop_ignored():
    assert detect_drops({"target_price": None}, [Offer("A", 98, None)], {"A": 100}, 100, 5) == []


def test_single_shop_drop_when_not_cheapest():
    reasons = detect_drops({"target_price": None},
                           [Offer("A", 100, None), Offer("B", 108, None), Offer("C", 200, None)],
                           {"A": 100, "B": 150, "C": 300}, 100, 5)
    assert reasons == ["B: €150,00 → €108,00 (-28%)"]  # C dropped too, but isn't competitive


def test_target_crossed_only_once():
    p = {"target_price": 95}
    assert any("target" in r for r in detect_drops(p, [Offer("A", 94, None)], {"A": 96}, 96, 50))
    assert detect_drops(p, [Offer("A", 93, None)], {"A": 94}, 94, 50) == []
