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

## Deals of the day

The dashboard shows a top 10 of today's biggest *genuine* price drops on PC parts, with the same product rules
as the suggestions (RTX 3000+/RX 5000+, otherwise max. 36 months old, no server parts). Two sources:

- **[Tweakers Pricewatch Deals](https://tweakers.net/pricewatch/deals/)**: price drops across all Dutch shops.
- **[Pepper.com](https://nl.pepper.com/groep/computer-onderdelen)** RSS feeds (PC parts, graphics cards, monitors, SSDs):
  community-posted deals from Dutch retailers (Megekko, Azerty, Coolblue, NBB, Proshop, Amazon.nl, bol, …).
  A Pepper deal is only kept if it matches a catalog product **and is cheaper than Tweakers' lowest price
  today** across all Dutch shops (checked live). Non-Dutch marketplaces (AliExpress etc.) are skipped. Deals
  from the last 10 days are considered, so check that an older one is still running.

Ranking = discount %, **+8** if it's the lowest price in months (Tweakers) or beats every Dutch shop (Pepper),
**minus** points when Tweakers saw it cheaper recently (an inflated "before" price). Pepper deals more than 35%
below every shop are usually pricing errors that are already fixed: they're flagged "Too good to be true?" and
their score is halved. The *All* view has at most 3 deals per category. Click **＋ Track** to start tracking a
deal with its price as your target.

Like the catalog, deals are collected on your own PC (Tweakers blocks GitHub):

```
.venv\Scripts\python tools\deals.py --push
```

## Scheduled jobs on your PC

Two Windows scheduled tasks (Task Scheduler → *PC Price Tracker - …*) keep the Tweakers-based data fresh.
Both run without a window, catch up as soon as the PC is on if it was off at the scheduled time,
and log to `logs/` (not committed).

| Task | When | Runs |
|---|---|---|
| Deals of the day | daily 08:00 | `tools\deals.py --push --notify --log` |
| Refresh catalog | every 4 weeks, Sunday 10:00 | `tools\build_catalog.py --push --log` |

The daily deal notification uses `local.json` (not committed):

```json
{ "ntfy_server": "https://ntfy.sh", "ntfy_topic": "your-topic", "notify_deals": true }
```

Set `notify_deals` to `false` to stop the daily ping. It's sent at most once a day, and not when the #1 deal
is the same product as last time.

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
| `data/deals.json` | deals of the day (from `tools/deals.py`) |
| `catalog.json` | part suggestions (from `tools/build_catalog.py`) |
| `check.py` | the hourly check |

## Running locally

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt pytest
.venv\Scripts\python -m pytest -q tests
.venv\Scripts\python check.py
```
