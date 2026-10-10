# PC Price Tracker

Tracks PC component prices at Dutch web shops and pushes a phone notification (ntfy) when prices drop.
Runs hourly on GitHub Actions, so your PC can be off.

**Dashboard:** https://niel-t.github.io/pc-price-tracker/

## Using it

1. Open the dashboard → **⚙ Settings** → *Connect to GitHub* (follow the 1-minute token steps shown there).
2. In Settings → *Phone alerts*: install the ntfy app, enter your topic (same as the `NTFY_TOPIC` repo secret),
   scan the QR code and send a test.
3. **＋ Add part**: name, category, optional target price, and one product link per shop.
   The form has quick search buttons for shops that are known to work, and tags every link
   ✓ works / ✕ blocked / ? untested. Saving starts a check right away.

Click any part for its price history, the price at every shop, and which shops failed.

## Part suggestions

When you type a name in *Add part* (e.g. "ASUS ROG" with category GPU), the dashboard suggests real
products with today's Tweakers price and shop count. Picking one fills in the exact name and category
and offers a target 5% below today's price.

Suggestions come from [`catalog.json`](catalog.json), built from Tweakers' listings of products currently sold in NL:

- **GPU:** GeForce RTX 3000 series and newer, Radeon RX 5000 series and newer (no workstation cards).
- **CPU, motherboard, RAM, SSD, PSU, case, cooler, monitor:** released in the last 36 months (desktop CPUs only).

Tweakers blocks GitHub, so refresh the catalog from your own PC every month or so (takes ~10 minutes):

```
.venv\Scripts\python tools\build_catalog.py        # all categories
.venv\Scripts\python tools\build_catalog.py GPU     # or just some
git add catalog.json && git commit -m "Refresh catalog" && git push
```

You can always type any name yourself; suggestions are just a shortcut.

## Which shops work?

Shops are read from GitHub's servers, and some shops block those. Known status lives in
[`shops.json`](shops.json) (from `tools/shop_probe.py`, run via the *Shop probe* workflow):

- **Works:** Megekko, CAPS, NBB.com, Reichelt, Paradigit, Yorcom, Orion Computerworld, Leventis (excl. VAT, corrected automatically)
- **Blocked:** Azerty, Proshop, Informatique, HardwareWebwinkel, RedShell, bol.com, Storage Island
- **Untested:** Alternate, Coolblue, Amazon.nl, any shop not listed — the first check will tell; failing shops show a ⚠ on the dashboard.

## When does it alert?

On each check it compares against the previous check and alerts when:

- the lowest price dropped by at least the threshold (default 5%, adjustable in Settings),
- a competitive shop (within 10% of the cheapest) dropped by at least that much,
- the lowest price crossed below your target price.

## Files

| File | What |
|---|---|
| `products.json` | your parts, target prices and shop links (edited by the dashboard) |
| `shops.json` | known shops and whether they work from GitHub |
| `data/latest.json` | latest price per shop, per part |
| `data/history.json` | per-shop price changes over time |
| `data/alerts.json` | recent alerts |
| `check.py` | the hourly check |

## Running locally

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt pytest
.venv\Scripts\python -m pytest -q tests
.venv\Scripts\python check.py
```
