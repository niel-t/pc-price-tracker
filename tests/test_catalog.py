from datetime import datetime, timezone

from tools.build_catalog import cutoff_id, keep, parse_listing, tweakers_price


def test_tweakers_price():
    assert tweakers_price("€\xa0889,-") == 889.0
    assert tweakers_price(" € 1.234,56 ") == 1234.56
    assert tweakers_price("€ 15.949") == 15949.0
    assert tweakers_price("€ 99,86") == 99.86


def gpu(name):
    return keep("GPU", {"name": name, "spec": "", "id": 1}, 10**9)


def test_gpu_series_rules():
    assert gpu("ASUS ROG Strix GeForce RTX 4070 SUPER OC Edition")
    assert gpu("MSI GeForce RTX 3060 Ventus 2X 12G OC")
    assert gpu("Gigabyte GeForce RTX 5090 AORUS MASTER")
    assert gpu("Sapphire Pulse Radeon RX 9070 XT")
    assert gpu("PowerColor Red Devil Radeon RX 7900 XTX")
    assert gpu("Sapphire Pulse Radeon RX 5700 XT")
    assert not gpu("MSI GeForce RTX 2080 Ti Gaming X Trio")    # RTX 2000 series
    assert not gpu("Sapphire Nitro+ Radeon RX 580 8GB")          # RX 500 series (3 digits)
    assert not gpu("PNY NVIDIA RTX 4000 Ada Generation")         # workstation
    assert not gpu("AMD Radeon Pro W7800")
    assert not gpu("Intel Arc B580 Limited Edition")


def test_recent_and_desktop_cpu_rules():
    old = {"name": "AMD Ryzen 7 7800X3D Boxed", "spec": "AM5 socket • Octa (8) core", "id": 1899396}
    new = {"name": "AMD Ryzen 7 9800X3D Boxed", "spec": "AM5 socket • Octa (8) core", "id": 2100000}
    server = {"name": "Intel Xeon 6511P", "spec": "4710 socket • 16 core", "id": 2388586}
    assert not keep("CPU", old, 1_990_000)
    assert keep("CPU", new, 1_990_000)
    assert not keep("CPU", server, 1_990_000)


def test_consumer_ssds_only():
    ssd = lambda name, spec: keep("Storage", {"name": name, "spec": spec, "id": 2_300_000}, 1_990_000)
    assert ssd("Sandisk Optimus GX PRO 850X 4TB", "M.2 80mm • PCI-e 4.0 x4")
    assert ssd("WD Blue SA510 SATA SSD 2.5\" 500GB", "2,5\" • SATA-600")
    assert not ssd("Dell 345-BGNK 1,6TB", "2,5\" •")
    assert not ssd("HPE SPS-Drive SSD 3.84TB SFF SAS RI BC MV 3,84TB", "2,5\" •")


def test_no_server_ram_or_boards_but_dell_monitors_ok():
    item = lambda name, spec="": {"name": name, "spec": spec, "id": 2_300_000}
    assert not keep("RAM", item("HPE P56152-001", "32GB DDR5 @ 4.800MT/s, kit van 1"), 1_990_000)
    assert not keep("RAM", item("Kingston Server Premier 32GB DDR5 RDIMM"), 1_990_000)
    assert keep("RAM", item("Kingston FURY Beast 32GB DDR5-6000", "32GB DDR5 @ 6.000MT/s, kit van 2"), 1_990_000)
    assert not keep("Motherboard", item("Supermicro X13SAE-F"), 1_990_000)
    assert keep("Monitor", item("Dell 27 Plus 4K Monitor S2725QS"), 1_990_000)


def test_cutoff_moves_forward_with_time():
    assert cutoff_id(datetime(2026, 10, 10, tzinfo=timezone.utc)) == 1_990_000
    assert cutoff_id(datetime(2027, 1, 10, tzinfo=timezone.utc)) == 1_990_000 + 3 * 17_000


def test_parse_listing():
    html = '''<ul><li><a class="editionName" href="https://tweakers.net/pricewatch/2179976/sapphire-pulse-radeon-rx-9070-xt.html"
      title="Sapphire Pulse Radeon RX 9070 XT">x</a><p class="specline"><a>16GB GDDR6</a></p>
      <div class="item-price"><p><a><span class="text">vanaf</span><span class="amount"> € 889,- </span><span class="text">bij 12 winkels</span></a></p></div></li></ul>'''
    [item] = parse_listing(html)
    assert item == {"id": 2179976, "name": "Sapphire Pulse Radeon RX 9070 XT", "spec": "16GB GDDR6", "price": 889.0, "shops": 12}
