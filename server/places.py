"""Bathroom data from OpenStreetMap, plus the teaser/full split the paywall relies on.

Everything that could pinpoint a bathroom (name, address, exact coordinates)
only ever leaves the server through `full_view`, which routes call after
checking the caller has paid. `teaser_view` is what everyone else gets.
"""

import hashlib
import math
import os
import time

import httpx

OVERPASS_URLS = [
    os.getenv("APRIETA_OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
    "https://overpass.kumi.systems/api/interpreter",
]
NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "aprieta/1.0 (bathroom locator)"

# Teaser pins snap to a grid of roughly 250 m cells. Snapping (rather than
# random jitter) matters: random noise re-rolled per request could be
# averaged away by refreshing, a fixed cell can't.
GRID_DEG = 0.0025
DISTANCE_BUCKET_M = 50

_CACHE_TTL_S = 600
_cache: dict[tuple, tuple[float, list[dict]]] = {}

VENUE_LABELS = {
    "cafe": "Café",
    "restaurant": "Restaurant",
    "fast_food": "Fast food",
    "fuel": "Gas station",
    "bar": "Bar",
    "pub": "Pub",
    "library": "Library",
    "townhall": "Public building",
    "community_centre": "Community center",
    "marketplace": "Market",
    "shelter": "Shelter",
    "ice_cream": "Ice cream",
}

# Where to buy emergency underwear, for the "too late?" upsell.
STORE_LABELS = {
    "underwear": "Underwear shop",
    "clothes": "Clothing store",
    "department_store": "Department store",
    "variety_store": "Dollar store",
    "chemist": "Pharmacy",
    "supermarket": "Supermarket",
}
STORES_SHOWN = 3


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def everything_is_a_bath() -> bool:
    """Just-for-fun mode: every restaurant and hotel shows up as a "Bath".
    On by default; set APRIETA_EVERYTHING_IS_A_BATH=0 for real bathrooms only."""
    return os.getenv("APRIETA_EVERYTHING_IS_A_BATH", "1") != "0"


def _overpass_query(lat: float, lon: float, radius_m: int) -> str:
    around = f"(around:{radius_m},{lat},{lon})"
    fun = f'nwr["amenity"="restaurant"]{around};nwr["tourism"="hotel"]{around};' if everything_is_a_bath() else ""
    return (
        "[out:json][timeout:25];("
        f'nwr["amenity"="toilets"]{around};'
        f'nwr["toilets"="yes"]["amenity"]{around};'
        f"{fun}"
        ");out center tags;"
    )


def _stores_query(lat: float, lon: float, radius_m: int) -> str:
    around = f"(around:{radius_m},{lat},{lon})"
    shops = "|".join(STORE_LABELS)
    return (
        "[out:json][timeout:20];("
        f'nwr["shop"~"^({shops})$"]{around};'
        f'nwr["amenity"="pharmacy"]{around};'
        ");out center tags;"
    )


def _parse_element(el: dict) -> dict | None:
    tags = el.get("tags") or {}
    if tags.get("access") in ("private", "no") or tags.get("toilets:access") in ("private", "no"):
        return None
    if "lat" in el:
        lat, lon = el["lat"], el["lon"]
    elif "center" in el:
        lat, lon = el["center"]["lat"], el["center"]["lon"]
    else:
        return None
    return {"id": f"{el['type']}-{el['id']}", "lat": lat, "lon": lon, "tags": tags}


def fetch_places(lat: float, lon: float, radius_m: int) -> list[dict]:
    """Bathrooms within radius_m of (lat, lon), straight from OpenStreetMap."""
    return _fetch(_overpass_query, lat, lon, radius_m)


def fetch_stores(lat: float, lon: float, radius_m: int = 1500) -> list[dict]:
    """Shops near (lat, lon) that sell underwear, nearest first."""
    found = _fetch(_stores_query, lat, lon, radius_m)
    return sorted(found, key=lambda p: haversine_m(lat, lon, p["lat"], p["lon"]))[:STORES_SHOWN]


def _fetch(build_query, lat: float, lon: float, radius_m: int) -> list[dict]:
    key = (build_query.__name__, round(lat, 3), round(lon, 3), radius_m)
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _CACHE_TTL_S:
        return hit[1]

    query = build_query(lat, lon, radius_m)
    last_err: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            resp = httpx.post(url, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=25)
            resp.raise_for_status()
            elements = resp.json().get("elements", [])
            break
        except (httpx.HTTPError, ValueError) as e:
            last_err = e
    else:
        raise RuntimeError(f"Couldn't reach OpenStreetMap: {last_err}")

    places = [p for p in (_parse_element(el) for el in elements) if p]
    _cache[key] = (time.time(), places)
    return places


def reverse_geocode(lat: float, lon: float) -> str | None:
    try:
        resp = httpx.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 18},
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json().get("display_name")
    except (httpx.HTTPError, ValueError):
        return None


