"""Build prototype/index.html: the real front end (web/) in one standalone HTML
file, with mock.js standing in for the server and basemap.js drawing an
illustrated Vancouver map instead of loading map tiles.

    python prototype/build.py
"""

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEB = HERE.parent / "web"

html = (WEB / "index.html").read_text()
body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
body = re.sub(r"\s*<script[^>]*></script>", "", body)
body = body.replace(
    '<div id="welcome"',
    '<p class="proto-note">Prototype: sample bathrooms in downtown Vancouver, payments simulated.</p>\n      <div id="welcome"',
    1,
)

css = (WEB / "styles.css").read_text()
css += """
.map-label { position: absolute; transform: translate(-50%,-50%); white-space: nowrap; pointer-events: none; font: 500 11px/1 Roboto, Arial, sans-serif; color: #5f6368; text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff; }
.map-label-area { font-size: 11px; letter-spacing: 1.5px; color: #70757a; }
.map-label-water { font-style: italic; color: #3a78b5; text-shadow: none; font-size: 12px; }
.map-label-park { color: #2f7a36; font-size: 12px; }
.map-label-road { font-size: 10px; color: #5f6368; }
.leaflet-control-attribution { font-size: 11px; }
.proto-note { margin: 0 0 8px; text-align: center; font-size: 12px; color: var(--ink-2); }
"""

leaflet_css = (WEB / "vendor/leaflet/leaflet.css").read_text()
leaflet_js = (WEB / "vendor/leaflet/leaflet.js").read_text()

out = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ff5a36">
<title>Aprieta prototype</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500&display=swap">
<style>{leaflet_css}</style>
<style>{css}</style>
</head>
<body>
{body}
<script>{leaflet_js}</script>
<script>{(HERE / "basemap.js").read_text()}</script>
<script>{(HERE / "mock.js").read_text()}</script>
<script>{(WEB / "app.js").read_text()}</script>
</body>
</html>
"""
(HERE / "index.html").write_text(out)
print(f"wrote {HERE / 'index.html'} ({len(out) // 1024} KB)")
