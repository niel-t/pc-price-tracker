from tools.deals import keep_tech, parse_deals, score

ROW = '''<table><tr><td class="pwimage"><a><img src="https://tweakers.net/i/x/thumbmini.png"></a></td>
<td class="itemname"><p><a class="editionName" href="https://tweakers.net/pricewatch/2179976/sapphire-pulse-radeon-rx-9070-xt.html"
  title="Sapphire Pulse Radeon RX 9070 XT">Sapphire Pulse Radeon RX 9070 XT</a></p>
  <span class="lowestPriceBadge"><strong>Laagste prijs sinds 6 maanden</strong></span>
  <p class="specline ellipsis"><a>Max. 2,97GHz &#8226; 16GB GDDR6</a></p></td>
<td class="category"><p><a href="https://tweakers.net/videokaarten/vergelijken/">Videokaarten</a></p></td>
<td class="discountRow voteRow" data-lowest-price="799" data-lowest-price-percentage="100"><a class="discount down">12%</a></td>
<td class="price-score"><p class="beforePrice"><a><s>€ 909,-</s></a></p><p class="price"><a>€ 799,-</a></p></td></tr></table>'''


def test_parse_deals():
    [d] = parse_deals(ROW)
    assert d["id"] == 2179976
    assert d["name"] == "Sapphire Pulse Radeon RX 9070 XT"
    assert (d["price"], d["before"], d["discount_pct"], d["low_6m"]) == (799.0, 909.0, 12, 799.0)
    assert d["badge"] == "Laagste prijs sinds 6 maanden"
    assert d["spec"].startswith("Max. 2,97GHz")


def test_score_rewards_real_lows_and_punishes_inflated_before_prices():
    genuine = {"discount_pct": 12, "badge": "Laagste prijs sinds 6 maanden", "price": 799, "low_6m": 799}
    inflated = {"discount_pct": 12, "badge": None, "price": 799, "low_6m": 699}  # was €699 recently
    assert score(genuine) == 20
    assert score(inflated) < 12


def test_suspect_pepper_deals_are_halved():
    pepper = {"discount_pct": 48, "badge": "Cheaper than all NL shops on Tweakers", "price": 217, "low_6m": None}
    assert score(pepper) == 56
    assert score(pepper | {"suspect": True}) == 28


def tech(**kw):
    d = {"name": "Apple iPhone 15", "price": 299.0, "before": 449.0, "discount_pct": 33, "low_6m": 299.0, "badge": None, "tw_cat": "Smartphones"}
    return keep_tech(d | kw)


def test_tech_deals_keep_genuine_big_discounts():
    assert tech()
    assert tech(badge="Laagste prijs sinds 6 maanden", low_6m=250.0)  # badge wins


def test_tech_deals_skip_small_fake_and_accessories():
    assert not tech(discount_pct=25)                      # under 30%
    assert not tech(price=18.0)                           # too cheap to matter
    assert not tech(low_6m=220.0)                         # was €220 recently: inflated "before" price
    assert not tech(tw_cat="Printer cartridges")
    assert not tech(tw_cat="Smartphonehoesjes")
    assert not tech(tw_cat="Kookplaten")


def test_tech_deals_skip_business_gear():
    assert not tech(name="Zebra ZT610 (ZT61042-T0E01C0Z)", tw_cat="Printers")
    assert not tech(name="Brother TD-2350DSAH300", tw_cat="Printers")
    assert not tech(name="HPE P00924-B21", tw_cat="Geheugen intern")
    assert not tech(name="Philips 65BDL3511Q/00 Zwart", tw_cat="Monitors")
    assert not tech(name="Netgear M4350-24X8F8V", price=4521.55, before=7345.0, low_6m=4521.55)
    assert tech(name="HP Smart Tank Plus 570", tw_cat="Printers")
