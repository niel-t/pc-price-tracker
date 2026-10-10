# PC Price Tracker

Tracks PC component prices across Dutch shops via [Tweakers Pricewatch](https://tweakers.net/pricewatch/)
and pushes a phone notification (ntfy) when prices drop. Runs hourly on GitHub Actions, so your PC can be off.

- **Dashboard:** the GitHub Pages site of this repo (`https://<you>.github.io/pc-price-tracker/`)
- **Price data:** `data/latest.json` (current offers), `data/history.json` (lowest-price changes), `data/alerts.json`

## Adding or changing parts

Edit [`products.json`](products.json) (the dashboard's *Edit parts* button opens it on GitHub):

```json
{ "name": "AMD Ryzen 7 7800X3D Boxed",
  "url": "https://tweakers.net/pricewatch/1899396/amd-ryzen-7-7800x3d-boxed.html",
  "category": "CPU",
  "target_price": 320 }
```

Find the URL by searching on tweakers.net/pricewatch. `target_price` can be `null`.
Categories: CPU, GPU, Motherboard, RAM, Storage, PSU, Case, Cooler, Monitor, Other.
Saving the file triggers a check right away.

## Alerts

Install the **ntfy** app and subscribe to a hard-to-guess topic. The topic is stored as the repository
secret `NTFY_TOPIC` (Settings → Secrets and variables → Actions), so it isn't visible in the public repo.

On each check it compares against the previous check and alerts when:

- the lowest price dropped by at least `drop_threshold_pct` (default 5%),
- a competitive shop (within 10% of the cheapest) dropped by at least that much,
- the lowest price crossed below your `target_price`.

## Running locally

```
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt pytest
.venv\Scripts\python -m pytest -q tests
.venv\Scripts\python check.py
```
