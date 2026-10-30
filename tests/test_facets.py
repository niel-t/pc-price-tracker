from tools.facets import enrich, facets

B = " • "  # Tweakers separates spec parts with a bullet


def test_monitor():
    f = facets("Monitor", "Acer Predator XB273K V4 Zwart", f'27"{B}3840x2160 (4K) @ 320Hz{B}IPS{B}1ms')
    assert f == {"maker": "Acer", "size": '27–28"', "res": "4K", "hz": "300 Hz+", "panel": "IPS"}
    f = facets("Monitor", "Philips Evnia 32M2N6901A/00 Wit", f'31,5"{B}3840x2160 (4K) @ 165Hz{B}QD-OLED{B}0,03ms')
    assert (f["size"], f["hz"], f["panel"]) == ('31.5–32"', "144–165 Hz", "QD-OLED")
    assert facets("Monitor", "LG 27GR83Q-B", f'27"{B}2560x1440 (Quad HD) @ 240Hz{B}Nano IPS{B}1ms')["panel"] == "IPS"


def test_ram():
    f = facets("RAM", "G.Skill Trident Z5 Neo RGB F5-6000J3644D64GX2", "128GB DDR5 @ 6.000MT/s, kit van 2")
    assert f == {"maker": "G.Skill", "type": "DDR5", "size": "128 GB", "kit": "2 × 64 GB", "form": "Desktop (DIMM)", "speed": "6000 MT/s"}
    f = facets("RAM", "Klevv KD5BGSA80-56G4600", "32GB DDR5 (SODIMM) @ 5.600MT/s, kit van 1")
    assert (f["form"], f["speed"], f["kit"]) == ("Laptop (SO-DIMM)", "5600 MT/s", "1 × 32 GB")
    assert facets("RAM", "Corsair Vengeance LPX", "16GB DDR4 @ 3.200MT/s, kit van 2")["speed"] == "3000–3200 MT/s"


def test_gpu():
    f = facets("GPU", "INNO3D GeForce RTX 3070 Ti iCHILL X4", f"Max. 1,83GHz{B}8GB GDDR6X{B}3x DP, HDMI")
    assert f == {"maker": "Inno3D", "brand": "NVIDIA", "gpu": "RTX 3070 Ti", "vram": "8 GB", "mem": "GDDR6X"}
    f = facets("GPU", "Sapphire Pulse Radeon RX 9070 XT", f"Max. 2,97GHz{B}16GB GDDR6{B}2x DP, 2x HDMI")
    assert (f["brand"], f["gpu"], f["vram"]) == ("AMD", "RX 9070 XT", "16 GB")
    assert facets("GPU", "ASUS ROG Astral GeForce RTX 5080 16GB GDDR7 OC Edition", "")["gpu"] == "RTX 5080"


def test_cpu():
    f = facets("CPU", "AMD Ryzen 7 8700G Boxed", f"AM5 socket{B}Octa (8) core @ 4,2GHz-5,1GHz")
    assert f == {"brand": "AMD", "socket": "AM5", "cores": "8 cores", "family": "Ryzen 7", "pack": "Boxed"}
    f = facets("CPU", "Intel Core Ultra 9 285 Tray", f"1851 socket{B}24 core @ 2,5GHz-5,4GHz")
    assert (f["brand"], f["socket"], f["cores"], f["family"], f["pack"]) == ("Intel", "LGA 1851", "24 cores", "Core Ultra 9", "Tray")


def test_motherboard():
    f = facets("Motherboard", "Gigabyte B850I AORUS PRO", f"Socket AM5{B}Mini-ITX{B}AMD B850 chipset")
    assert f == {"maker": "Gigabyte", "socket": "AM5", "form": "Mini-ITX", "chipset": "B850", "wifi": "No"}
    f = facets("Motherboard", "ASRock H610M-HDV/M.2 R2.0", f"Socket 1700{B}Micro-ATX{B}Intel H610 chipset")
    assert (f["socket"], f["form"], f["chipset"]) == ("LGA 1700", "Micro-ATX", "H610")
    assert facets("Motherboard", "Gigabyte X870 AORUS ELITE WIFI7", f"Socket AM5{B}ATX{B}AMD X870 chipset")["wifi"] == "Yes"


def test_storage():
    f = facets("Storage", "Samsung 990 Pro 2TB", f"M.2 80mm{B}PCI-e 4.0 x4")
    assert f == {"maker": "Samsung", "size": "2 TB", "form": "M.2", "iface": "PCIe 4.0"}
    f = facets("Storage", 'WD Blue SA510 SATA SSD 2.5" 500GB', f'2,5"{B}SATA-600')
    assert (f["maker"], f["size"], f["form"], f["iface"]) == ("WD", "500 GB", '2.5"', "SATA")


def test_psu():
    f = facets("PSU", "Thermaltake Toughpower GT Snow 1000W", f"1.000W (80 Plus Gold (115V)){B}volledig modulair")
    assert f == {"maker": "Thermaltake", "watt": "900–1000 W", "eff": "Gold", "modular": "Fully modular"}
    f = facets("PSU", "Sama B750", f"750W (Cybenetics ETA Silver (230V)){B}niet-modulair")
    assert (f["watt"], f["eff"], f["modular"]) == ("700–750 W", "Silver", "Non-modular")


def test_case_and_cooler():
    f = facets("Case", "Montech King 15 PRO ARGB Wit", f"Small form factor{B}4 interne bays")
    assert f == {"maker": "Montech", "type": "Small form factor", "color": "White"}
    assert facets("Cooler", "DeepCool AK400 G2 Digital Nyx", "120mm diameter met 31,45dB(A) geluidsproductie") == {"maker": "DeepCool", "fan": "120 mm"}


def test_enrich_adds_facets_and_drops_server_parts():
    c = {"categories": {"CPU": [["AMD Ryzen 5 9600X Boxed", f"AM5 socket{B}Hexa (6) core @ 3,9GHz-5,4GHz", 160.5, 30, 1],
                                ["AMD EPYC 4585PX Tray", f"AM5 socket{B}16 core @ 4,3GHz-5,7GHz", 600, 3, 2]]}}
    out = enrich(c)["categories"]["CPU"]
    assert len(out) == 1 and out[0][5]["cores"] == "6 cores"
    assert enrich(c)["categories"]["CPU"][0][5] == out[0][5]  # re-running replaces, doesn't append


def test_unknown_values_are_left_out():
    assert "color" not in facets("Case", "Sharkoon Rebel C70M RGB", f"Tower{B}6 interne bays")
    assert "type" not in facets("Case", "Some case", "1 review")
    assert "modular" not in facets("PSU", "Some PSU 650W", "650W (80 Plus Bronze (230V))")
    assert "pack" not in facets("CPU", "AMD Ryzen 5 7600", f"AM5 socket{B}Hexa (6) core @ 3,8GHz-5,1GHz")


def test_monitor_29_inch_has_its_own_bucket():
    assert facets("Monitor", "LG 29U511A-B Zwart", f'29"{B}2560x1080 @ 100Hz{B}IPS{B}5ms')["size"] == '29–30"'
