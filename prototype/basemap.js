// Prototype only: an illustrated, Google-Maps-coloured map of downtown Vancouver
// drawn as vectors, standing in for real map tiles.
(() => {
  const C = { land: "#f5f3f0", water: "#aadaff", park: "#c3e6b4", road: "#ffffff", casing: "#dcdcdc",
    major: "#fff3c4", majorCase: "#f1d58a", hwy: "#fdd663", hwyCase: "#e9b33c", label: "#5f6368", waterLabel: "#3a78b5", parkLabel: "#3b7d3b" };
  const TOP = 49.318, BOT = 49.258, W = -123.168, E = -123.088;

  // Land polygons are [lat, lon]. Everything else is water.
  const downtown = [[49.2925,-123.1345],[49.2912,-123.1300],[49.2905,-123.1260],[49.2898,-123.1215],[49.2885,-123.1165],[49.2895,-123.1135],[49.2895,-123.1105],[49.2880,-123.1100],[49.2865,-123.1060],[49.2855,-123.1000],[49.2850,-123.0880],
    [49.2560,-123.0880],[49.2560,-123.1700],[49.2742,-123.1700],[49.2745,-123.1570],[49.2760,-123.1530],[49.2775,-123.1480],[49.2765,-123.1440],[49.2740,-123.1420],[49.2720,-123.1400],[49.2700,-123.1370],[49.2698,-123.1320],[49.2700,-123.1280],[49.2698,-123.1220],[49.2695,-123.1160],[49.2700,-123.1110],[49.2712,-123.1070],[49.2718,-123.1030],[49.2735,-123.1020],
    [49.2740,-123.1045],[49.2735,-123.1080],[49.2722,-123.1120],[49.2728,-123.1160],[49.2735,-123.1200],[49.2740,-123.1240],[49.2745,-123.1270],[49.2755,-123.1310],[49.2760,-123.1345],[49.2780,-123.1355],[49.2810,-123.1370],[49.2840,-123.1395],[49.2870,-123.1428],[49.2885,-123.1440],[49.2915,-123.1470]];
  const stanley = [[49.2915,-123.1470],[49.2930,-123.1510],[49.2990,-123.1560],[49.3050,-123.1560],[49.3140,-123.1410],[49.3090,-123.1300],[49.3005,-123.1170],[49.2960,-123.1260],[49.2925,-123.1345],[49.2918,-123.1400]];
  const northShore = [[49.3200,-123.1330],[49.3105,-123.1250],[49.3090,-123.1150],[49.3080,-123.1050],[49.3088,-123.0950],[49.3092,-123.0850],[49.3200,-123.0850]];
  const granvilleIsland = [[49.2725,-123.1375],[49.2718,-123.1320],[49.2706,-123.1298],[49.2697,-123.1320],[49.2699,-123.1370],[49.2712,-123.1395]];
  const lostLagoon = [[49.2948,-123.1445],[49.2952,-123.1405],[49.2940,-123.1385],[49.2930,-123.1410],[49.2934,-123.1440]];
  const parks = [
    [[49.2770,-123.1480],[49.2762,-123.1430],[49.2745,-123.1412],[49.2733,-123.1455]],          // Vanier Park
    [[49.2752,-123.1232],[49.2758,-123.1205],[49.2745,-123.1188],[49.2739,-123.1215]],          // David Lam Park
    [[49.2845,-123.1405],[49.2838,-123.1388],[49.2812,-123.1368],[49.2808,-123.1378],[49.2840,-123.1410]], // Sunset Beach
    [[49.2853,-123.1318],[49.2860,-123.1302],[49.2848,-123.1290],[49.2842,-123.1306]],          // Nelson Park
  ];

  function inside(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const onStreetLand = (p) => inside(p, downtown) && !inside(p, stanley) && !inside(p, granvilleIsland);

  // Local metres around downtown so the rotated grid is square.
  const O = [49.2820, -123.1207], MX = 72700, MY = 111320;
  const toLL = (x, y) => [O[0] + y / MY, O[1] + x / MX];
  const U = [0.827, -0.562], V = [0.562, 0.827]; // along Georgia St (SE) and across it (NE)

  function clipLine(a, b) {
    const runs = []; let run = [];
    const n = Math.ceil(Math.hypot((b[0] - a[0]) * MY, (b[1] - a[1]) * MX) / 12);
    for (let i = 0; i <= n; i++) {
      const p = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n];
      if (onStreetLand(p)) run.push(p); else { if (run.length > 3) runs.push(run); run = []; }
    }
    if (run.length > 3) runs.push(run);
    return runs;
  }

  const roads = []; // {pts, kind, name}
  function add(a, b, kind, name) { clipLine(a, b).forEach((pts) => roads.push({ pts, kind, name })); }

  // Downtown & West End grid, rotated.
  const along = { "-480": "Davie St", "-240": "Nelson St", "0": "Robson St", "120": "W Georgia St", "360": "W Pender St", "480": "W Hastings St" };
  for (let v = -720; v <= 720; v += 120) {
    const a = toLL(-2600 * U[0] + v * V[0], -2600 * U[1] + v * V[1]), b = toLL(2600 * U[0] + v * V[0], 2600 * U[1] + v * V[1]);
    const name = along[v]; add(a, b, v === 120 ? "major" : name ? "mid" : "minor", name);
  }
  const across = { "-1500": "Denman St", "-450": "Burrard St", "0": "Granville St", "-150": "Howe St", "300": "Richards St", "750": "Cambie St" };
  for (let u = -1650; u <= 1050; u += 150) {
    const a = toLL(u * U[0] - 2200 * V[0], u * U[1] - 2200 * V[1]), b = toLL(u * U[0] + 2200 * V[0], u * U[1] + 2200 * V[1]);
    const name = across[u]; add(a, b, u === -450 || u === 0 ? "major" : name ? "mid" : "minor", name);
  }
  // South of False Creek and east of downtown: true north-south grid.
  const avenues = { 49.2688: "W 2nd Ave", 49.2670: "W 4th Ave", 49.2634: "W Broadway" };
  for (let lat = 49.2598; lat <= 49.2700; lat += 0.0009) {
    const k = lat.toFixed(4); const name = avenues[k];
    clipLine([+k, W], [+k, -123.1005]).forEach((pts) => roads.push({ pts, kind: k === "49.2634" ? "major" : name ? "mid" : "minor", name }));
  }
  for (let lon = -123.1665; lon <= -123.0885; lon += 0.00145)
    clipLine([49.2560, lon], [lon > -123.1005 ? 49.2860 : 49.2705, lon]).forEach((pts) => roads.push({ pts, kind: "minor" }));
  [[-123.1005, "Main St", 49.2860], [-123.1150, "Cambie St", 49.2705], [-123.1385, "Granville St", 49.2705], [-123.1455, "Burrard St", 49.2705], [-123.1270, "Oak St", 49.2705]]
    .forEach(([lon, name, top]) => clipLine([49.2560, lon], [top, lon]).forEach((pts) => roads.push({ pts, kind: name === "Oak St" ? "mid" : "major", name })));
  for (let lat = 49.2715; lat <= 49.2850; lat += 0.0011) clipLine([lat, -123.1005], [lat, E]).forEach((pts) => roads.push({ pts, kind: "minor" }));
  // Bridges and the causeway cross water, so they skip clipping.
  roads.push({ pts: [[49.2772, -123.1352], [49.2718, -123.1440]], kind: "major", name: "Burrard Bridge" });
  roads.push({ pts: [[49.2772, -123.1265], [49.2700, -123.1370]], kind: "major", name: "Granville Bridge" });
  roads.push({ pts: [[49.2745, -123.1140], [49.2690, -123.1150]], kind: "major", name: "Cambie Bridge" });
  roads.push({ pts: [[49.2928, -123.1398], [49.2990, -123.1395], [49.3060, -123.1400], [49.3140, -123.1395], [49.3200, -123.1385]], kind: "hwy", name: "Stanley Park Causeway" });

  const labels = [
    [49.2838, -123.1170, "DOWNTOWN", "area"], [49.2872, -123.1340, "WEST END", "area"], [49.2765, -123.1195, "YALETOWN", "area"],
    [49.2848, -123.1045, "GASTOWN", "area"], [49.2800, -123.0975, "CHINATOWN", "area"], [49.2655, -123.1225, "FAIRVIEW", "area"],
    [49.2685, -123.1560, "KITSILANO", "area"], [49.2810, -123.0930, "STRATHCONA", "area"],
    [49.3030, -123.1420, "Stanley Park", "park"], [49.2708, -123.1348, "Granville Island", "park"],
    [49.2995, -123.1020, "Burrard Inlet", "water"], [49.2835, -123.1560, "English Bay", "water"], [49.2932, -123.1262, "Coal Harbour", "water"],
    [49.2716, -123.1185, "False Creek", "water"], [49.3140, -123.1020, "NORTH VANCOUVER", "area"],
  ];

  const ROAD = { minor: [1.6, 0.9], mid: [2.8, 1.4], major: [4.4, 1.8], hwy: [5.4, 2] };
  const colors = { minor: [C.road, C.casing], mid: [C.road, C.casing], major: [C.major, C.majorCase], hwy: [C.hwy, C.hwyCase] };

  window.drawVancouver = (map) => {
    map.getContainer().style.background = C.water;
    const r = L.canvas({ padding: 0.5 });
    const poly = (pts, color) => L.polygon(pts, { renderer: r, stroke: false, fillColor: color, fillOpacity: 1, interactive: false }).addTo(map);
    poly(downtown, C.land); poly(northShore, C.land); poly(granvilleIsland, C.land);
    poly(stanley, C.park); parks.forEach((p) => poly(p, C.park)); poly(lostLagoon, C.water);

    const lines = [];
    ["minor", "mid", "major", "hwy"].forEach((kind) => {
      const set = roads.filter((x) => x.kind === kind);
      set.forEach((x) => lines.push([L.polyline(x.pts, { renderer: r, color: colors[kind][1], interactive: false, lineCap: "round" }).addTo(map), kind, "case"]));
      set.forEach((x) => lines.push([L.polyline(x.pts, { renderer: r, color: colors[kind][0], interactive: false, lineCap: "round" }).addTo(map), kind, "fill"]));
    });
    const restyle = () => {
      const s = Math.pow(2, map.getZoom() - 15);
      lines.forEach(([l, kind, part]) => { const [w, c] = ROAD[kind]; l.setStyle({ weight: Math.max(1, part === "fill" ? w * s : w * s + c) }); });
    };
    map.on("zoomend", restyle); restyle();

    const labelLayer = L.layerGroup().addTo(map);
    const drawLabels = () => {
      labelLayer.clearLayers();
      const z = map.getZoom();
      labels.forEach(([lat, lon, text, kind]) => {
        if (kind === "area" && z > 17) return;
        L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span class="map-label map-label-${kind}">${text}</span>`, iconSize: [0, 0] }) }).addTo(labelLayer);
      });
      if (z >= 14) {
        const seen = new Set();
        roads.filter((x) => x.name && (z >= 15 ? x.kind !== "minor" : x.kind === "major" || x.kind === "hwy")).sort((a, b) => b.pts.length - a.pts.length).forEach((x) => {
          if (seen.has(x.name)) return; seen.add(x.name);
          const a = map.latLngToContainerPoint(x.pts[0]), b = map.latLngToContainerPoint(x.pts[x.pts.length - 1]);
          let ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
          const mid = x.pts[Math.floor(x.pts.length * 0.4)];
          L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span class="map-label map-label-road" style="transform:translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)">${x.name}</span>`, iconSize: [0, 0] }) }).addTo(labelLayer);
        });
      }
    };
    map.on("zoomend", drawLabels); drawLabels();
    map.setMaxBounds([[BOT, W], [TOP, E]]).setMinZoom(14);
    map.attributionControl.setPrefix("").addAttribution("Illustrated map for demo");
  };

  // Hook into the app: swap tiles for the drawing and open on Vancouver.
  const origMap = L.map;
  L.tileLayer = () => L.layerGroup();
  L.map = (...args) => {
    const m = origMap(...args);
    const setView = m.setView;
    m.setView = function () { m.setView = setView; return setView.call(this, [49.2820, -123.1207], 14); };
    const fit = m.fitBounds; m.fitBounds = function (b, o) { return fit.call(this, b, { ...o, maxZoom: 14 }); };
    window.drawVancouver(m);
    return m;
  };
})();
