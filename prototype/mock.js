// Prototype stand-in for the Aprieta server: same API, sample data, nothing charged.
(() => {
  const HOME = { lat: 49.2820, lon: -123.1207 };
  const raw = [
    [49.2806, -123.1235, { amenity: "cafe", toilets: "yes", name: "Maple & Bean Café", "addr:street": "Robson St", "addr:housenumber": "812" }],
    [49.2847, -123.1175, { amenity: "toilets", fee: "no", wheelchair: "yes", changing_table: "yes", opening_hours: "07:00-23:00", name: "Waterfront Plaza Washroom", "addr:street": "W Cordova St", "addr:housenumber": "601" }],
    [49.2792, -123.1155, { amenity: "library", toilets: "yes", wheelchair: "yes", name: "Harbour Public Library", opening_hours: "Mo-Sa 10:00-20:00", "addr:street": "W Georgia St", "addr:housenumber": "350" }],
    [49.2798, -123.1318, { amenity: "fast_food", toilets: "yes", unisex: "yes", name: "Davie Street Burger Co.", "addr:street": "Davie St", "addr:housenumber": "1105" }],
    [49.2860, -123.1405, { amenity: "toilets", fee: "no", unisex: "yes", opening_hours: "sunrise-sunset", name: "English Bay Seawall Washroom", "addr:street": "Beach Ave", "addr:housenumber": "1700" }],
    [49.2895, -123.1255, { amenity: "community_centre", toilets: "yes", fee: "no", wheelchair: "yes", changing_table: "yes", name: "Coal Harbour Community Centre", "addr:street": "Cardero St", "addr:housenumber": "480" }],
    [49.2842, -123.1085, { amenity: "cafe", toilets: "yes", name: "Steam Clock Espresso", "addr:street": "Water St", "addr:housenumber": "12" }],
    [49.2748, -123.1215, { amenity: "toilets", fee: "no", wheelchair: "yes", name: "David Lam Park Washroom", "addr:street": "Pacific Blvd", "addr:housenumber": "1300" }],
    [49.2711, -123.1345, { amenity: "marketplace", toilets: "yes", wheelchair: "yes", changing_table: "yes", name: "Granville Island Market Washrooms", opening_hours: "09:00-19:00", "addr:street": "Johnston St", "addr:housenumber": "1669" }],
    [49.2797, -123.1003, { amenity: "community_centre", toilets: "yes", fee: "no", name: "Chinatown Community Hall", "addr:street": "Keefer St", "addr:housenumber": "150" }],
    [49.2665, -123.1150, { amenity: "fuel", toilets: "yes", opening_hours: "24/7", name: "Cambie Fuel Stop", "addr:street": "W Broadway", "addr:housenumber": "505" }],
  ];
  const rawStores = [
    [49.2830, -123.1190, { amenity: "pharmacy", name: "Harbourside Pharmacy", opening_hours: "08:00-24:00", "addr:street": "Granville St", "addr:housenumber": "710" }],
    [49.2812, -123.1242, { shop: "clothes", name: "Robson Basics", opening_hours: "10:00-21:00", "addr:street": "Robson St", "addr:housenumber": "901" }],
    [49.2795, -123.1180, { shop: "variety_store", name: "Dollar Plus", opening_hours: "09:00-22:00", "addr:street": "Seymour St", "addr:housenumber": "825" }],
    [49.2772, -123.1300, { shop: "department_store", name: "West End Department Store", "addr:street": "Davie St", "addr:housenumber": "1000" }],
  ];
  const stores = rawStores.map(([lat, lon, tags], i) => ({ id: `node-${2000 + i}`, lat, lon, tags }));
  const places = raw.map(([lat, lon, tags], i) => ({ id: `node-${1000 + i}`, lat, lon, tags }));
  const byId = Object.fromEntries([...places, ...stores].map((p) => [p.id, p]));
  const cfg = { single: 99, pass: 299, hours: 24, boxers: 99 };
  const ent = { unlocked: new Set(), passUntil: null };
  const checkouts = {};
  const GRID = 0.0025, LABELS = { cafe: "Café", restaurant: "Restaurant", fast_food: "Fast food", fuel: "Gas station", library: "Library", community_centre: "Community centre", marketplace: "Market" };
  const STORE_LABELS = { clothes: "Clothing store", variety_store: "Dollar store", department_store: "Department store", underwear: "Underwear shop" };

  const hav = (a, b, c, d) => { const r = 6371000, t = Math.PI / 180, x = Math.sin((c - a) * t / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin((d - b) * t / 2) ** 2; return 2 * r * Math.asin(Math.sqrt(x)); };
  const yes = (v) => (v == null ? null : ["yes", "designated", "limited"].includes(v));
  const kind = (t) => (t.amenity === "toilets" ? "Public restroom" : t.amenity === "pharmacy" ? "Pharmacy" : STORE_LABELS[t.shop] || LABELS[t.amenity] || "Business");
  const feats = (t) => ({ kind: kind(t), free: t.fee == null ? null : t.fee === "no", wheelchair: yes(t.wheelchair), changing_table: yes(t.changing_table), unisex: yes(t.unisex), customers_only: t.amenity !== "toilets", hours: t.opening_hours || null, category: t.shop || t.amenity === "pharmacy" ? "store" : "bathroom" });
  const hasPass = () => ent.passUntil && ent.passUntil > Date.now() / 1000;
  const canSee = (id) => (id.startsWith("node-2") ? ent.unlocked.has(id) : hasPass() || ent.unlocked.has(id));
  const nearestStores = (lat, lon) => [...stores].sort((a, b) => hav(lat, lon, a.lat, a.lon) - hav(lat, lon, b.lat, b.lon)).slice(0, 3);
  const teaser = (p, lat, lon) => ({ id: p.id, locked: true, distance_m: Math.max(50, Math.round(hav(lat, lon, p.lat, p.lon) / 50) * 50), approx_lat: (Math.floor(p.lat / GRID) + 0.5) * GRID, approx_lon: (Math.floor(p.lon / GRID) + 0.5) * GRID, approx_radius_m: 200, ...feats(p.tags) });
  const full = (p, lat, lon) => ({ id: p.id, locked: false, name: p.tags.name, address: `${p.tags["addr:housenumber"]} ${p.tags["addr:street"]}, Vancouver`, lat: p.lat, lon: p.lon, notes: null, ...feats(p.tags), ...(lat != null ? { distance_m: Math.round(hav(lat, lon, p.lat, p.lon)) } : {}) });

  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const err = (status, detail) => new Response(JSON.stringify({ detail }), { status, headers: { "Content-Type": "application/json" } });

  window.fetch = async (input, opts = {}) => {
    const url = new URL(input, "https://aprieta.local");
    const q = Object.fromEntries(url.searchParams);
    const body = opts.body ? JSON.parse(opts.body) : {};
    await new Promise((r) => setTimeout(r, 250));
    if (url.pathname === "/api/config")
      return ok({ demo: true, currency: "cad", single_cents: cfg.single, pass_cents: cfg.pass, pass_hours: cfg.hours, boxers_cents: cfg.boxers, pass_expires_at: hasPass() ? ent.passUntil : null });
    if (url.pathname === "/api/bathrooms") {
      const lat = +q.lat, lon = +q.lon;
      const out = places.map((p) => (canSee(p.id) ? full(p, lat, lon) : teaser(p, lat, lon))).sort((a, b) => a.distance_m - b.distance_m);
      return ok({ bathrooms: out, has_pass: !!hasPass() });
    }
    if (url.pathname === "/api/stores") {
      const lat = +q.lat, lon = +q.lon;
      return ok({ stores: nearestStores(lat, lon).map((p) => (canSee(p.id) ? full(p, lat, lon) : teaser(p, lat, lon))) });
    }
    const m = url.pathname.match(/^\/api\/bathrooms\/(.+)$/);
    if (m) {
      const p = byId[decodeURIComponent(m[1])];
      if (!p) return err(404, "Unknown bathroom");
      if (!canSee(p.id)) return err(402, "Unlock this bathroom to see its address");
      return ok(full(p, q.lat != null ? +q.lat : null, q.lon != null ? +q.lon : null));
    }
    if (url.pathname === "/api/checkout") {
      const id = "demo_" + Math.random().toString(36).slice(2);
      const boxers = body.boxers || body.kind === "boxers";
      checkouts[id] = { kind: body.kind, place_id: body.kind === "single" ? body.place_id : null, store_ids: boxers ? nearestStores(body.lat, body.lon).map((p) => p.id) : [] };
      const base = { pass: cfg.pass, single: cfg.single, boxers: 0 }[body.kind];
      return ok({ demo: true, checkout_id: id, amount_cents: base + (boxers ? cfg.boxers : 0) });
    }
    if (url.pathname === "/api/checkout/confirm") {
      const c = checkouts[body.session_id];
      if (!c) return err(404, "Checkout not found");
      if (c.kind === "pass") ent.passUntil = Date.now() / 1000 + cfg.hours * 3600;
      else if (c.kind === "single") ent.unlocked.add(c.place_id);
      c.store_ids.forEach((sid) => ent.unlocked.add(sid));
      return ok({ ok: true, kind: c.kind, place_id: c.place_id, boxers: c.store_ids.length > 0 });
    }
    return err(404, "Not found");
  };

  // Artifact frames can't share location, so "find me" drops you in downtown Vancouver.
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: HOME.lat, longitude: HOME.lon } }), 400) },
  });
  try { localStorage.removeItem("aprieta:last"); } catch {}
})();
