// ---------- config ----------
const FALLBACK_REPO = "niel-t/pc-price-tracker";        // used when not served from <owner>.github.io
const WORKFLOW = "check-prices.yml";
const CATS = {
  CPU: "🧠", GPU: "🎮", Motherboard: "🧩", RAM: "📏", Storage: "💽", PSU: "🔌",
  Case: "🗄️", Cooler: "❄️", Monitor: "🖥️", Peripherals: "⌨️", Other: "📦",
};
const REPO = location.hostname.endsWith(".github.io")
  ? `${location.hostname.split(".")[0]}/${location.pathname.split("/").filter(Boolean)[0]}`
  : FALLBACK_REPO;
const GH = `https://github.com/${REPO}`;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (v, d = 2) => v == null ? "–" : new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const store = {
  get: (k) => { try { return localStorage.getItem("pct." + k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem("pct." + k) : localStorage.setItem("pct." + k, v); } catch {} },
};
function ago(iso) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
const dateLabel = (iso) => new Date(iso).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function toast(msg, ms = 3000) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms); }
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "part";
const b64encode = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

// ---------- GitHub API (only used when a token is set) ----------
const token = () => store.get("token");
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...opts,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token()}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(r.status === 401 ? "GitHub token is invalid or expired" : r.status === 403 || r.status === 404 ? "Token lacks access to this repository" : body.message || `GitHub error ${r.status}`);
  }
  return r.status === 204 ? null : r.json();
}
async function readFile(path, fallback) {
  if (token()) {
    try {
      const r = await gh(`/contents/${path}?ref=main&t=${Date.now()}`);
      return { data: JSON.parse(b64decode(r.content)), sha: r.sha };
    } catch (e) {
      console.warn(`GitHub API read of ${path} failed, using the published copy`, e);
      S.tokenError = e.message;
    }
  }
  try {
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    return { data: r.ok ? await r.json() : fallback, sha: null };
  } catch (e) {
    console.warn(path, e);
    return { data: fallback, sha: null };
  }
}

// ---------- state ----------
const S = { config: { settings: {}, products: [] }, configSha: null, shops: {}, latest: {}, history: {}, alerts: [], cat: "All",
            sort: store.get("sort") || "cat", layout: store.get("layout") || "list", workflow: null, run: null, loaded: false };
let charts = {};

function shopInfo(url) {
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
  for (const [domain, info] of Object.entries(S.shops)) if (host === domain || host.endsWith("." + domain)) return { domain, ...info };
  return { domain: host, name: host, github: "untested" };
}

// Lowest-price step series for one part, built from per-shop change points.
function lowestSeries(p) {
  const hist = S.history[p.id] || {}, cur = S.latest[p.id];
  const shopNames = new Set((cur?.offers || []).map((o) => o.shop));
  const events = [];
  for (const [shop, pts] of Object.entries(hist)) if (shopNames.has(shop)) for (const [t, v] of pts) events.push({ t, shop, v });
  events.sort((a, b) => a.t.localeCompare(b.t));
  const now = {}, out = [];
  for (let i = 0; i < events.length; i++) {
    now[events[i].shop] = events[i].v;
    if (i + 1 < events.length && events[i + 1].t === events[i].t) continue;
    const [shop, v] = Object.entries(now).sort((a, b) => a[1] - b[1])[0];
    if (!out.length || out[out.length - 1].v !== v) out.push({ t: events[i].t, v, shop });
  }
  if (out.length && cur?.checked_at > out[out.length - 1].t) out.push({ ...out[out.length - 1], t: cur.checked_at, extend: true });
  return out;
}
const valueAt = (series, t) => { let v = null; for (const p of series) { if (p.t <= t) v = p.v; else break; } return v; };

function partModel(p) {
  const cur = S.latest[p.id];
  const ok = (cur?.offers || []).filter((o) => o.price != null);
  const bad = (cur?.offers || []).filter((o) => o.price == null);
  const series = lowestSeries(p);
  const real = series.filter((x) => !x.extend);
  const lowest = ok.length ? ok[0].price : null;
  const prev = real.length > 1 ? real[real.length - 2].v : null;
  const first = real.length ? real[0].v : null;
  const atl = real.length ? Math.min(...real.map((x) => x.v)) : null;
  return { ...p, cur, ok, bad, series, lowest, best: ok[0], prev, first, atl,
           change: lowest != null && prev ? (lowest - prev) / prev : null,
           hit: p.target_price != null && lowest != null && lowest <= p.target_price };
}

// ---------- load ----------
async function load() {
  S.tokenError = null;
  const [config, shops, latest, history, alerts, deals] = await Promise.all([
    readFile("products.json", { settings: {}, products: [] }), readFile("shops.json", { shops: {} }),
    readFile("data/latest.json", {}), readFile("data/history.json", {}), readFile("data/alerts.json", []),
    readFile("data/deals.json", null),
  ]);
  S.config = config.data; S.configSha = config.sha; S.shops = shops.data.shops || {};
  S.latest = latest.data; S.history = history.data; S.alerts = alerts.data; S.deals = deals.data;
  if (token()) await refreshWorkflowState();
  const first = !S.loaded;
  S.loaded = true;
  render();
  const r = route();
  if (first && r.view === "build" && r.arg) openDetail(r.arg);
}
async function refreshWorkflowState() {
  try {
    S.workflow = await gh(`/actions/workflows/${WORKFLOW}`);
    const runs = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
    S.run = runs.workflow_runs[0] || null;
  } catch (e) { S.workflow = null; S.run = null; console.warn(e); }
}

