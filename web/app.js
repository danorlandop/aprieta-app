(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const state = {
    config: null,
    origin: null,        // {lat, lon} the current results are measured from
    me: null,            // user's real location, if shared
    bathrooms: [],
    stores: [],          // nearest places to buy fresh underwear
    filters: new Set(),
    activeId: null,
    pending: null,       // {kind, placeId} for the checkout in progress
    demoCheckoutId: null,
  };
  const LAST_KEY = "aprieta:last";

  // ---------- helpers ----------

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function money(cents) {
    const cur = (state.config?.currency || "usd").toUpperCase();
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(cents / 100);
  }
  function dist(m) {
    return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
  }
  function walk(m) {
    const min = Math.max(1, Math.round(m / 80));
    return `${min} min walk`;
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3200);
  }

  function directionsUrl(b) {
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
    return isApple
      ? `https://maps.apple.com/?daddr=${b.lat},${b.lon}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking`;
  }

  // ---------- map ----------

  const last = load(LAST_KEY);
  const map = L.map("map", { zoomControl: false, attributionControl: true })
    .setView(last ? [last.lat, last.lon] : [40.4168, -3.7038], last ? 15 : 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const storeLayer = L.layerGroup().addTo(map);
  let meMarker = null;
  const markers = new Map();

  let ignoreMove = false;
  map.on("moveend", () => {
    if (ignoreMove) { ignoreMove = false; return; }
    if (!state.origin) { $("#search-area").hidden = false; return; }
    const c = map.getCenter();
    const moved = map.distance(c, [state.origin.lat, state.origin.lon]);
    $("#search-area").hidden = moved < 400;
  });

  function flyTo(lat, lon, zoom) {
    ignoreMove = true;
    map.setView([lat, lon], zoom ?? Math.max(map.getZoom(), 15));
  }

  function pinIcon(b, rank) {
    const cls = ["pin", b.locked ? "pin-locked" : "", b.id === state.activeId ? "is-active" : ""].join(" ");
    return L.divIcon({ className: "", html: `<div class="${cls}"><span>${rank}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30] });
  }

  function renderMarkers(list) {
    markerLayer.clearLayers();
    markers.clear();
    list.forEach((b, i) => {
      const lat = b.locked ? b.approx_lat : b.lat;
      const lon = b.locked ? b.approx_lon : b.lon;
      if (b.locked) {
        // Locked bathrooms only show a fuzzy area, never the exact spot.
        L.circle([lat, lon], { radius: b.approx_radius_m, color: "#8a756c", weight: 1, dashArray: "4 4", fillOpacity: 0.06 }).addTo(markerLayer);
      }
      const m = L.marker([lat, lon], { icon: pinIcon(b, i + 1) }).addTo(markerLayer);
      m.on("click", () => focusCard(b.id, true));
      markers.set(b.id, { marker: m, bathroom: b, rank: i + 1 });
    });
  }

  function setMe(lat, lon) {
    state.me = { lat, lon };
    const icon = L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
    if (meMarker) meMarker.setLatLng([lat, lon]);
    else meMarker = L.marker([lat, lon], { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  }

  // ---------- search ----------

  function showStatus(html) {
    $("#status").innerHTML = html;
    $("#status").hidden = false;
  }

  function fitNearest(lat, lon) {
    const pts = visible().slice(0, 3).map((b) => (b.locked ? [b.approx_lat, b.approx_lon] : [b.lat, b.lon]));
    if (!pts.length) return;
    ignoreMove = true;
    map.fitBounds(L.latLngBounds([[lat, lon], ...pts]), { padding: [60, 60], maxZoom: 17 });
  }

  async function search(lat, lon, { fit = false } = {}) {
    $("#welcome").hidden = true;
    $("#search-area").hidden = true;
    showStatus('<div class="spinner"></div>Looking for bathrooms…');
    try {
      const radius = Math.min(3000, Math.max(800, Math.round(map.getBounds().getNorthEast().distanceTo(map.getCenter()))));
      const data = await api(`/api/bathrooms?lat=${lat}&lon=${lon}&radius=${radius}`);
      state.origin = { lat, lon };
      state.bathrooms = data.bathrooms;
      save(LAST_KEY, { lat, lon });
      $("#status").hidden = true;
      $("#results").hidden = false;
      render();
      if (fit) fitNearest(lat, lon);
      loadStores(lat, lon);
    } catch (e) {
      showStatus(`Couldn’t load bathrooms. ${esc(e.message)}<br><br><button class="pill-btn" id="retry">Try again</button>`);
      $("#retry").onclick = () => search(lat, lon);
    }
  }

  async function loadStores(lat, lon) {
    try {
      state.stores = (await api(`/api/stores?lat=${lat}&lon=${lon}`)).stores;
    } catch {
      state.stores = [];
    }
    renderStores();
  }

  function locate() {
    if (!navigator.geolocation) {
      toast("Your browser can’t share location. Move the map instead.");
      $("#search-area").hidden = false;
      return;
    }
    $("#find").disabled = true;
    $("#welcome").hidden = true;
    showStatus('<div class="spinner"></div>Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $("#find").disabled = false;
        const { latitude: lat, longitude: lon } = pos.coords;
        setMe(lat, lon);
        flyTo(lat, lon, 16);
        search(lat, lon, { fit: true });
      },
      () => {
        $("#find").disabled = false;
        $("#status").hidden = true;
        $("#welcome").hidden = state.bathrooms.length > 0;
        toast("Location blocked. Move the map and tap “Search this area”.");
        $("#search-area").hidden = false;
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }

  // ---------- rendering ----------

  function visible() {
    return state.bathrooms.filter((b) => {
      if (state.filters.has("free") && b.free !== true) return false;
      if (state.filters.has("wheelchair") && b.wheelchair !== true) return false;
      if (state.filters.has("public") && b.customers_only) return false;
      return true;
    });
  }

  function badges(b) {
    const out = [];
    if (b.free === true) out.push('<span class="badge badge-good">Free</span>');
    if (b.free === false) out.push('<span class="badge">Paid entry</span>');
    if (b.wheelchair === true) out.push('<span class="badge badge-good">♿ Accessible</span>');
    if (b.changing_table === true) out.push('<span class="badge">Baby changing</span>');
    if (b.unisex === true) out.push('<span class="badge">All-gender</span>');
    if (b.customers_only) out.push('<span class="badge">Customers only</span>');
    if (b.hours) out.push(`<span class="badge">🕒 ${esc(b.hours)}</span>`);
    return out.length ? `<div class="badges">${out.join("")}</div>` : "";
  }

  const lockSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2.2" fill="none"/></svg>';

  function cardHtml(b, rank) {
    const head = `
      <div class="card-top">
        <span class="card-rank">${rank}</span>
        <span class="card-dist">${dist(b.distance_m)}</span>
        <span class="card-walk">${walk(b.distance_m)}</span>
        <span class="card-kind">${esc(b.kind)}</span>
      </div>`;
    if (b.locked) {
      return `${head}
        <div class="redacted">${lockSvg}
          <div style="flex:1;display:grid;gap:5px"><div class="bar" style="width:70%"></div><div class="bar" style="width:45%"></div></div>
        </div>
        ${badges(b)}
        <div class="card-actions">
          <button class="big-btn" data-unlock="${esc(b.id)}">💩 Unlock address · ${money(state.config.single_cents)}</button>
        </div>`;
    }
    return `${head}
      <div class="card-name">${esc(b.name)}</div>
      <div class="card-addr">${b.address ? esc(b.address) : `${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}`}</div>
      ${b.notes ? `<div class="card-notes">${esc(b.notes)}</div>` : ""}
      ${badges(b)}
      <div class="card-actions">
        <a class="big-btn" href="${directionsUrl(b)}" target="_blank" rel="noopener">Directions</a>
        <button class="btn-secondary" data-show="${esc(b.id)}">Show on map</button>
      </div>`;
  }

  function storeCardHtml(st) {
    return `
      <div class="card-top">
        <span class="card-rank card-rank-store" aria-hidden="true">🩲</span>
        <span class="card-dist">${dist(st.distance_m)}</span>
        <span class="card-walk">${walk(st.distance_m)}</span>
        <span class="card-kind">${esc(st.kind)}</span>
      </div>
      <div class="card-name">${esc(st.name)}</div>
      <div class="card-addr">${st.address ? esc(st.address) : `${st.lat.toFixed(5)}, ${st.lon.toFixed(5)}`}</div>
      ${st.hours ? `<div class="badges"><span class="badge">🕒 ${esc(st.hours)}</span></div>` : ""}
      <div class="card-actions">
        <a class="big-btn" href="${directionsUrl(st)}" target="_blank" rel="noopener">Directions</a>
      </div>`;
  }

  function renderStores() {
    const open = state.stores.filter((st) => !st.locked);
    $("#boxers-section").hidden = !open.length;
    $("#boxers-list").innerHTML = open.map((st) => `<li class="card card-store">${storeCardHtml(st)}</li>`).join("");
    storeLayer.clearLayers();
    open.forEach((st) => L.marker([st.lat, st.lon], {
      icon: L.divIcon({ className: "", html: '<div class="pin pin-store"><span>🩲</span></div>', iconSize: [30, 30], iconAnchor: [15, 30] }),
    }).addTo(storeLayer));
    const nearest = state.stores[0];
    $("#pw-addon").hidden = !nearest || nearest.locked === false;
    $("#pw-toolate").hidden = !nearest || nearest.locked === false;
    if (nearest) $("#addon-desc").textContent = `${nearest.kind}, ${dist(nearest.distance_m)}.`;
  }

  function render() {
    const list = visible();
    const n = list.length;
    $("#results-title").textContent = n ? `${n} bathroom${n === 1 ? "" : "s"} nearby` : "Nearby";
    $("#list").innerHTML = n
      ? list.map((b, i) => `<li class="card${b.id === state.activeId ? " is-active" : ""}" data-id="${esc(b.id)}">${cardHtml(b, i + 1)}</li>`).join("")
      : `<li class="empty">${state.bathrooms.length ? "Nothing matches those filters." : "No bathrooms mapped here yet. Try zooming out and searching again."}</li>`;
    renderMarkers(list);

    const hasPass = !!state.config.pass_expires_at;
    const lockedCount = list.filter((b) => b.locked).length;
    $("#pass-upsell").hidden = hasPass || lockedCount < 2;
    $("#upsell-text").textContent = `Unlock all ${lockedCount} here, plus everywhere else, for ${state.config.pass_hours} hours: ${money(state.config.pass_cents)}.`;

    // Unlocked bathrooms without a mapped address get one looked up on demand.
    list.filter((b) => !b.locked && !b.address && !b._looked).forEach(fetchDetail);
  }

  async function fetchDetail(b) {
    b._looked = true;
    try {
      const q = state.origin ? `?lat=${state.origin.lat}&lon=${state.origin.lon}` : "";
      const full = await api(`/api/bathrooms/${encodeURIComponent(b.id)}${q}`);
      Object.assign(b, full);
      render();
    } catch {}
  }

  function focusCard(id, scroll) {
    state.activeId = id;
    document.querySelectorAll(".card").forEach((el) => el.classList.toggle("is-active", el.dataset.id === id));
    markers.forEach(({ marker, bathroom, rank }) => marker.setIcon(pinIcon(bathroom, rank)));
    if (scroll) document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderPassChip() {
    const chip = $("#pass-chip");
    const exp = state.config.pass_expires_at;
    if (!exp) { chip.hidden = true; return; }
    const hrs = Math.max(0, (exp * 1000 - Date.now()) / 3600000);
    chip.textContent = hrs >= 1 ? `Pass · ${Math.floor(hrs)}h left` : `Pass · ${Math.ceil(hrs * 60)}m left`;
    chip.hidden = false;
  }

  // ---------- paywall ----------

  function openPaywall(placeId) {
    const b = state.bathrooms.find((x) => x.id === placeId);
    state.pending = { placeId };
    $("#addon-boxers").checked = false;
    $("#pw-summary").textContent = b
      ? `${b.kind}, ${dist(b.distance_m)} away (${walk(b.distance_m)}).`
      : `Unlock every address for ${state.config.pass_hours} hours.`;
    $('.pw-option[data-kind="single"]').hidden = !b;
    showPwStep("choose");
    $("#paywall").hidden = false;
  }
  function closePaywall() {
    $("#paywall").hidden = true;
    state.pending = null;
    state.demoCheckoutId = null;
  }
  function showPwStep(step) {
    $("#pw-choose").hidden = step !== "choose";
    $("#pw-demo").hidden = step !== "demo";
    $("#pw-boxers").hidden = step !== "boxers";
    $("#pw-busy").hidden = step !== "busy";
  }

  async function startCheckout(kind) {
    const placeId = kind === "single" ? state.pending?.placeId : null;
    state.pending = { kind, placeId };
    $("#pw-busy-text").textContent = "Opening secure checkout…";
    showPwStep("busy");
    try {
      const here = state.me || state.origin;
      const boxers = kind !== "boxers" && $("#addon-boxers").checked;
      const res = await api("/api/checkout", {
        method: "POST",
        body: { kind, place_id: placeId, boxers, lat: here?.lat, lon: here?.lon },
      });
      if (res.demo) {
        state.demoCheckoutId = res.checkout_id;
        $("#demo-pay").textContent = `Pay ${money(res.amount_cents)}`;
        showPwStep("demo");
      } else {
        save("aprieta:pending", state.pending);
        location.href = res.url;
      }
    } catch (e) {
      toast(e.message);
      showPwStep(kind === "boxers" ? "boxers" : "choose");
    }
  }

  function showTooLate() {
    $("#pw-boxers-list").innerHTML = state.stores.map((st) => `
      <li><span class="pw-store-kind">${esc(st.kind)}</span><span class="pw-store-dist">${dist(st.distance_m)} · ${walk(st.distance_m)}</span></li>`).join("");
    $("#buy-boxers").textContent = `Show me where · ${money(state.config.boxers_cents)}`;
    showPwStep("boxers");
  }

  async function confirmCheckout(sessionId, pending) {
    const res = await api("/api/checkout/confirm", { method: "POST", body: { session_id: sessionId } });
    state.config = await api("/api/config");
    renderPassChip();
    toast(res.kind === "boxers" ? "Fresh boxers are close. Go, go, go 🩲"
      : res.kind === "pass" ? "Pass active. Every address is unlocked 🎉"
      : res.boxers ? "Unlocked, with backup boxers nearby 🩲" : "Unlocked! Here’s your bathroom.");
    const origin = state.origin || load(LAST_KEY);
    if (origin) {
      await search(origin.lat, origin.lon);
      await loadStores(origin.lat, origin.lon);
      if (res.kind === "boxers") {
        const first = state.stores.find((st) => !st.locked);
        if (first) flyTo(first.lat, first.lon, 16);
        $("#boxers-section").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      const id = res.place_id || pending?.placeId;
      if (id) {
        const b = state.bathrooms.find((x) => x.id === id);
        if (b && !b.locked) { flyTo(b.lat, b.lon, 17); focusCard(id, true); }
      }
    }
  }

  // ---------- events ----------

  $("#find").onclick = locate;
  $("#locate").onclick = locate;
  $("#search-area").onclick = () => {
    const c = map.getCenter();
    search(c.lat, c.lng);
  };

  document.querySelectorAll(".filter").forEach((btn) => {
    btn.onclick = () => {
      const f = btn.dataset.filter;
      state.filters.has(f) ? state.filters.delete(f) : state.filters.add(f);
      btn.setAttribute("aria-pressed", state.filters.has(f));
      render();
    };
  });

  $("#list").addEventListener("click", (e) => {
    const unlock = e.target.closest("[data-unlock]");
    if (unlock) return openPaywall(unlock.dataset.unlock);
    const show = e.target.closest("[data-show]");
    if (show) {
      const b = state.bathrooms.find((x) => x.id === show.dataset.show);
      if (b) { flyTo(b.lat, b.lon, 17); focusCard(b.id, false); }
      return;
    }
    const card = e.target.closest(".card");
    if (card && !e.target.closest("a")) {
      const entry = markers.get(card.dataset.id);
      if (entry) { const ll = entry.marker.getLatLng(); flyTo(ll.lat, ll.lng); }
      focusCard(card.dataset.id, false);
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-buy-pass]")) openPaywall(null);
  });

  $("#paywall").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closePaywall();
    if (e.target.closest("#pw-toolate")) return showTooLate();
    if (e.target.closest("#pw-back")) return showPwStep("choose");
    if (e.target.closest("#buy-boxers")) return startCheckout("boxers");
    const opt = e.target.closest(".pw-option");
    if (opt) startCheckout(opt.dataset.kind);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#paywall").hidden) closePaywall(); });

  $("#pw-demo").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pending = state.pending;
    $("#pw-busy-text").textContent = "Processing payment…";
    showPwStep("busy");
    try {
      await new Promise((r) => setTimeout(r, 700));
      await confirmCheckout(state.demoCheckoutId, pending);
      closePaywall();
    } catch (err) {
      toast(err.message);
      showPwStep("demo");
    }
  });

  // ---------- boot ----------

  async function boot() {
    state.config = await api("/api/config");
    $("#demo-chip").hidden = !state.config.demo;
    $("#price-single").textContent = money(state.config.single_cents);
    $("#price-pass").textContent = money(state.config.pass_cents);
    $("#addon-price").textContent = `+${money(state.config.boxers_cents)}`;
    $("#pass-title").textContent = `${state.config.pass_hours}-hour pass`;
    renderPassChip();
    setInterval(renderPassChip, 60000);

    const params = new URLSearchParams(location.search);
    if (params.get("checkout")) history.replaceState(null, "", location.pathname);
    if (params.get("checkout") === "success" && params.get("session_id")) {
      const pending = load("aprieta:pending");
      try { localStorage.removeItem("aprieta:pending"); } catch {}
      try {
        await confirmCheckout(params.get("session_id"), pending);
        return;
      } catch (e) {
        toast(e.message);
      }
    } else if (params.get("checkout") === "cancel") {
      toast("Checkout cancelled. Nothing was charged.");
    }
    if (last) search(last.lat, last.lon);
  }

  boot().catch((e) => showStatus(`Couldn’t start Apprieta: ${esc(e.message)}`));
})();
