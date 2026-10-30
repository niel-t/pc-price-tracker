# PC Price Tracker

Tracks PC component prices at Dutch web shops and pushes a phone notification (ntfy) when prices drop.
Runs hourly on GitHub Actions, so your PC can be off.

**Dashboard:** https://niel-t.github.io/pc-price-tracker/

## Using it

The dashboard has five pages (sidebar on desktop, tab bar at the bottom on phones):

| Page | What's there |
|---|---|
| **Overview** | Build total and its trend, what needs your attention (targets hit, big drops, shops that can't be read), top 3 deals and latest alerts |
| **My build** | All your parts as a list with a total row (or as cards), filter by category, sort; click a part for its price history and every shop's price. **Browse parts** (`#/browse/<category>`) lets you find new parts with filters per category |
| **Deals** | Top 10 deals of the day, as a showcase with photos: PC parts, or all tech at −30% or more |
| **Alerts** | Every price alert, grouped by day, filterable per part |
| **Settings** | GitHub connection, phone alerts, alert sensitivity, light/dark theme, data sources |

Each page has its own address (e.g. `#/deals`, or `#/build/<part id>` for a part's details), so the browser's
back button works and you can bookmark a page.

Getting started:

1. **Settings** → *GitHub connection* (follow the 1-minute token steps shown there).
2. **Settings** → *Phone alerts*: install the ntfy app, enter your topic (same as the `NTFY_TOPIC` repo secret),
   scan the QR code and send a test.
3. **My build** → **＋ Add part**: category, name (pick from the suggestions), optional target price, and one
   product link per shop. The form has quick search buttons for shops that are known to work, and tags every
   link ✓ works / ✕ blocked / ? untested. Saving starts a check right away.

The dashboard is `index.html` with `assets/app.css` and `assets/app.js`; no build step. After changing the CSS or JS, bump the `?v=` date on both links in `index.html` so browsers don't mix old and new files.

## Browse parts (filters per category)

My build → **Browse parts** (or the link in the *Add part* form) shows the whole catalog for one category with
filters modelled on Tweakers', plus price range, search and sorting:

| Category | Filters |
|---|---|
| Monitor | screen size, resolution, refresh rate, panel, brand |
| RAM | DDR type, total capacity, modules (e.g. 2 × 16 GB), speed, desktop/laptop, brand |
| GPU | chip maker, GPU (e.g. RTX 5070 Ti), video memory, memory type, brand |
| CPU | brand, family, socket, cores, boxed/tray |
| Motherboard | socket, chipset, form factor, Wi-Fi, brand |
| Storage (SSD) | capacity, interface (PCIe 3/4/5, SATA), form factor, brand |
| PSU | wattage, efficiency (Bronze…Titanium), modularity, brand |
| Case / Cooler | type, colour / fan size, brand |

Each option shows how many products match given your other filters, like Tweakers. The values are read from
Tweakers' spec lines by `tools/facets.py` and stored in `catalog.json`; the catalog builder adds them
automatically, and `.venv\Scripts\python tools\facets.py` refreshes them without re-scraping.

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

### Tech deals (−30% or more)

A second list on the Deals page (`#/deals/tech`): everything on Tweakers Pricewatch (phones, laptops, TVs, audio,
networking, PC parts…) that is **at least 30% off** today, filterable by category and 30/40/50%+.
Only genuine lows (Tweakers' "lowest price in months", or within 2% of the 6-month low); no consumables,
accessories, household appliances, business/server gear, or anything under €40.

Like the catalog, deals are collected on your own PC (Tweakers blocks GitHub; Pepper's feeds would work there,
but the Tweakers deals and the Pepper price check can't):

```
.venv\Scripts\python tools\deals.py --push
```

## Scheduled jobs on your PC

Two Windows scheduled tasks (Task Scheduler → *PC Price Tracker - …*) keep the Tweakers-based data fresh.
Both run without a window, catch up as soon as the PC is on if it was off at the scheduled time,
and log to `logs/` (not committed).

| Task | When | Runs |
|---|---|---|
| Deals of the day | daily 08:00, and 3 min after you log in (skipped if the deals are < 12 h old) | `tools\deals.py --if-older 12 --push --notify --log` |
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
