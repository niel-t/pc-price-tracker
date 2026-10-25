"""One-off test: which shops can be read from where this runs (e.g. GitHub's servers)?

Prints, per shop: HTTP status, page size, and whether a price could be read.
"""
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tracker.shop import USER_AGENT, extract_price  # noqa: E402

# AMD Ryzen 7 7800X3D product pages (from Tweakers' shop links), plus search pages for
# shops whose product link we couldn't get.
PAGES = {
    "Reichelt": "https://www.reichelt.com/nl/nl/shop/product/amd_am5_ryzen_7_7800x3d_8x_4_20_ghz_boxed_zonder_koeler-348524",
    "CAPS": "https://www.caps.nl/amd-ryzen-7-7800x3d-boxed-id-873668.html",
    "Informatique": "https://www.informatique.nl/229182/amd-ryzen-7-7800x3d-boxed.html",
    "Orion Computerworld": "https://www.orioncomputerworld.nl/detail.php?artikelid=133603",
    "HardwareWebwinkel": "https://www.hardwarewebwinkel.nl/componenten/processoren/amd-socket-am5/amd-ryzen-7-7800x3d-am5-tray-processor-raphael-100-100000910wof.html",
    "NBB.com": "https://nl.nbb.com/nl/p/amd-ryzen-7-7800x3d-processor-8c-16t-4-20-5-00-ghz-in-doos-zonder-koeler/a1013366",
    "RedShell": "https://www.redshell.nl/amd-ryzen-7-7800x3d-processor-42-ghz-96-mb-l3-doos",
    "Megekko": "https://www.megekko.nl/product/0/295018/AMD-Ryzen-7-7800X3D",
    "Paradigit": "https://www.paradigit.nl/AMD-Ryzen-7-7800X3D/21298766/product",
    "Yorcom": "https://www.yorcom.nl/artikel/amd-ryzen-7-7800x3d-processor/CPUA5R77800X3/",
    "Senetic": "https://www.senetic.nl/product/100-100000910",
    "Leventis": "https://www.leventis.nl/amd-am5-ryzen-7-7800x3d-wof-50ghz-8x-core-96mb-120.html",
    "Storage Island": "https://storageisland.nl/amd-am5-ryzen-7-7800x3d-box-wof-5-0ghz-8x-core-96mb-120w/",
    "Infotheek": "https://shop.infotheek.nl/nl/product/3306/66793P2/amd-ryzen-7-7800x3d-processor-4-2-ghz-96-mb-l3-doos/nieuw",
    "Alternate (search)": "https://www.alternate.nl/listing.xhtml?q=7800x3d",
    "Azerty (search)": "https://azerty.nl/catalogsearch/result/?q=7800x3d",
    "Proshop (search)": "https://www.proshop.nl/?s=7800x3d",
    "Coolblue (search)": "https://www.coolblue.nl/zoeken?query=7800x3d",
    "bol.com (search)": "https://www.bol.com/nl/nl/s/?searchtext=7800x3d",
    "Amazon.nl (search)": "https://www.amazon.nl/s?k=7800x3d",
    # Deal sources used by tools/deals.py (can the daily deals job run on GitHub?)
    "Tweakers deals (feed)": "https://tweakers.net/videokaarten/deals/",
    "Pepper RSS (feed)": "https://nl.pepper.com/rss/groep/computer-onderdelen",
}


def main():
    client = httpx.Client(headers={"User-Agent": USER_AGENT, "Accept-Language": "nl-NL,nl;q=0.9"},
                          follow_redirects=True, timeout=25)
    print(f"{'shop':22} {'status':>6} {'size':>8}  price")
    for shop, url in PAGES.items():
        try:
            r = client.get(url)
            price, how = extract_price(r.text) if r.status_code == 200 else (None, None)
            result = f"€{price:.2f} via {how}" if price else ("page loads" if ("search" in shop or "feed" in shop) and r.status_code == 200 else "-")
            print(f"{shop:22} {r.status_code:>6} {len(r.content):>8}  {result}", flush=True)
        except Exception as e:
            print(f"{shop:22} {'ERR':>6} {'':>8}  {type(e).__name__}: {e}", flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