// ---------- navigation ----------
// Hash routes: #/overview, #/build, #/build/<part id> (opens its detail), #/deals, #/alerts, #/settings.
const VIEWS = {
  overview: { title: "Overview", render: renderOverview },
  build: { title: "My build", render: renderBuild },
  deals: { title: "Deals", render: renderDeals },
  alerts: { title: "Alerts", render: renderAlertsView },
  browse: { title: "Browse parts", render: renderBrowse },
  settings: { title: "Settings", render: renderSettings },
};
function route() {
  const [view, arg] = location.hash.replace(/^#\/?/, "").split("/");
  return { view: VIEWS[view] ? view : "overview", arg: arg ? decodeURIComponent(arg) : null };
}
const go = (view, arg) => { location.hash = `#/${view}${arg ? `/${encodeURIComponent(arg)}` : ""}`; };
let currentView = null;
function onRoute() {
  const { view, arg } = route();
  const changed = view !== currentView;
  if (changed && view === "alerts") S.alertsSeenBefore = store.get("alertsSeen") || "";
  currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === view));
  const navView = view === "browse" ? "build" : view; // Browse parts is part of My build
  document.querySelectorAll("[data-route]").forEach((a) => { if (a.dataset.route === navView) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  document.title = `${VIEWS[view].title} · PC Price Tracker`;
  if (detail.open && !(view === "build" && arg)) detail.close();
  render();
  if (changed) {
    window.scrollTo(0, 0);
    document.querySelector(`[data-view="${view}"] h1`)?.focus({ preventScroll: true });
  }
  if (view === "build" && arg && S.loaded) openDetail(arg);
}

// ---------- render ----------
function render() {
  const parts = S.config.products.map(partModel);
  renderStatus(); renderBanners();
  VIEWS[currentView]?.render(parts);
  renderNavCounts(parts); // after the view: visiting Alerts/Deals marks them as seen
  document.querySelectorAll(".needs-token").forEach((el) => el.classList.toggle("hidden", !token()));
}

function renderStatus() {
  const running = S.run && S.run.status !== "completed";
  const last = Object.values(S.latest).map((x) => x.checked_at).sort().pop();
  const mins = last ? (Date.now() - new Date(last)) / 60000 : Infinity;
  let cls = "crit", text = "No checks yet";
  if (!S.loaded) { cls = ""; text = "Loading…"; }
  else if (running) { cls = "pulse"; text = "Checking prices now…"; }
  else if (last) { cls = mins < 90 ? "good" : mins < 360 ? "warn" : "crit"; text = `Last check ${ago(last)}${mins >= 360 ? " · checks may be failing" : ""}`; }
  document.querySelectorAll("[data-fresh]").forEach((el) => {
    el.innerHTML = `<span class="dot ${cls}"></span><span>${text}</span>`;
    el.title = text;
  });
  document.querySelectorAll(".check-btn").forEach((b) => {
    b.disabled = !!running;
    b.querySelector(".ic").classList.toggle("spinning", !!running);
    const label = b.querySelector("span");
    if (label) label.textContent = running ? "Checking…" : "Check now";
  });
}

// Problems that matter on every page. (Read-only mode is explained where it matters: on My build.)
function renderBanners() {
  const b = [];
  if (token() && S.tokenError)
    b.push(`<div class="banner warn"><span>🔑</span><div class="grow"><b>Your GitHub connection isn't working</b> (${esc(S.tokenError)}). You're seeing the public copy; editing is disabled until you reconnect.</div><button class="primary" onclick="openSettings(true)">Reconnect</button></div>`);
  if (S.workflow && S.workflow.state !== "active")
    b.push(`<div class="banner warn"><span>⏸</span><div class="grow"><b>Automatic checks are turned off.</b> Prices won't update and you won't get alerts.</div><button class="primary" onclick="enableWorkflow()">Turn on</button></div>`);
  if (S.run && S.run.status === "completed" && S.run.conclusion === "failure")
    b.push(`<div class="banner warn"><span>⚠️</span><div class="grow"><b>The last check failed</b> (${ago(S.run.updated_at)}). Usually a shop blocking the tracker; other shops keep working.</div><a class="btn" href="${S.run.html_url}" target="_blank" rel="noopener">See details</a></div>`);
  $("banners").innerHTML = b.join("");
}

function renderNavCounts(parts) {
  const set = (key, text, cls = "") => document.querySelectorAll(`[data-count="${key}"]`).forEach((el) => { el.textContent = text; el.className = `count ${cls}`; });
  set("build", parts.length || "");
  const seen = store.get("alertsSeen") || "";
  const unseen = S.alerts.filter((a) => a.time > seen).length;
  set("alerts", unseen ? (unseen > 9 ? "9+" : unseen) : "", unseen ? "new" : "");
  const dealsNew = S.deals?.generated && S.deals.generated > (store.get("dealsSeen") || "") && currentView !== "deals";
  set("deals", dealsNew ? "•" : "", dealsNew ? "dot" : "");
  const needsSetup = !token() || S.tokenError || !store.get("topic");
  set("settings", needsSetup ? "•" : "", needsSetup ? "dot" : "");
}

// ---------- overview ----------
function renderOverview(parts) {
  renderSetup(parts); renderKpis(parts); renderAttention(parts);
  const n = parts.length;
  $("overviewLede").textContent = n ? `How your ${n}-part build is doing today.` : "Track the parts of your PC build and get a ping when prices drop.";

  const deals = dealLists().pc.slice(0, 3);
  $("overviewDeals").innerHTML = deals.length ? deals.map((d) => `<a class="mini" href="#/deals">
      ${dealThumb(d, true)}
      <div style="min-width:0"><div class="t">${esc(d.name)}</div><div class="small muted">${CATS[d.cat] || ""} ${esc(d.cat)}${d.shop ? ` · ${esc(d.shop)}` : ""}</div></div>
      <div class="p">${eur(d.price)}<small>−${d.discount_pct}%</small></div></a>`).join("")
    : `<div class="quiet small">No deals collected yet. They're added every morning by the task on your PC.</div>`;
  const techN = S.deals?.tech?.length || 0;
  if (techN) $("overviewDeals").innerHTML += `<a class="more" href="#/deals/tech" style="margin-top:10px">🏷️ Top 10 tech deals, 30%+ off <svg class="ic sm"><use href="#i-chevron"/></svg></a>`;

  $("overviewAlerts").innerHTML = S.alerts.length ? S.alerts.slice(0, 3).map((a) => `<a class="mini" href="#/alerts">
      <div class="ai">📉</div>
      <div style="min-width:0"><div class="t">${esc(a.name)}</div><div class="small muted" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis">${esc(a.message.split("\n")[0])}</div></div>
      <div class="small muted">${ago(a.time)}</div></a>`).join("")
    : `<div class="quiet small">No price drops yet. When one of your parts gets cheaper, it shows up here and on your phone.</div>`;
}

// What deserves a look today, most important first. Each row links to the part.
function renderAttention(parts) {
  const items = [];
  const threshold = (S.config.settings?.drop_threshold_pct ?? 5) / 100; // same bar as phone alerts, so small wobbles stay out
  for (const p of parts) {
    const link = `#/build/${encodeURIComponent(p.id)}`;
    if (p.hit) items.push({ rank: 0, cls: "good", icon: "🎯", link, html: `<b>${esc(p.name)}</b> hit your target: ${eur(p.lowest)} at ${esc(p.best.shop)} <span class="muted">(target ${eur(p.target_price, 0)})</span>` });
    else if (p.change != null && p.change <= -threshold) items.push({ rank: 1, cls: "good", icon: "📉", link, html: `<b>${esc(p.name)}</b> dropped ${Math.abs(p.change * 100).toFixed(1)}% to ${eur(p.lowest)} at ${esc(p.best.shop)}` });
    if (p.bad.length) items.push({ rank: 2, cls: "warn", icon: "⚠️", link, html: `<b>${esc(p.name)}</b>: ${p.bad.length} shop${p.bad.length > 1 ? "s" : ""} can't be read (${esc(p.bad.map((o) => o.shop).join(", "))})` });
    if (!p.cur) items.push({ rank: 3, cls: "info", icon: "⏳", link, html: `<b>${esc(p.name)}</b> is waiting for its first price check` });
  }
  items.sort((a, b) => a.rank - b.rank);
  const MAX = 5;
  $("attention").innerHTML = items.length
    ? items.slice(0, MAX).map((i) => `<a class="att ${i.cls}" href="${i.link}"><div class="ai">${i.icon}</div><div>${i.html}</div><svg class="ic"><use href="#i-chevron"/></svg></a>`).join("")
      + (items.length > MAX ? `<a class="more" href="#/build" style="margin:8px 6px 0">${items.length - MAX} more on My build <svg class="ic sm"><use href="#i-chevron"/></svg></a>` : "")
    : parts.length
      ? `<div class="quiet"><span style="font-size:18px">✅</span> All quiet. No targets hit, no drops and every shop is readable.</div>`
      : `<div class="quiet"><span style="font-size:18px">🛒</span> Nothing to watch yet. <a href="#/build">Add your first part</a> to get started.</div>`;
}

function renderSetup(parts) {
  const steps = [
    { done: !!token() && !S.tokenError, title: "Connect GitHub", text: "So you can edit parts from this page.", action: "openSettings(true)", btn: "Connect" },
    { done: store.get("alertsTested") === "1", title: "Get alerts on your phone", text: "Install ntfy and send a test.", action: "openSettings(false, 'topicInput')", btn: "Set up" },
    { done: parts.length >= 2, title: "Add your parts", text: "Add every component of your build.", action: "openEditor()", btn: "Add part" },
  ];
  const done = steps.filter((s) => s.done).length;
  $("setup").classList.toggle("hidden", done === steps.length || store.get("hideSetup") === "1");
  $("setupBar").style.width = `${(done / steps.length) * 100}%`;
  $("setupText").textContent = `${done} of ${steps.length} done — you'll get a ping on your phone when prices drop.`;
  $("steps").innerHTML = steps.map((s, i) => `<div class="step ${s.done ? "done" : ""}">
      <div class="n">${s.done ? "✓" : i + 1}</div>
      <div style="flex:1"><b>${s.title}</b><div class="small muted">${s.text}</div>
      ${s.done ? "" : `<button class="small" style="margin-top:8px" onclick="${s.action}">${s.btn} →</button>`}</div></div>`).join("");
}

function renderKpis(parts) {
  const priced = parts.filter((p) => p.lowest != null);
  const total = priced.reduce((s, p) => s + p.lowest, 0);
  $("kTotal").textContent = priced.length ? eur(total, 0) : "–";
  $("kParts").textContent = parts.length;
  const bad = parts.reduce((s, p) => s + p.bad.length, 0);
  $("kPartsSub").innerHTML = parts.length ? `${parts.reduce((s, p) => s + p.ok.length, 0)} shop prices${bad ? ` · <span style="color:var(--warn-ink)">⚠ ${bad} failing</span>` : ""}` : "Add your first part";
  const withTarget = parts.filter((p) => p.target_price != null);
  $("kTargets").textContent = withTarget.length ? `${parts.filter((p) => p.hit).length} / ${withTarget.length}` : "–";
  const toGo = withTarget.filter((p) => !p.hit && p.lowest != null).reduce((s, p) => s + (p.lowest - p.target_price), 0);
  $("kTargetsSub").textContent = withTarget.length ? (toGo > 0 ? `${eur(toGo, 0)} above your targets in total` : "All targets reached 🎉") : "Set targets per part";
  const saved = priced.filter((p) => p.first != null).reduce((s, p) => s + (p.first - p.lowest), 0);
  $("kSaved").textContent = priced.length ? eur(saved, 0) : "–";
  $("kSaved").style.color = saved > 0 ? "var(--good-ink)" : "";

  // Build total over time: only from the moment every priced part had data, so adding a part doesn't look like a price jump.
  const series = priced.map((p) => p.series).filter((s) => s.length);
  const start = series.length ? series.map((s) => s[0].t).sort().pop() : null;
  const times = [...new Set(series.flatMap((s) => s.map((x) => x.t)))].filter((t) => t >= start).sort();
  const pts = times.map((t) => ({ t, v: series.reduce((s, ser) => s + valueAt(ser, t), 0) }));
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const base = pts.length ? (valueAt(pts.map((p) => ({ t: p.t, v: p.v })), weekAgo) ?? pts[0].v) : null;
  if (base != null && pts.length > 1 && Math.abs(total - base) >= 0.5) {
    const d = total - base;
    $("kTotalSub").innerHTML = `<span class="delta ${d < 0 ? "down" : "up"}">${d < 0 ? "▼" : "▲"} ${eur(Math.abs(d), 0)}</span> <span class="muted">vs 7 days ago</span>`;
  } else $("kTotalSub").textContent = priced.length ? `${priced.length} part${priced.length > 1 ? "s" : ""} · no change in the last 7 days` : "Add parts to see your build total";
  lineChart("totalChart", pts, { compact: true, empty: "The chart fills in as prices are checked over time." });
}

// Deals of the day: data/deals.json is collected by tools/deals.py on the user's PC, which also picks today's two
// top-10 lists ("top10": PC parts and tech, at most 3 per category). Older files without it use the same rule here.
function top10(list, catKey) {
  const seen = {}, out = [];
  for (const d of list || []) {
    const c = d[catKey] || "?";
    if ((seen[c] = (seen[c] || 0) + 1) > 3) continue;
    out.push(d);
    if (out.length === 10) break;
  }
  return out;
}
// Tweakers category names (Dutch) → this app's part categories, for "Track" and "In your build" on tech deals.
const TW_CATS = { "Videokaarten": "GPU", "Processors": "CPU", "Moederborden": "Motherboard", "Geheugen intern": "RAM",
  "Interne ssd's": "Storage", "Voedingen": "PSU", "Behuizingen": "Case", "Processorkoeling": "Cooler", "Waterkoeling": "Cooler",
  "Monitors": "Monitor", "Toetsenborden": "Peripherals", "Muizen": "Peripherals", "Gaming headsets": "Peripherals" };
function dealLists() {
  const data = S.deals || {};
  // label: the PC list speaks this app's categories, the tech list Tweakers' own (much finer) categories.
  const pc = (data.top10?.pc || top10(data.deals, "cat")).map((d) => ({ ...d, label: d.cat }));
  const tech = (data.top10?.tech || top10([...(data.tech || [])].sort((a, b) => b.discount_pct - a.discount_pct), "tw_cat"))
    .map((d) => ({ ...d, cat: TW_CATS[d.tw_cat] || "Other", label: d.tw_cat }));
  return { pc, tech };
}

// Pepper deals are compared with Tweakers' lowest NL price today, Tweakers deals with their own earlier price.
const wasHtml = (d) => d.before_label
  ? `<span class="was ref">${esc(d.before_label)} ${eur(d.before)}</span>` : `<span class="was">${eur(d.before)}</span>`;
const saveText = (d) => d.before_label ? `${eur(d.before - d.price, 0)} below Tweakers` : `Save ${eur(d.before - d.price, 0)}`;
const catLabel = (d) => `${CATS[d.cat] && d.cat !== "Other" ? `${CATS[d.cat]} ` : ""}${esc(d.label || d.cat)}`;
function dealSource(d) {
  if (d.source === "pepper") return `via <b>Pepper</b> · at <b class="ink2">${esc(d.shop)}</b> · posted ${ago(d.posted)}`;
  return `via <b>Tweakers</b>`;
}
function dealBadges(d) {
  const b = [];
  if (d.suspect) b.push(`<span class="badge warn" title="Far below every Dutch shop — often a pricing error that's already been fixed">⚠ Too good to be true? Check first</span>`);
  else if (d.source === "pepper") b.push(`<span class="badge good" title="Cheaper than every Dutch shop listed on Tweakers today">★ Beats all NL shops</span>`);
  else if (d.badge) b.push(`<span class="badge good">★ ${esc(d.badge.replace(/^Laagste prijs sinds (\d+) maanden?$/, "Lowest in $1 months"))}</span>`);
  else if (d.low_6m && d.price <= d.low_6m * 1.02) b.push(`<span class="badge good" title="Within 2% of the lowest price of the last 6 months">★ At its 6-month low</span>`);
  else if (d.low_6m && d.price > d.low_6m * 1.02) b.push(`<span class="badge warn" title="Tweakers saw ${eur(d.low_6m)} recently">Was ${eur(d.low_6m, 0)} recently</span>`);
  if (d.cat !== "Other" && S.config.products.some((p) => p.category === d.cat)) b.push(`<span class="badge info" title="You track a ${esc(d.cat)} — this could be an alternative">In your build</span>`);
  return b.join("");
}
const dealThumb = (d, sm) => `<div class="thumb ${sm ? "sm" : ""}">${d.image ? `<img src="${esc(d.image)}" alt="" loading="lazy">` : CATS[d.cat] || "📦"}</div>`;
const dealPhoto = (d, eager) => `<div class="photo"><span class="ribbon">−${d.discount_pct}%</span>${
  d.image_large || d.image ? `<img src="${esc(d.image_large || d.image)}" alt="" ${eager ? "" : `loading="lazy"`}>` : `<span class="fallback">${CATS[d.cat] || "📦"}</span>`}</div>`;
const dealButtons = (d, i, big) => `<a class="btn ${big ? "cta" : ""}" href="${esc(d.url)}" target="_blank" rel="noopener"
    title="${d.source === "pepper" ? "Open the deal on Pepper" : "Compare shops on Tweakers"}">${big ? "View deal" : "View"} ↗</a>${
    token() ? `<button data-track="${i}" title="Track this product">＋ Track</button>` : ""}`;

// Two top-10 lists on the Deals page: #/deals (PC parts) and #/deals/tech (all tech at 30%+ off).
function renderDeals() {
  const data = S.deals, mode = route().arg === "tech" ? "tech" : "pc";
  document.querySelectorAll("[data-mode]").forEach((a) => { if (a.dataset.mode === mode) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  document.querySelectorAll(".explain[data-for]").forEach((d) => d.classList.toggle("hidden", d.dataset.for !== mode));
  const list = dealLists()[mode];
  S.dealList = list;
  $("h-deals").textContent = mode === "tech" ? "Top 10 tech deals" : "Top 10 PC-part deals";
  $("dealsDate").textContent = data?.generated
    ? `${new Date(data.generated).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · deals of the day` : "Deals of the day";
  if (!list.length) {
    $("dealsSub").textContent = mode === "tech" ? "The biggest genuine drops on tech, each at least 30% off." : "The best genuine price drops on PC parts.";
    $("dealStats").innerHTML = ""; $("dealsStale").innerHTML = ""; $("dealPodium").innerHTML = ""; $("dealGrid").innerHTML = "";
    $("dealTop").innerHTML = `<div class="card empty"><div style="font-size:36px">🏷️</div><h2>No deals yet</h2>
      <p class="muted">Deals are collected every morning by the scheduled task on your PC. <a href="${GH}#deals-of-the-day" target="_blank" rel="noopener">How it works</a></p></div>`;
    return;
  }
  store.set("dealsSeen", data.generated);
  const hrs = (Date.now() - new Date(data.generated)) / 36e5;
  $("dealsStale").innerHTML = hrs > 36
    ? `<div class="banner warn small"><span>⏳</span><div class="grow">These deals are ${Math.round(hrs / 24)} day(s) old. They refresh when your PC runs the daily deals task.</div></div>` : "";
  $("dealsSub").textContent = mode === "tech"
    ? `The 10 biggest genuine drops on all tech today, each at least 30% off. Updated ${ago(data.generated)}.`
    : `The 10 best genuine price drops on PC parts today, from Tweakers and Pepper. Updated ${ago(data.generated)}.`;

  const savings = list.reduce((s, d) => s + Math.max(0, d.before - d.price), 0);
  const lows = list.filter((d) => !d.suspect && (d.source === "pepper" || d.badge || (d.low_6m && d.price <= d.low_6m * 1.02))).length;
  const cats = new Set(list.map((d) => d.label)).size;
  const stat = (v, l) => `<div class="show-stat"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $("dealStats").innerHTML = stat(eur(savings, 0), "saved in this top 10")
    + stat(`−${Math.max(...list.map((d) => d.discount_pct))}%`, "biggest drop")
    + stat(`${lows}/${list.length}`, "at a genuine low")
    + stat(cats, cats === 1 ? "category" : "categories");

  const [top, ...rest] = list;
  $("dealTop").innerHTML = `<article class="top-deal lift">
      ${dealPhoto(top, true)}
      <div class="body">
        <div class="kicker"><span class="medal r1">1</span>Deal of the day</div>
        <div class="via">${catLabel(top)} · ${dealSource(top)}</div>
        <h2>${esc(top.name)}</h2>
        ${top.spec ? `<div class="small muted">${esc(top.spec)}</div>` : ""}
        <div class="badges">${dealBadges(top)}</div>
        <div class="price-line"><span class="now">${eur(top.price)}</span>${wasHtml(top)}<span class="save">${saveText(top)}</span></div>
        <div class="actions">${dealButtons(top, 0, true)}</div>
      </div>
    </article>`;
  $("dealPodium").innerHTML = rest.slice(0, 2).map((d, j) => `<article class="pod lift">
      <span class="medal r${j + 2}">${j + 2}</span>
      ${dealPhoto(d, true)}
      <div class="body">
        <div class="via">${catLabel(d)} · ${dealSource(d)}</div>
        <h3 title="${esc(d.name)}">${esc(d.name)}</h3>
        <div class="badges">${dealBadges(d)}</div>
        <div><span class="now">${eur(d.price)}</span> ${wasHtml(d)}</div>
        <div><span class="save">${saveText(d)}</span></div>
        <div class="tile-actions" style="margin-top:auto">${dealButtons(d, j + 1)}</div>
      </div>
    </article>`).join("");
  $("dealGrid").innerHTML = rest.slice(2).map((d, j) => `<li><article class="tile lift">
      ${dealPhoto(d)}<span class="rank-n" aria-label="Number ${j + 4}">${j + 4}</span>
      <div class="via">${catLabel(d)}${d.source === "pepper" ? ` · ${esc(d.shop)}` : ""}</div>
      <h3 title="${esc(d.name)}">${esc(d.name)}</h3>
      <div class="badges">${dealBadges(d)}</div>
      <div class="price-row"><span class="now">${eur(d.price)}</span>${wasHtml(d)}</div>
      <div class="tile-actions">${dealButtons(d, j + 3)}</div>
    </article></li>`).join("");
}

function renderBuild(parts) {
  $("readonlyNote").innerHTML = token() ? "" : `<div class="notice"><span>👀</span><div class="grow">You're viewing read-only. <b>Connect GitHub</b> to add parts, set targets and run checks from here.</div><button class="primary" onclick="openSettings(true)">Connect</button></div>`;
  $("addBtn").classList.toggle("hidden", !token());
  $("browseBtn").href = `#/browse/${FACETS[S.cat] ? S.cat : "GPU"}`;
  const cats = ["All", ...Object.keys(CATS).filter((c) => parts.some((p) => p.category === c))];
  if (!cats.includes(S.cat)) S.cat = "All";
  $("chips").innerHTML = cats.length > 2 ? cats.map((c) => `<button class="chip" aria-pressed="${c === S.cat}" data-cat="${c}">${c === "All" ? "All parts" : `${CATS[c]} ${c}`}</button>`).join("") : "";
  $("sort").value = S.sort;
  document.querySelectorAll("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.layout === S.layout));
  document.querySelector(".toolbar:has(#chips)")?.classList.toggle("hidden", !parts.length);
  renderParts(parts);
}

function sparkline(series, target) {
  const pts = series.map((x) => x.v);
  if (pts.length < 2) return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none"><line x1="0" x2="100" y1="20" y2="20" stroke="var(--series)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  const vals = target != null ? [...pts, target] : pts;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const t0 = new Date(series[0].t).getTime(), t1 = new Date(series[series.length - 1].t).getTime(), tw = t1 - t0 || 1;
  const x = (t) => ((new Date(t).getTime() - t0) / tw) * 100, y = (v) => 36 - ((v - lo) / span) * 32;
  let d = `M${x(series[0].t)},${y(series[0].v)}`;
  for (let i = 1; i < series.length; i++) d += ` H${x(series[i].t)} V${y(series[i].v)}`;
  const tl = target != null ? `<line x1="0" x2="100" y1="${y(target)}" y2="${y(target)}" stroke="var(--good)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : "";
  return `<svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${tl}<path d="${d} V40 H0 Z" fill="var(--series-wash)"/><path d="${d}" fill="none" stroke="var(--series)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderParts(parts) {
  let list = parts.filter((p) => S.cat === "All" || p.category === S.cat);
  const order = Object.keys(CATS);
  const sorters = {
    cat: (a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name),
    drop: (a, b) => (a.change ?? 0) - (b.change ?? 0),
    target: (a, b) => ((a.target_price && a.lowest) ? a.lowest / a.target_price : 9) - ((b.target_price && b.lowest) ? b.lowest / b.target_price : 9),
    price: (a, b) => (b.lowest ?? 0) - (a.lowest ?? 0),
  };
  list.sort(sorters[S.sort] || sorters.cat);

  if (!parts.length) {
    $("parts").innerHTML = `<div class="card empty"><div style="font-size:36px">🛒</div><h2>No parts yet</h2>
      <p class="muted">Add each component of your build. Type a name and pick it from the suggestions, then paste the shop links.</p>
      ${token() ? `<button class="primary" onclick="openEditor()"><svg class="ic"><use href="#i-plus"/></svg>Add your first part</button>`
                : `<button class="primary" onclick="openSettings(true)">Connect GitHub to start</button>`}</div>`;
    return;
  }
  if (S.layout === "list") { $("parts").innerHTML = buildList(list); return; }

  const cards = list.map((p) => {
    const badges = [];
    if (p.hit) badges.push(`<span class="badge good">✓ Target hit</span>`);
    if (p.lowest != null && p.atl != null && p.lowest <= p.atl && p.series.filter((x) => !x.extend).length > 1) badges.push(`<span class="badge good">★ All-time low</span>`);
    if (p.change != null && p.change < 0) badges.push(`<span class="badge good">▼ ${Math.abs(p.change * 100).toFixed(1)}%</span>`);
    if (p.change != null && p.change > 0) badges.push(`<span class="badge crit">▲ ${(p.change * 100).toFixed(1)}%</span>`);
    if (p.bad.length) badges.push(`<span class="badge warn" title="${esc(p.bad.map((o) => `${o.shop}: ${o.detail}`).join("\n"))}">⚠ ${p.bad.length} shop${p.bad.length > 1 ? "s" : ""} failing</span>`);
    if (!p.cur) badges.push(`<span class="badge info">⏳ Waiting for first check</span>`);

    let target = "";
    if (p.target_price != null && p.lowest != null) {
      const pct = Math.min(100, (p.target_price / p.lowest) * 100);
      target = `<div class="target"><div class="row spread small"><span class="ink2">Target ${eur(p.target_price, 0)}</span>
        <span class="${p.hit ? "" : "ink2"}" style="${p.hit ? "color:var(--good-ink);font-weight:600" : ""}">${p.hit ? `${eur(p.target_price - p.lowest)} under` : `${eur(p.lowest - p.target_price)} to go`}</span></div>
        <div class="tbar ${p.hit ? "hit" : ""}" role="img" aria-label="${pct.toFixed(0)}% of the way to target"><div style="width:${pct}%"></div></div></div>`;
    } else if (token()) target = `<div class="small muted">No target set · <a href="#" onclick="event.stopPropagation(); openEditor('${p.id}'); return false">set one</a></div>`;

    return `<article class="card part" tabindex="0" data-id="${esc(p.id)}" aria-label="${esc(p.name)}">
      <div class="top"><div class="cat-icon" title="${esc(p.category)}">${CATS[p.category] || "📦"}</div>
        <div style="min-width:0; flex:1"><div class="name">${esc(p.name)}</div>
        <div class="small muted">${p.best ? `cheapest at <b class="ink2">${esc(p.best.shop)}</b> · ${p.ok.length} shop${p.ok.length === 1 ? "" : "s"}` : esc(p.category)}</div></div></div>
      <div class="row spread" style="align-items:flex-end">
        <div class="price">${eur(p.lowest)}</div>
        <div class="row" style="gap:4px; justify-content:flex-end">${badges.join("")}</div>
      </div>
      ${p.series.length ? sparkline(p.series, p.target_price) : ""}
      ${target}
    </article>`;
  });
  if (token()) cards.push(`<button class="card add-tile" onclick="openEditor()"><div><div style="font-size:28px">＋</div>Add a part</div></button>`);
  $("parts").innerHTML = `<div class="grid">${cards.join("")}</div>`;
}

// The build as a parts list with a total row: the quickest way to read the whole build at a glance.
function buildList(list) {
  const change = (p) => p.change == null || p.change === 0 ? `<span class="muted">–</span>`
    : `<span class="badge ${p.change < 0 ? "good" : "crit"}">${p.change < 0 ? "▼" : "▲"} ${Math.abs(p.change * 100).toFixed(1)}%</span>`;
  const target = (p) => {
    if (p.target_price == null || p.lowest == null) return `<span class="small muted">${p.target_price == null ? "No target" : eur(p.target_price, 0)}</span>`;
    const pct = Math.min(100, (p.target_price / p.lowest) * 100);
    return `<div class="target"><div class="row spread small"><span class="ink2">${eur(p.target_price, 0)}</span>
      <span style="${p.hit ? "color:var(--good-ink);font-weight:600" : ""}" class="${p.hit ? "" : "muted"}">${p.hit ? "✓ hit" : `${eur(p.lowest - p.target_price, 0)} to go`}</span></div>
      <div class="tbar ${p.hit ? "hit" : ""}" role="img" aria-label="${pct.toFixed(0)}% of the way to target"><div style="width:${pct}%"></div></div></div>`;
  };
  const rows = list.map((p) => `<div class="brow" role="row" tabindex="0" data-id="${esc(p.id)}">
      <div class="nm" role="cell"><div class="cat-icon" title="${esc(p.category)}">${CATS[p.category] || "📦"}</div>
        <div><b title="${esc(p.name)}">${esc(p.name)}</b><div class="small muted">${esc(p.category)}${p.bad.length ? ` · <span style="color:var(--warn-ink)">⚠ ${p.bad.length} failing</span>` : ""}${!p.cur ? " · ⏳ waiting for first check" : ""}</div></div></div>
      <div class="num c-price" role="cell"><b>${eur(p.lowest)}</b></div>
      <div class="num c-change" role="cell">${change(p)}</div>
      <div class="c-shop small ink2" role="cell">${p.best ? `${esc(p.best.shop)}<div class="muted">${p.ok.length} shop${p.ok.length === 1 ? "" : "s"}</div>` : "–"}</div>
      <div class="c-target" role="cell">${target(p)}</div>
      <button class="edit needs-token" data-edit="${esc(p.id)}" title="Edit ${esc(p.name)}" aria-label="Edit ${esc(p.name)}"><svg class="ic"><use href="#i-edit"/></svg></button>
    </div>`).join("");
  const priced = list.filter((p) => p.lowest != null);
  const total = priced.reduce((s, p) => s + p.lowest, 0);
  return `<div class="card blist" role="table" aria-label="Parts">
    <div class="brow head" role="row"><div role="columnheader">Part</div><div class="num" role="columnheader">Cheapest</div><div class="num" role="columnheader">Change</div><div role="columnheader">Shop</div><div role="columnheader">Target</div><div></div></div>
    ${rows}
    <div class="brow total" role="row"><div role="cell">Total${S.cat !== "All" ? ` · ${esc(S.cat)}` : ""} <span class="small muted" style="font-weight:400">(${priced.length} part${priced.length === 1 ? "" : "s"})</span></div>
      <div class="num c-price" role="cell">${eur(total)}</div><div></div><div class="c-shop"></div><div class="c-target"></div><div class="edit"></div></div>
  </div>`;
}

function dayLabel(iso) {
  const d = new Date(iso), today = new Date();
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function renderAlertsView() {
  const names = [...new Set(S.alerts.map((a) => a.name))].sort();
  if (!names.includes(S.alertPart)) S.alertPart = "";
  $("alertFilter").innerHTML = `<option value="">All parts</option>` + names.map((n) => `<option ${n === S.alertPart ? "selected" : ""}>${esc(n)}</option>`).join("");
  $("alertFilter").classList.toggle("hidden", names.length < 2);
  const list = S.alerts.filter((a) => !S.alertPart || a.name === S.alertPart);
  const seenBefore = S.alertsSeenBefore ?? "";
  if (S.alerts.length) store.set("alertsSeen", S.alerts[0].time);
  if (!list.length) {
    $("alerts").innerHTML = `<div class="card empty"><div style="font-size:36px">🔔</div><h2>No alerts yet</h2>
      <p class="muted">You'll get an alert when one of your parts drops by ${S.config.settings?.drop_threshold_pct ?? 5}% or more, or reaches your target price.</p>
      <a class="btn" href="#/settings">Alert settings</a></div>`;
    return;
  }
  let html = "", day = null;
  for (const a of list) {
    const d = dayLabel(a.time);
    if (d !== day) { html += `${day ? "</div>" : ""}<h2 class="day">${esc(d)}</h2><div class="card">`; day = d; }
    const part = S.config.products.find((p) => p.id === a.id);
    html += `<div class="alert ${a.time > seenBefore ? "new" : ""}">
      <div class="a-ic">📉</div>
      <div><div class="row spread"><b>${esc(a.name)}</b><span class="small muted" title="${esc(dateLabel(a.time))}">${new Date(a.time).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</span></div>
      <pre>${esc(a.message)}</pre>
      <div class="row small" style="margin-top:6px; gap:14px"><a href="${esc(a.url)}" target="_blank" rel="noopener">Go to cheapest shop ↗</a>${part ? `<a href="#/build/${encodeURIComponent(part.id)}">Price history</a>` : ""}</div></div></div>`;
  }
  $("alerts").innerHTML = html + "</div>";
}

// ---------- charts ----------
function lineChart(canvasId, pts, { compact = false, target = null, empty = "" } = {}) {
  const canvas = $(canvasId);
  charts[canvasId]?.destroy();
  const box = canvas.parentElement;
  box.querySelector(".chart-empty")?.remove();
  if (pts.length < 2) {
    canvas.classList.add("hidden");
    box.insertAdjacentHTML("beforeend", `<div class="chart-empty small muted" style="height:100%; display:grid; place-items:center; text-align:center; border:1px dashed var(--grid); border-radius:8px; padding:12px">${empty}</div>`);
    return;
  }
  canvas.classList.remove("hidden");
  const datasets = [{ label: "Lowest price", data: pts.map((p) => ({ x: new Date(p.t).getTime(), y: p.v })), stepped: true, borderColor: css("--series"), backgroundColor: css("--series-wash"),
                      borderWidth: 2, pointRadius: compact ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: css("--series"), pointBorderColor: css("--surface"), pointBorderWidth: 2, fill: true }];
  if (target != null) datasets.push({ label: "Your target", data: [{ x: datasets[0].data[0].x, y: target }, { x: datasets[0].data.at(-1).x, y: target }],
                                      borderColor: css("--good"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false });
  const grid = css("--grid"), muted = css("--muted");
  charts[canvasId] = new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false, animation: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: target != null, position: "top", align: "end", labels: { color: css("--ink-2"), boxWidth: 14, boxHeight: 2, font: { size: 11 } } },
        tooltip: { filter: (i) => i.datasetIndex === 0, callbacks: {
          title: (items) => dateLabel(new Date(items[0].parsed.x).toISOString()),
          label: (c) => ` ${eur(c.parsed.y)}${pts[c.dataIndex]?.shop ? ` at ${pts[c.dataIndex].shop}` : ""}` } },
      },
      scales: {
        x: { type: "linear", display: !compact, grid: { display: false }, border: { color: css("--axis") },
             min: datasets[0].data[0].x, max: datasets[0].data.at(-1).x,
             ticks: { color: muted, maxTicksLimit: 6, callback: (v) => new Date(v).toLocaleDateString("nl-NL", { day: "numeric", month: "short" }) } },
        y: { display: true, position: "right", grid: { color: grid }, border: { display: false },
             ticks: { color: muted, maxTicksLimit: compact ? 3 : 6, callback: (v) => eur(v, 0), font: { size: 11 } } },
      },
    },
  });
}

// ---------- detail ----------
function openDetail(id) {
  const p = S.config.products.map(partModel).find((x) => x.id === id);
  if (!p) return;
  $("dIcon").textContent = CATS[p.category] || "📦";
  $("dName").textContent = p.name;
  $("dSub").textContent = `${p.category}${p.cur ? ` · checked ${ago(p.cur.checked_at)}` : ""}`;
  $("dEdit").onclick = () => { detail.close(); openEditor(p.id); };
  const atlPoint = p.series.filter((x) => !x.extend).find((x) => x.v === p.atl);
  $("dStats").innerHTML = `
    <div><div class="small muted">Lowest now</div><div class="v">${eur(p.lowest)}</div><div class="small muted">${esc(p.best?.shop || "–")}</div></div>
    <div><div class="small muted">All-time low</div><div class="v">${eur(p.atl)}</div><div class="small muted">${atlPoint ? dateLabel(atlPoint.t) : "–"}</div></div>
    <div><div class="small muted">Your target</div><div class="v" style="${p.hit ? "color:var(--good-ink)" : ""}">${eur(p.target_price)}</div><div class="small muted">${p.target_price == null ? "not set" : p.hit ? "✓ reached" : `${eur(p.lowest - p.target_price)} to go`}</div></div>
    <div><div class="small muted">Shops</div><div class="v">${p.ok.length}<span class="muted" style="font-size:14px"> / ${(p.cur?.offers || []).length}</span></div><div class="small muted">${p.bad.length ? `⚠ ${p.bad.length} not readable` : "all readable"}</div></div>`;

  const real = p.series.filter((x) => !x.extend);
  $("dTable").innerHTML = real.length ? `<table><thead><tr><th>Date</th><th>Lowest price</th><th>Shop</th></tr></thead><tbody>${
    real.slice().reverse().map((x) => `<tr><td>${dateLabel(x.t)}</td><td class="num">${eur(x.v)}</td><td>${esc(x.shop)}</td></tr>`).join("")}</tbody></table>` : `<p class="small muted">No data yet.</p>`;

  const offers = p.cur?.offers || [];
  const maxGap = Math.max(1, ...p.ok.map((o) => o.price - p.lowest));
  $("dShops").innerHTML = offers.length ? offers.map((o, i) => {
    if (o.price == null) {
      const why = o.status === "blocked" ? "Shop blocks the tracker" : o.status === "no-price" ? "No price found on the page" : `Couldn't load (${o.detail})`;
      return `<div class="shop-row"><div><b>${esc(o.shop)}</b></div><div class="p muted">–</div><div class="gap-bar"><span class="badge warn">⚠ ${esc(why)}</span></div><a class="btn small" href="${esc(o.url)}" target="_blank" rel="noopener">Open ↗</a></div>`;
    }
    const gap = o.price - p.lowest;
    return `<div class="shop-row ${i === 0 ? "best" : ""}"><div><b>${esc(o.shop)}</b>${i === 0 ? ` <span class="badge good">Cheapest</span>` : ""}</div>
      <div class="p">${eur(o.price)}</div>
      <div class="gap-bar">${i === 0 ? "" : `<div class="track"><span class="b" style="width:${Math.max(2, (gap / maxGap) * 100)}%"></span></div><span class="lbl">+${eur(gap)}</span>`}</div>
      <a class="btn small" href="${esc(o.url)}" target="_blank" rel="noopener">Open ↗</a></div>`;
  }).join("") : `<p class="small muted">Waiting for the first check.</p>`;

  if (!detail.open) detail.showModal();
  lineChart("dChart", p.series, { target: p.target_price, empty: "The chart appears once there are at least two checks." });
}

// ---------- editor ----------
let editingId = null;
function openEditor(id = null, prefill = null) {
  if (!token()) return openSettings(true);
  editingId = id;
  const p = id ? S.config.products.find((x) => x.id === id) : null;
  const f = $("editForm").elements;
  $("eTitle").textContent = p ? "Edit part" : "Add a part";
  $("eSave").textContent = p ? "Save changes" : "Add & check prices";
  $("eDelete").classList.toggle("hidden", !p);
  $("eCat").innerHTML = Object.entries(CATS).map(([c, i]) => `<option value="${c}">${i} ${c}</option>`).join("");
  f.name.value = p?.name || ""; f.category.value = p?.category || (S.cat !== "All" ? S.cat : "GPU"); f.target.value = p?.target_price ?? "";
  $("eLinks").innerHTML = "";
  (p?.shops?.length ? p.shops : [{ url: "" }, { url: "" }]).forEach((s) => addLinkRow(s.url));
  if (prefill) {
    f.name.value = prefill.name; f.category.value = prefill.category;
    f.target.value = prefill.target != null ? Math.floor(prefill.target) : "";
  }
  renderFindLinks();
  showPicked(prefill?.picked || null);
  closeSuggestions();
  loadCatalog();
  editor.showModal();
  if (prefill) $("eLinks").querySelector("input")?.focus();
  else if (!p) f.name.focus();
}

// ---------- suggestions (catalog.json, built from Tweakers by tools/build_catalog.py) ----------
let catalog = null, catalogPromise = null, acItems = [], acActive = -1;
function loadCatalog() {
  catalogPromise ??= fetch(`catalog.json?d=${new Date().toISOString().slice(0, 10)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      if (!c) return;
      catalog = Object.entries(c.categories).flatMap(([cat, rows]) => rows.map(([name, spec, price, shops, id, facets]) => {
        const text = norm(`${name} ${spec}`);
        return { cat, name, spec, price, shops, id, facets: facets || {}, text, compact: text.replace(/ /g, "") };
      }));
      catalog.generated = c.generated;
      const n = catalog.length.toLocaleString("nl-NL");
      $("eNameHint").textContent = `${n} products to pick from, e.g. type “ASUS ROG”`;
    })
    .catch(() => {});
}
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.+]+/g, " ").trim();

function searchCatalog(query, cat) {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (!catalog || !tokens.length || query.trim().length < 2) return { same: [], other: [], total: 0, tokens };
  const scored = [];
  for (const it of catalog) {
    let score = 0, ok = true;
    for (const t of tokens) {
      const i = it.text.indexOf(t);
      if (i === -1 && !it.compact.includes(t)) { ok = false; break; }
      // Word-start matches in the name rank higher than matches inside words or in the spec line.
      score += i === 0 || (i > 0 && it.text[i - 1] === " ") ? (i < it.name.length ? 3 : 1) : 1;
    }
    if (!ok) continue;
    if (it.cat === cat) score += 100;
    scored.push({ it, score: score + Math.min(it.shops, 30) / 30 });
  }
  scored.sort((a, b) => b.score - a.score || a.it.name.length - b.it.name.length);
  const same = scored.filter((s) => s.it.cat === cat).slice(0, 8).map((s) => s.it);
  const other = same.length < 4 ? scored.filter((s) => s.it.cat !== cat).slice(0, 6 - same.length).map((s) => s.it) : [];
  return { same, other, total: scored.length, tokens };
}

function highlight(name, tokens) {
  const lower = name.toLowerCase(), marks = new Array(name.length).fill(false);
  for (const t of tokens) {
    let i = lower.indexOf(t);
    while (i !== -1) { marks.fill(true, i, i + t.length); i = lower.indexOf(t, i + t.length); }
  }
  let out = "", open = false;
  for (let i = 0; i < name.length; i++) {
    if (marks[i] !== open) { out += marks[i] ? "<mark>" : "</mark>"; open = marks[i]; }
    out += esc(name[i]);
  }
  return out + (open ? "</mark>" : "");
}

function renderSuggestions() {
  const f = $("editForm").elements, list = $("acList");
  if (!catalog) { closeSuggestions(); return; }
  const res = searchCatalog(f.name.value, f.category.value);
  if (!res.total && f.name.value.trim().length < 2) { closeSuggestions(); return; }
  acItems = [...res.same, ...res.other];
  acActive = acItems.length ? 0 : -1;
  const item = (it, i) => `<div class="ac-item" role="option" id="ac-${i}" data-i="${i}" aria-selected="${i === acActive}">
      <div class="nm">${highlight(it.name, res.tokens)}</div>
      <div class="pr">${it.price ? `vanaf ${eur(it.price, 0)}` : ""}<small>${it.shops} shop${it.shops === 1 ? "" : "s"}</small></div>
      <div class="sp">${esc(it.spec)}</div></div>`;
  let html = "";
  if (res.same.length) html += `<div class="ac-head">${CATS[f.category.value] || ""} ${esc(f.category.value)}</div>` + res.same.map(item).join("");
  if (res.other.length) html += `<div class="ac-head">Other categories</div>` + res.other.map((it, j) => item(it, res.same.length + j).replace('class="nm">', `class="nm">${CATS[it.cat]} `)).join("");
  if (!acItems.length) html = `<div class="ac-empty">No matches in the catalog — that's fine, just type the full name.</div>`;
  else if (res.total > acItems.length) html += `<div class="ac-foot">${res.total - acItems.length} more — keep typing to narrow down (e.g. add “4070” or “OC”)</div>`;
  list.innerHTML = html;
  list.classList.remove("hidden");
  f.name.setAttribute("aria-expanded", "true");
  f.name.setAttribute("aria-activedescendant", acActive >= 0 ? `ac-${acActive}` : "");
}
function closeSuggestions() {
  $("acList").classList.add("hidden");
  $("eName").setAttribute("aria-expanded", "false");
  acItems = []; acActive = -1;
}
function moveActive(d) {
  if (!acItems.length) return;
  acActive = (acActive + d + acItems.length) % acItems.length;
  document.querySelectorAll("#acList .ac-item").forEach((el) => el.setAttribute("aria-selected", +el.dataset.i === acActive));
  $(`ac-${acActive}`)?.scrollIntoView({ block: "nearest" });
  $("eName").setAttribute("aria-activedescendant", `ac-${acActive}`);
}
function pickSuggestion(it) {
  const f = $("editForm").elements;
  f.name.value = it.name;
  f.category.value = it.cat;
  closeSuggestions();
  renderFindLinks();
  showPicked(it);
}
function showPicked(it) {
  const box = $("ePicked");
  if (!it) { box.classList.add("hidden"); return; }
  const suggested = it.price ? Math.floor(it.price * 0.95) : null;
  box.innerHTML = `<span style="font-size:18px">📊</span>
    <div class="grow"><b>${esc(it.name)}</b><br><span class="ink2">${it.price ? `Today on Tweakers: from <b>${eur(it.price)}</b>` : ""}${
      it.shops ? `${it.price ? " at" : "Sold at"} ${it.shops} shop${it.shops === 1 ? "" : "s"}` : ""} · ${esc(it.spec)}</span></div>
    ${suggested ? `<button type="button" class="small" id="eSuggestTarget">🎯 Target ${eur(suggested, 0)} <span class="muted">(-5%)</span></button>` : ""}
    <a class="btn small" href="https://tweakers.net/pricewatch/${it.id}/" target="_blank" rel="noopener">Tweakers ↗</a>`;
  box.classList.remove("hidden");
  $("eSuggestTarget")?.addEventListener("click", () => { $("editForm").elements.target.value = suggested; toast(`Target set to ${eur(suggested, 0)}`); });
}

$("eName").addEventListener("input", () => { renderSuggestions(); showPicked(null); });
$("eName").addEventListener("focus", () => { if ($("eName").value.trim().length >= 2) renderSuggestions(); });
$("eName").addEventListener("blur", () => setTimeout(closeSuggestions, 150));
$("eName").addEventListener("keydown", (e) => {
  if ($("acList").classList.contains("hidden")) { if (e.key === "ArrowDown") { renderSuggestions(); e.preventDefault(); } return; }
  if (e.key === "ArrowDown") { moveActive(1); e.preventDefault(); }
  else if (e.key === "ArrowUp") { moveActive(-1); e.preventDefault(); }
  else if (e.key === "Enter" && acActive >= 0) { pickSuggestion(acItems[acActive]); e.preventDefault(); }
  else if (e.key === "Escape") { closeSuggestions(); e.preventDefault(); e.stopPropagation(); }
});
$("acList").addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input while clicking
$("acList").addEventListener("click", (e) => { const el = e.target.closest(".ac-item"); if (el) pickSuggestion(acItems[+el.dataset.i]); });
// Picking a category moves you straight to the name, with suggestions for that category.
$("eCat").addEventListener("change", () => { $("eName").focus(); if ($("ePicked").classList.contains("hidden")) renderSuggestions(); });
function addLinkRow(url = "") {
  const row = document.createElement("div");
  row.className = "link-row";
  row.innerHTML = `<input type="url" placeholder="https://www.megekko.nl/product/…" value="${esc(url)}" aria-label="Shop product link"><span class="pill"></span><button type="button" class="ghost" aria-label="Remove link">✕</button>`;
  const input = row.querySelector("input");
  input.addEventListener("input", () => updatePill(row));
  input.addEventListener("paste", (e) => {
    const lines = e.clipboardData.getData("text").split(/\s+/).filter((l) => /^https?:\/\//.test(l));
    if (lines.length > 1) { e.preventDefault(); input.value = lines[0]; updatePill(row); lines.slice(1).forEach((l) => addLinkRow(l)); }
  });
  row.querySelector("button").onclick = () => row.remove();
  $("eLinks").appendChild(row);
  updatePill(row);
  return row;
}
function updatePill(row) {
  const url = row.querySelector("input").value.trim(), pill = row.querySelector(".pill");
  if (!url) { pill.innerHTML = ""; return; }
  const info = shopInfo(url);
  if (!info) { pill.innerHTML = `<span class="badge crit">Not a link</span>`; return; }
  const map = { ok: ["good", "✓"], blocked: ["crit", "✕"], untested: ["neutral", "?"] };
  const [cls, ic] = map[info.github] || map.untested;
  const tip = info.github === "ok" ? "Works with the tracker" : info.github === "blocked" ? "This shop blocks GitHub's servers — prices won't be read" : "Not tested yet — the first check will tell";
  pill.innerHTML = `<span class="badge ${cls}" title="${tip}">${ic} ${esc(info.name)}</span>`;
}
function renderFindLinks() {
  const q = $("editForm").elements.name.value.trim();
  const ok = Object.entries(S.shops).filter(([, s]) => s.github === "ok" && !s.excl_vat);
  $("eFind").innerHTML = q
    ? ok.map(([d, s]) => `<a href="https://www.google.com/search?q=${encodeURIComponent(`site:${d} ${q}`)}" target="_blank" rel="noopener">🔎 ${esc(s.name)}</a>`).join("")
      + `<a href="https://tweakers.net/pricewatch/zoeken/?keyword=${encodeURIComponent(q)}" target="_blank" rel="noopener">Compare on Tweakers ↗</a>`
    : `<span class="small muted">Type a name above first.</span>`;
}
$("editForm").elements.name.addEventListener("input", renderFindLinks);
$("eAddLink").onclick = () => addLinkRow().querySelector("input").focus();

$("editForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const urls = [...$("eLinks").querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
  if (urls.some((u) => !shopInfo(u))) return toast("One of the links isn't a valid web address");
  const domains = urls.map((u) => shopInfo(u).name);
  if (new Set(domains).size !== domains.length) return toast("You added the same shop twice — keep one link per shop");
  if (!urls.length) return toast("Add at least one shop link");
  const part = { name: f.name.value.trim(), category: f.category.value, target_price: f.target.value ? Math.round(+f.target.value * 100) / 100 : null, shops: urls.map((url) => ({ url })) };
  await saveConfig((cfg) => {
    if (editingId) Object.assign(cfg.products.find((p) => p.id === editingId), part);
    else {
      let id = slug(part.name), n = 2;
      while (cfg.products.some((p) => p.id === id)) id = `${slug(part.name)}-${n++}`;
      cfg.products.push({ id, ...part });
    }
  }, `${editingId ? "Update" : "Add"} ${part.name}`, true);
  editor.close();
});
$("eDelete").onclick = async () => {
  const p = S.config.products.find((x) => x.id === editingId);
  if (!p || !confirm(`Stop tracking "${p.name}" and delete its price history?`)) return;
  await saveConfig((cfg) => { cfg.products = cfg.products.filter((x) => x.id !== editingId); }, `Remove ${p.name}`, false);
  editor.close();
};

// Read-modify-write products.json through the GitHub API; a push to products.json starts a check automatically.
async function saveConfig(mutate, message, expectRun) {
  const btns = document.querySelectorAll("#editor button, #thSave");
  btns.forEach((b) => (b.disabled = true));
  try {
    const { data, sha } = await readFile("products.json", null);
    if (!data || !sha) throw new Error("Couldn't read products.json from GitHub");
    mutate(data);
    await gh(`/contents/products.json`, { method: "PUT", body: JSON.stringify({ message, sha, branch: "main", content: b64encode(JSON.stringify(data, null, 2) + "\n") }) });
    S.config = data;
    toast(expectRun ? "Saved ✓ Checking prices… this takes about a minute" : "Saved ✓", 4000);
    render();
    if (expectRun) watchRun(new Date(Date.now() - 5000).toISOString());
  } catch (err) { toast(err.message, 5000); }
  finally { btns.forEach((b) => (b.disabled = false)); }
}

// ---------- checks ----------
let watching = null;
function watchRun(since) {
  clearInterval(watching);
  let tries = 0;
  const tick = async () => {
    tries++;
    await refreshWorkflowState();
    const mine = S.run && S.run.created_at >= since;
    renderStatus();
    if ((mine && S.run.status === "completed") || tries > 60) {
      clearInterval(watching);
      watching = null;
      await load();
      if (mine) toast(S.run.conclusion === "success" ? "Prices updated ✓" : "Check finished with problems — see the banner", 4000);
    }
  };
  watching = setInterval(tick, 6000);
  tick();
}
async function checkNow() {
  if (!token()) { window.open(`${GH}/actions/workflows/${WORKFLOW}`, "_blank", "noopener"); return; }
  try {
    const since = new Date(Date.now() - 5000).toISOString();
    await gh(`/actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
    S.run = { status: "queued", created_at: since };
    renderStatus();
    toast("Check started — this takes about a minute");
    watchRun(since);
  } catch (e) { toast(e.message, 5000); }
}
async function enableWorkflow() {
  try { await gh(`/actions/workflows/${WORKFLOW}/enable`, { method: "PUT" }); toast("Automatic checks turned on ✓"); await load(); }
  catch (e) { toast(e.message, 5000); }
}

// ---------- settings ----------
function openSettings(focusToken = false, focusId = null) {
  if (detail.open) detail.close();
  if (editor.open) editor.close();
  go("settings");
  setTimeout(() => {
    const el = focusId ? $(focusId) : focusToken && !token() ? $("tokenInput") : null;
    if (el) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); }
  }, 50);
}
function renderSettings() {
  document.querySelectorAll(".repoName").forEach((el) => (el.textContent = REPO));
  const ok = token() && !S.tokenError;
  $("ghState").innerHTML = ok ? `<span class="badge good">✓ Connected to ${esc(REPO)}</span>`
    : token() ? `<span class="badge crit">✕ Not working</span>` : `<span class="badge neutral">Not connected</span>`;
  $("tokenHelp").open = !ok;
  $("tokenClear").classList.toggle("hidden", !token());
  $("tokenSave").textContent = token() ? "Replace token" : "Connect";
  if (document.activeElement !== $("topicInput")) $("topicInput").value = store.get("topic") || "";
  $("phoneState").innerHTML = store.get("alertsTested") === "1" ? `<span class="badge good">✓ Test sent</span>`
    : store.get("topic") ? `<span class="badge neutral">Send a test to confirm</span>` : `<span class="badge neutral">Not set up</span>`;
  renderQr();
  const th = S.config.settings?.drop_threshold_pct ?? 5;
  if (document.activeElement !== $("thInput")) { $("thInput").value = th; $("thVal").textContent = th; }
  $("thInput").disabled = !token();
  const theme = store.get("theme") || "system";
  $("themeSeg").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.themeOpt === theme));

  const last = Object.values(S.latest).map((x) => x.checked_at).sort().pop();
  $("dataSources").innerHTML = `
    <dt>Shop prices</dt><dd>Checked every hour on GitHub · last ${ago(last)}</dd>
    <dt>Deals of the day</dt><dd>${S.deals?.generated ? `Collected daily on your PC · last ${ago(S.deals.generated)}` : "Not collected yet"}</dd>
    <dt>Part suggestions</dt><dd>Rebuilt every 4 weeks on your PC from Tweakers</dd>
    <dt>Known shops</dt><dd>${Object.values(S.shops).filter((s) => s.github === "ok").map((s) => esc(s.name)).join(", ")}</dd>`;
  $("repoLink").href = GH;
  $("actionsLink").href = `${GH}/actions/workflows/${WORKFLOW}`;
  $("readmeLink").href = `${GH}#readme`;
}
function applyTheme(t) {
  store.set("theme", t === "system" ? null : t);
  if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  render();
}
$("themeSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-theme-opt]"); if (b) applyTheme(b.dataset.themeOpt); });
$("tokenSave").onclick = async () => {
  const t = $("tokenInput").value.trim();
  if (!t) return toast("Paste your token first");
  const old = token();
  store.set("token", t);
  try {
    const repo = await gh("");
    if (!repo.permissions?.push) throw new Error("This token can read but not write — give it Contents: Read and write");
    $("tokenInput").value = "";
    toast("Connected ✓");
    await load();
  } catch (e) { store.set("token", old); toast(e.message, 5000); }
};
$("tokenClear").onclick = () => { store.set("token", null); toast("Disconnected"); load(); };
function renderQr() {
  const topic = $("topicInput").value.trim();
  $("qrWrap").classList.toggle("hidden", !topic || !window.QRCode);
  $("qr").innerHTML = "";
  if (topic && window.QRCode) new QRCode($("qr"), { text: `${S.config.settings?.ntfy_server || "https://ntfy.sh"}/${topic}`, width: 132, height: 132 });
}
$("topicInput").addEventListener("input", () => { store.set("topic", $("topicInput").value.trim() || null); renderQr(); });
$("testBtn").onclick = async () => {
  const topic = $("topicInput").value.trim();
  if (!topic) return toast("Enter your topic first");
  try {
    const r = await fetch(S.config.settings?.ntfy_server || "https://ntfy.sh", { method: "POST", body: JSON.stringify({ topic, title: "PC Price Tracker", message: "Test notification — alerts are working 🎉", tags: ["moneybag"] }) });
    if (!r.ok) throw new Error();
    store.set("alertsTested", "1");
    toast("Sent! Check your phone 📱");
    render();
  } catch { toast("Couldn't reach ntfy — check the topic and your connection"); }
};
$("thInput").addEventListener("input", () => ($("thVal").textContent = $("thInput").value));
$("thSave").onclick = () => saveConfig((cfg) => { cfg.settings = { ...cfg.settings, drop_threshold_pct: +$("thInput").value }; }, `Set alert threshold to ${$("thInput").value}%`, false);

// ---------- browse parts: the catalog with Tweakers-style filters per category ----------
// Filter values come from catalog.json (tools/facets.py reads them from Tweakers' spec lines).
// Order: "num" = by the number in the value (sizes, speeds), "alpha" = natural A→Z, "count" = most products first.
const FACETS = {
  GPU: [["brand", "Chip maker", "count"], ["gpu", "GPU", "alpha"], ["vram", "Video memory", "num"], ["mem", "Memory type", "alpha"], ["maker", "Brand", "count"]],
  CPU: [["brand", "Brand", "count"], ["family", "Family", "alpha"], ["socket", "Socket", "alpha"], ["cores", "Cores", "num"], ["pack", "Packaging", "count"]],
  Motherboard: [["socket", "Socket", "alpha"], ["chipset", "Chipset", "alpha"], ["form", "Form factor", "count"], ["wifi", "Wi-Fi", "count"], ["maker", "Brand", "count"]],
  RAM: [["type", "Type", "alpha"], ["size", "Total capacity", "num"], ["kit", "Modules", "count"], ["speed", "Speed", "num"], ["form", "Desktop / laptop", "count"], ["maker", "Brand", "count"]],
  Storage: [["size", "Capacity", "num"], ["iface", "Interface", "alpha"], ["form", "Form factor", "count"], ["maker", "Brand", "count"]],
  PSU: [["watt", "Wattage", "num"], ["eff", "Efficiency", "count"], ["modular", "Modularity", "count"], ["maker", "Brand", "count"]],
  Case: [["type", "Type", "count"], ["color", "Colour", "count"], ["maker", "Brand", "count"]],
  Cooler: [["fan", "Fan size", "num"], ["maker", "Brand", "count"]],
  Monitor: [["size", "Screen size", "num"], ["res", "Resolution", "count"], ["hz", "Refresh rate", "num"], ["panel", "Panel", "count"], ["maker", "Brand", "count"]],
};
const BROWSE_CATS = Object.keys(FACETS);
const NOUNS = { GPU: "graphics cards", CPU: "processors", Motherboard: "motherboards", RAM: "RAM kits", Storage: "SSDs",
                PSU: "power supplies", Case: "cases", Cooler: "CPU coolers", Monitor: "monitors" };
const SHOWN_OPTIONS = 6, PAGE = 40;
S.browse = { cat: null, sel: {}, min: null, max: null, q: "", sort: "shops", limit: PAGE, open: {} };

// "≤ 256 GB" < "500 GB" < "1 TB" < "8 TB+"; "Up to 23\"" < "24–25\""; plain text keeps its count order.
function numKey(v) {
  const m = String(v).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return Infinity;
  let n = parseFloat(m[1].replace(",", "."));
  if (/\bTB\b/.test(v)) n *= 1000;
  if (/^(≤|Up to)/.test(v)) n -= 0.5;
  if (/(\+|and up)/.test(v)) n += 0.5;
  return n;
}

function matches(it, b, skip = null) {
  if (b.min != null && (it.price ?? Infinity) < b.min) return false;
  if (b.max != null && (it.price ?? 0) > b.max) return false;
  for (const [key, set] of Object.entries(b.sel)) {
    if (key !== skip && set.size && !set.has(it.facets[key])) return false;
  }
  if (b.tokens?.length && !b.tokens.every((t) => it.text.includes(t) || it.compact.includes(t))) return false;
  return true;
}

async function renderBrowse() {
  const cat = BROWSE_CATS.includes(route().arg) ? route().arg : "GPU";
  const b = S.browse;
  if (b.cat !== cat) Object.assign(S.browse, { cat, sel: {}, min: null, max: null, q: "", limit: PAGE, open: {} });
  $("browseCats").innerHTML = BROWSE_CATS.map((c) => `<a class="btn chip" href="#/browse/${c}" aria-pressed="${c === cat}">${CATS[c]} ${c}</a>`).join("");
  if (document.activeElement !== $("browseQ")) $("browseQ").value = b.q;
  $("browseSort").value = b.sort;
  if (!catalog) {
    $("results").innerHTML = `<div class="quiet">Loading ${esc(cat)} catalog…</div>`;
    loadCatalog();
    await catalogPromise;
    if (!catalog) { $("results").innerHTML = `<div class="quiet">The part catalog couldn't be loaded.</div>`; return; }
    if (currentView !== "browse") return;
  }
  b.tokens = norm(b.q).split(" ").filter(Boolean);
  const items = catalog.filter((it) => it.cat === cat);
  const tracked = new Set(S.config.products.map((p) => p.name.toLowerCase()));

  // Facets: each option's count respects every *other* active filter, like Tweakers.
  const groups = FACETS[cat].map(([key, label, order]) => {
    const pool = items.filter((it) => matches(it, b, key));
    const counts = {};
    for (const it of pool) { const v = it.facets[key]; if (v) counts[v] = (counts[v] || 0) + 1; }
    for (const v of b.sel[key] || []) counts[v] ??= 0;
    let opts = Object.entries(counts);
    if (order === "num") opts.sort((x, y) => numKey(x[0]) - numKey(y[0]));
    else if (order === "alpha") opts.sort((x, y) => x[0].localeCompare(y[0], "en", { numeric: true }));
    else opts.sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    return { key, label, opts };
  }).filter((g) => g.opts.length > 1 || (b.sel[g.key]?.size));

  const prices = items.map((it) => it.price).filter(Boolean);
  const lo = Math.floor(Math.min(...prices)), hi = Math.ceil(Math.max(...prices));
  $("facets").innerHTML = `<fieldset class="facet"><legend>Price</legend>
      <div class="price-range"><label>Min<input type="number" min="0" inputmode="numeric" id="pMin" placeholder="€ ${lo}" value="${b.min ?? ""}"></label>
      <span class="muted">–</span><label>Max<input type="number" min="0" inputmode="numeric" id="pMax" placeholder="€ ${hi}" value="${b.max ?? ""}"></label></div></fieldset>`
    + groups.map((g) => {
      const sel = b.sel[g.key] || new Set();
      const all = b.open[g.key] || g.opts.length <= SHOWN_OPTIONS + 2;
      const opts = all ? g.opts : g.opts.filter(([v], i) => i < SHOWN_OPTIONS || sel.has(v));
      return `<fieldset class="facet"><legend>${esc(g.label)}</legend>
        ${opts.map(([v, n]) => `<label class="opt ${n === 0 && !sel.has(v) ? "zero" : ""}">
          <input type="checkbox" data-facet="${g.key}" value="${esc(v)}" ${sel.has(v) ? "checked" : ""}><span>${esc(v)}</span><span class="n">${n}</span></label>`).join("")}
        ${all ? "" : `<button class="link-btn" data-more="${g.key}">Show all ${g.opts.length}</button>`}</fieldset>`;
    }).join("");

  // Active filters as removable chips.
  const active = [];
  for (const [key, set] of Object.entries(b.sel)) for (const v of set) active.push({ key, v, label: `${FACETS[cat].find((f) => f[0] === key)[1]}: ${v}` });
  if (b.min != null || b.max != null) active.push({ key: "price", label: `Price: ${b.min != null ? eur(b.min, 0) : "€ 0"} – ${b.max != null ? eur(b.max, 0) : "any"}` });
  $("activeFilters").innerHTML = active.length
    ? active.map((a) => `<button class="chip on" data-clear="${a.key}" data-v="${esc(a.v ?? "")}">${esc(a.label)} ✕</button>`).join("") + `<button class="link-btn" data-clear="all">Clear all</button>` : "";
  $("filterCount").textContent = active.length || "";

  const sorters = { shops: (x, y) => y.shops - x.shops || (x.price ?? 1e9) - (y.price ?? 1e9), price: (x, y) => (x.price ?? 1e9) - (y.price ?? 1e9),
                    "-price": (x, y) => (y.price ?? 0) - (x.price ?? 0), name: (x, y) => x.name.localeCompare(y.name, "en", { numeric: true }) };
  const found = items.filter((it) => matches(it, b)).sort(sorters[b.sort]);
  $("resultCount").textContent = `${found.length.toLocaleString("nl-NL")} of ${items.length.toLocaleString("nl-NL")} ${NOUNS[cat]}`;
  $("browseSub").textContent = `Filter ${items.length.toLocaleString("nl-NL")} ${NOUNS[cat]} sold in the Netherlands by what matters for this category, then add the one you want.`;
  S.browseShown = found.slice(0, b.limit);
  const chips = (it) => FACETS[cat].filter(([k]) => k !== "maker" && it.facets[k]).slice(0, 4).map(([k]) => `<span class="spec-chip">${esc(it.facets[k])}</span>`).join("");
  $("results").innerHTML = found.length ? `<div class="card result-list">${S.browseShown.map((it, i) => `<div class="res">
      <div class="res-main"><a class="res-name" href="https://tweakers.net/pricewatch/${it.id}/" target="_blank" rel="noopener">${esc(it.name)}</a>
        <div class="spec-chips">${chips(it)}</div>
        <div class="small muted res-spec">${esc(it.spec)}</div></div>
      <div class="res-price">${it.price ? `<span class="small muted">from</span> <b>${eur(it.price)}</b>` : `<span class="muted">–</span>`}<div class="small muted">${it.shops} shop${it.shops === 1 ? "" : "s"}</div></div>
      <div class="res-act">${tracked.has(it.name.toLowerCase()) ? `<span class="badge good">✓ In your build</span>`
        : token() ? `<button class="primary small-btn" data-add="${i}"><svg class="ic sm"><use href="#i-plus"/></svg>Add</button>` : ""}</div>
    </div>`).join("")}</div>${found.length > b.limit ? `<div class="deal-more"><button data-page>Show ${Math.min(PAGE, found.length - b.limit)} more</button></div>` : ""}`
    : `<div class="card empty"><div style="font-size:32px">🔎</div><h2>Nothing matches</h2><p class="muted">Try removing a filter.</p><button data-clear="all">Clear all filters</button></div>`;
}

// Events (one listener each, delegated).
$("facets").addEventListener("change", (e) => {
  const b = S.browse, cb = e.target.closest("[data-facet]");
  if (cb) {
    const set = (b.sel[cb.dataset.facet] ??= new Set());
    if (cb.checked) set.add(cb.value); else set.delete(cb.value);
  } else if (e.target.id === "pMin" || e.target.id === "pMax") {
    const v = e.target.value === "" ? null : Math.max(0, +e.target.value);
    if (e.target.id === "pMin") b.min = v; else b.max = v;
  } else return;
  b.limit = PAGE;
  renderBrowse();
});
$("facets").addEventListener("click", (e) => { const m = e.target.closest("[data-more]"); if (m) { S.browse.open[m.dataset.more] = true; renderBrowse(); } });
document.querySelector('[data-view="browse"]').addEventListener("click", (e) => {
  const b = S.browse;
  const clear = e.target.closest("[data-clear]");
  if (clear) {
    const k = clear.dataset.clear;
    if (k === "all") Object.assign(b, { sel: {}, min: null, max: null, q: "" });
    else if (k === "price") Object.assign(b, { min: null, max: null });
    else b.sel[k]?.delete(clear.dataset.v);
    b.limit = PAGE; renderBrowse(); return;
  }
  if (e.target.closest("[data-page]")) { b.limit += PAGE; renderBrowse(); return; }
  const add = e.target.closest("[data-add]");
  if (add) { const it = S.browseShown[+add.dataset.add]; openEditor(null, { name: it.name, category: it.cat, target: null, picked: it }); }
});
let browseTimer;
$("browseQ").addEventListener("input", (e) => { clearTimeout(browseTimer); browseTimer = setTimeout(() => { S.browse.q = e.target.value; S.browse.limit = PAGE; renderBrowse(); }, 150); });
$("browseSort").onchange = (e) => { S.browse.sort = e.target.value; renderBrowse(); };
// From the Add part form: browse the category that's selected there.
$("eBrowse").addEventListener("click", (e) => { e.preventDefault(); const c = $("eCat").value; editor.close(); go("browse", BROWSE_CATS.includes(c) ? c : "GPU"); });
// On phones the filter panel starts folded so the results are visible.
if (matchMedia("(max-width: 900px)").matches) $("filtersBox").open = false;

// ---------- wiring ----------
$("addBtn").onclick = () => openEditor();
$("hideSetup").onclick = () => { store.set("hideSetup", "1"); render(); };
$("sort").onchange = (e) => { S.sort = e.target.value; store.set("sort", S.sort); render(); };
document.querySelector('[data-view="deals"]').addEventListener("click", (e) => {
  const b = e.target.closest("[data-track]");
  if (!b) return;
  const d = S.dealList[+b.dataset.track];
  openEditor(null, { name: d.name, category: d.cat, target: d.price, picked: { ...d, shops: null } });
});
$("alertFilter").onchange = (e) => { S.alertPart = e.target.value; renderAlertsView(); };
$("chips").addEventListener("click", (e) => { const c = e.target.closest("[data-cat]"); if (c) { S.cat = c.dataset.cat; render(); } });
document.querySelectorAll("[data-layout]").forEach((b) => b.addEventListener("click", () => { S.layout = b.dataset.layout; store.set("layout", S.layout); render(); }));
document.querySelectorAll(".check-btn").forEach((b) => b.addEventListener("click", checkNow));
// Parts open through the address (#/build/<id>), so the browser's back button closes the detail again.
$("parts").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  if (edit) { e.stopPropagation(); openEditor(edit.dataset.edit); return; }
  const c = e.target.closest(".part, .brow[data-id]");
  if (c) go("build", c.dataset.id);
});
$("parts").addEventListener("keydown", (e) => {
  const c = e.target.closest(".part, .brow[data-id]");
  if (c && e.target === c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go("build", c.dataset.id); }
});
detail.addEventListener("close", () => { if (route().arg) history.replaceState(null, "", "#/build"); });
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
window.addEventListener("hashchange", onRoute);

onRoute();
load();
setInterval(() => { if (!document.hidden && !watching) load(); }, 5 * 60000);
