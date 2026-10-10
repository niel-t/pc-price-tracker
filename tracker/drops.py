"""Decides whether a new set of offers is worth an alert."""
from .scraper import Offer

MAX_SHOP_LINES = 5


def eur(v: float) -> str:
    return f"€{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def detect_drops(product: dict, offers: list[Offer], prev: dict[str, float], all_time_low: float | None,
                 threshold_pct: float) -> list[str]:
    """Returns human-readable reasons to alert; empty list means no alert.

    prev maps shop -> price from the previous check.
    """
    reasons = []
    new_low = min(o.price for o in offers)
    cheapest = min(offers, key=lambda o: o.price)
    factor = 1 - threshold_pct / 100

    if prev:
        prev_low = min(prev.values())
        if new_low <= prev_low * factor:
            pct = (prev_low - new_low) / prev_low * 100
            reasons.append(f"Lowest price {eur(prev_low)} → {eur(new_low)} (-{pct:.0f}%) at {cheapest.shop}")
        # Big drops at individual shops that are competitive (within 10% of the cheapest),
        # even when another shop is still cheaper.
        shop_drops = []
        for o in sorted(offers, key=lambda o: o.price):
            old = prev.get(o.shop)
            if old and o.price <= old * factor and o is not cheapest and o.price <= new_low * 1.10:
                pct = (old - o.price) / old * 100
                shop_drops.append(f"{o.shop}: {eur(old)} → {eur(o.price)} (-{pct:.0f}%)")
        reasons += shop_drops[:MAX_SHOP_LINES]
        if len(shop_drops) > MAX_SHOP_LINES:
            reasons.append(f"…and {len(shop_drops) - MAX_SHOP_LINES} more shops dropped")

    target = product.get("target_price")
    if target and new_low <= target:
        prev_low = min(prev.values()) if prev else None
        if prev_low is None or prev_low > target:
            reasons.append(f"Below your target {eur(target)}: {eur(new_low)} at {cheapest.shop}")

    if reasons and all_time_low is not None and new_low < all_time_low:
        reasons.append("New all-time low since tracking started")
    return reasons
