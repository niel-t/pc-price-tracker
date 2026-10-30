"""Filter values ("facets") per category for the catalog browser, read from Tweakers' spec lines.

Modelled on Tweakers' own filters: a monitor gets screen size, resolution, refresh rate and panel; RAM gets
DDR generation, capacity, kit, speed; and so on. Values are display-ready strings so the dashboard can show
them as-is; buckets (e.g. "144–165 Hz") keep the lists short like Tweakers does.

    .venv\\Scripts\\python tools\\facets.py    # add/refresh facets in catalog.json without re-scraping
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tools.build_catalog import suitable  # noqa: E402

CATALOG = Path(__file__).resolve().parent.parent / "catalog.json"


def _num(s: str) -> float:
    """'31,5' / '1.000' (Dutch notation) -> float."""
    s = s.strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", s):  # thousands separator, e.g. 1.000W
        s = s.replace(".", "")
    return float(s.replace(",", "."))


def _bucket(value: float, buckets: list[tuple[float, str]], last: str) -> str:
    for upper, label in buckets:
        if value <= upper:
            return label
    return last


def _maker(name: str) -> str:
    """Brand = first word of the name, with a few names Tweakers writes in several ways."""
    first = name.split()[0]
    return {"WD_BLACK": "WD", "be": "be quiet!", "INNO3D": "Inno3D"}.get(first, first)


def _parts(spec: str) -> list[str]:
    return [p.strip() for p in re.split(r"\s*[••]\s*", spec) if p.strip()]


def gpu(name, spec):
    f = {"maker": _maker(name)}
    m = re.search(r"\b(RTX|RX)\s?(\d{4})\s?(Ti SUPER|Ti|SUPER|XTX|XT|GRE)?\b", name, re.I)
    if m:
        f["brand"] = "NVIDIA" if m.group(1).upper() == "RTX" else "AMD"
        f["gpu"] = " ".join(x for x in [m.group(1).upper(), m.group(2), (m.group(3) or "").upper().replace("TI", "Ti")] if x)
    if m := re.search(r"(\d+)\s?GB\s+(GDDR\w+)", spec):
        f["vram"], f["mem"] = f"{m.group(1)} GB", m.group(2).upper()
    return f


def cpu(name, spec):
    f = {"brand": "AMD" if re.search(r"\b(AMD|Ryzen)\b", name) else "Intel" if "Intel" in name or "Core" in name else _maker(name)}
    if m := re.search(r"(AM4|AM5|1700|1851)\s+socket", spec):
        f["socket"] = m.group(1) if m.group(1).startswith("AM") else f"LGA {m.group(1)}"
    if m := re.search(r"(\d+)\)?\s*core", spec):
        f["cores"] = f"{m.group(1)} cores"
    if m := re.search(r"\b(Ryzen [3579]|Core Ultra [3579]|Core i[3579])\b", name):
        f["family"] = m.group(1)
    f["pack"] = "Boxed" if re.search(r"\bBox(ed)?\b", name, re.I) else "Tray" if re.search(r"\bTray\b|\bMPK\b", name, re.I) else None
    return f


def motherboard(name, spec):
    p = _parts(spec)
    f = {"maker": _maker(name)}
    if m := re.search(r"Socket\s+(\S+)", spec):
        f["socket"] = m.group(1) if m.group(1).startswith("AM") else f"LGA {m.group(1)}"
    for x in p:
        if re.fullmatch(r"(E-ATX|ATX|Micro-ATX|Mini-ITX|XL-ATX|Mini-DTX|Thin Mini-ITX)", x, re.I):
            f["form"] = x
    if m := re.search(r"(?:AMD|Intel)\s+(\w+)\s+chipset", spec):
        f["chipset"] = m.group(1)
    f["wifi"] = "Yes" if re.search(r"wi-?fi", name, re.I) else "No"
    return f


def ram(name, spec):
    f = {"maker": _maker(name)}
    if m := re.search(r"(\d+)\s?GB\s+(DDR\d)", spec):
        total, kind = int(m.group(1)), m.group(2)
        f["type"], f["size"] = kind, f"{total} GB"
        if k := re.search(r"kit van (\d+)", spec):
            n = int(k.group(1))
            f["kit"] = f"{n} × {total // n} GB" if total % n == 0 else f"{n} modules"
    f["form"] = "Laptop (SO-DIMM)" if "SODIMM" in spec.upper() else "Desktop (DIMM)"
    if m := re.search(r"@\s*([\d.]+)\s*MT/s", spec):
        mts = _num(m.group(1))
        f["speed"] = _bucket(mts, [(2933, "≤ 2933 MT/s"), (3200, "3000–3200 MT/s"), (3999, "3600–3800 MT/s"), (5200, "4800–5200 MT/s"),
                                    (5600, "5600 MT/s"), (6000, "6000 MT/s"), (6400, "6200–6400 MT/s"), (7200, "6600–7200 MT/s")], "7600+ MT/s")
    return f


def storage(name, spec):
    f = {"maker": _maker(name)}
    sizes = re.findall(r"(\d+(?:[.,]\d+)?)\s?(TB|GB)\b", name, re.I)
    if sizes:
        v, unit = sizes[-1]
        gb = _num(v) * (1000 if unit.upper() == "TB" else 1)
        f["size"] = _bucket(gb, [(300, "≤ 256 GB"), (600, "500 GB"), (1100, "1 TB"), (2100, "2 TB"), (4100, "4 TB")], "8 TB+")
    if spec.startswith("M.2"):
        f["form"] = "M.2"
    elif spec.startswith('2,5"'):
        f["form"] = '2.5"'
    if m := re.search(r"PCI-e\s+(\d\.\d)", spec):
        f["iface"] = f"PCIe {m.group(1)}"
    elif "SATA" in spec:
        f["iface"] = "SATA"
    return f


def psu(name, spec):
    f = {"maker": _maker(name)}
    if m := re.match(r"([\d.]+)W", spec):
        w = _num(m.group(1))
        f["watt"] = _bucket(w, [(500, "≤ 500 W"), (650, "550–650 W"), (750, "700–750 W"), (850, "800–850 W"), (1000, "900–1000 W"), (1300, "1100–1300 W")], "1500 W+")
    if m := re.search(r"(Bronze|Silver|Gold|Platinum|Titanium|Diamond|White|Standard)", spec):
        f["eff"] = m.group(1).replace("White", "80 Plus (White)").replace("Standard", "80 Plus (White)")
    mod = spec.lower()
    f["modular"] = "Fully modular" if "volledig modulair" in mod else "Semi-modular" if "semi" in mod else "Non-modular" if "niet-modulair" in mod else None
    return f


CASE_TYPES = {"Tower", "Small form factor", "Mini PC", "HTPC", "Desk PC"}
COLORS = {"zwart": "Black", "wit": "White", "grijs": "Grey", "zilver": "Silver", "blauw": "Blue", "roze": "Pink", "groen": "Green", "rood": "Red", "bruin": "Brown"}


def case(name, spec):
    f = {"maker": _maker(name)}
    p = _parts(spec)
    if p and p[0] in CASE_TYPES:
        f["type"] = p[0]
    words = [w.lower().strip(",()") for w in name.split()]
    f["color"] = next((COLORS[w] for w in reversed(words) if w in COLORS), None)  # most names don't say
    return f


def cooler(name, spec):
    f = {"maker": _maker(name)}
    if m := re.search(r"(\d+)mm diameter", spec):
        f["fan"] = f"{m.group(1)} mm"
    return f


def monitor(name, spec):
    f = {"maker": _maker(name)}
    if m := re.match(r'([\d,]+)"', spec):
        inch = _num(m.group(1))
        f["size"] = _bucket(inch, [(23.4, 'Up to 23"'), (25.5, '24–25"'), (28.5, '27–28"'), (30.5, '29–30"'), (32.5, '31.5–32"'), (36, '34"'), (41, '38–40"')], '42" and up')
    if m := re.search(r"\d{3,4}x\d{3,4}\s*\(([^)]+)\)", spec):
        f["res"] = m.group(1)
    if m := re.search(r"@\s*(\d+)Hz", spec):
        hz = int(m.group(1))
        f["hz"] = _bucket(hz, [(75, "60–75 Hz"), (120, "100–120 Hz"), (165, "144–165 Hz"), (200, "170–200 Hz"), (280, "240–280 Hz")], "300 Hz+")
    panels = [("QD-OLED", "QD-OLED"), ("OLED", "OLED"), ("IPS", "IPS"), ("VA", "VA"), ("TN", "TN")]
    for part in _parts(spec):
        hit = next((label for key, label in panels if re.search(rf"\b{key}\b", part)), None)
        if hit:
            f["panel"] = hit
            break
    return f


PARSERS = {"GPU": gpu, "CPU": cpu, "Motherboard": motherboard, "RAM": ram, "Storage": storage, "PSU": psu,
           "Case": case, "Cooler": cooler, "Monitor": monitor}


def facets(cat: str, name: str, spec: str) -> dict:
    parser = PARSERS.get(cat)
    return {k: v for k, v in parser(name, spec or "").items() if v} if parser else {}


def enrich(catalog: dict) -> dict:
    """Adds facets as a 6th field to every row (replacing an older one) and drops what isn't a desktop part."""
    for cat, rows in catalog["categories"].items():
        catalog["categories"][cat] = [r[:5] + [facets(cat, r[0], r[1])] for r in rows if suitable(cat, r[0], r[1])]
    catalog["fields"] = ["name", "spec", "price", "shops", "tweakers_id", "facets"]
    return catalog


def main():
    c = enrich(json.loads(CATALOG.read_text(encoding="utf-8")))
    CATALOG.write_text(json.dumps(c, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    n = sum(len(v) for v in c["categories"].values())
    print(f"Wrote {CATALOG} ({CATALOG.stat().st_size // 1024} KB, {n} products with facets)")


if __name__ == "__main__":
    main()