def _yes(value: str | None) -> bool | None:
    if value is None:
        return None
    return value.lower() in ("yes", "designated", "limited")


def is_store(tags: dict) -> bool:
    return tags.get("shop") in STORE_LABELS or tags.get("amenity") == "pharmacy"


def kind_of(tags: dict) -> str:
    if tags.get("amenity") == "toilets":
        return "Public restroom"
    if tags.get("amenity") == "pharmacy":
        return "Pharmacy"
    if everything_is_a_bath() and (tags.get("amenity") == "restaurant" or tags.get("tourism") == "hotel"):
        return "Bath"
    if tags.get("shop") in STORE_LABELS:
        return STORE_LABELS[tags["shop"]]
    return VENUE_LABELS.get(tags.get("amenity", ""), "Business")


def features(tags: dict) -> dict:
    fee = tags.get("fee") or tags.get("toilets:fee")
    return {
        "kind": kind_of(tags),
        "free": None if fee is None else fee.lower() == "no",
        "wheelchair": _yes(tags.get("wheelchair") or tags.get("toilets:wheelchair")),
        "changing_table": _yes(tags.get("changing_table")),
        "unisex": _yes(tags.get("unisex")),
        "customers_only": (tags.get("access") == "customers" or tags.get("toilets:access") == "customers")
        or tags.get("amenity") != "toilets",
        "hours": tags.get("opening_hours"),
        "category": "store" if is_store(tags) else "bathroom",
    }


def address_from_tags(tags: dict) -> str | None:
    street = " ".join(p for p in (tags.get("addr:housenumber"), tags.get("addr:street")) if p)
    parts = [p for p in (street, tags.get("addr:city"), tags.get("addr:postcode")) if p]
    return ", ".join(parts) or None


def _spread(place_id: str, axis: int) -> float:
    """Where in its grid cell a locked pin sits (0.1-0.9). Derived from the id alone,
    not the true position, so pins in the same cell spread out without leaking anything."""
    digest = hashlib.sha256(f"{place_id}:{axis}".encode()).digest()
    return 0.1 + 0.8 * digest[0] / 255


def teaser_view(place: dict, user_lat: float, user_lon: float) -> dict:
    dist = haversine_m(user_lat, user_lon, place["lat"], place["lon"])
    return {
        "id": place["id"],
        "locked": True,
        "distance_m": max(DISTANCE_BUCKET_M, round(dist / DISTANCE_BUCKET_M) * DISTANCE_BUCKET_M),
        "approx_lat": (math.floor(place["lat"] / GRID_DEG) + _spread(place["id"], 0)) * GRID_DEG,
        "approx_lon": (math.floor(place["lon"] / GRID_DEG) + _spread(place["id"], 1)) * GRID_DEG,
        "approx_radius_m": 200,
        **features(place["tags"]),
    }


def full_view(place: dict, user_lat: float | None = None, user_lon: float | None = None) -> dict:
    tags = place["tags"]
    view = {
        "id": place["id"],
        "locked": False,
        "name": tags.get("name") or kind_of(tags),
        "address": place.get("address") or address_from_tags(tags),
        "lat": place["lat"],
        "lon": place["lon"],
        "notes": tags.get("description") or tags.get("note"),
        **features(tags),
    }
    if user_lat is not None and user_lon is not None:
        view["distance_m"] = round(haversine_m(user_lat, user_lon, place["lat"], place["lon"]))
    return view
