from tools.deals import parse_deals, score

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
