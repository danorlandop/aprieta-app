import pytest
from fastapi.testclient import TestClient

from server import main, places
from server.store import Store

HOME = (40.4168, -3.7038)
FAKE_PLACES = [
    {"id": "node-1", "lat": 40.4170, "lon": -3.7040,
     "tags": {"amenity": "toilets", "name": "Plaza Mayor WC", "addr:street": "Calle Mayor", "addr:housenumber": "1", "fee": "no", "wheelchair": "yes"}},
    {"id": "node-2", "lat": 40.4200, "lon": -3.7000,
     "tags": {"amenity": "cafe", "toilets": "yes", "name": "Café Secreto", "addr:street": "Calle Sol", "addr:housenumber": "9"}},
]
FAKE_STORES = [
    {"id": "node-50", "lat": 40.4172, "lon": -3.7045, "tags": {"amenity": "pharmacy", "name": "Farmacia Luna", "addr:street": "Calle Luna", "addr:housenumber": "4"}},
    {"id": "node-51", "lat": 40.4190, "lon": -3.7020, "tags": {"shop": "clothes", "name": "Ropa Rápida", "addr:street": "Calle Prisa", "addr:housenumber": "8"}},
]
SECRETS = ["Plaza Mayor WC", "Calle Mayor", "Café Secreto", "Calle Sol", "40.417,", "40.42,"]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.setattr(places, "fetch_places", lambda lat, lon, r: FAKE_PLACES)
    monkeypatch.setattr(places, "fetch_stores", lambda lat, lon, r=1500: FAKE_STORES)
    monkeypatch.setattr(places, "reverse_geocode", lambda lat, lon: None)
    return TestClient(main.create_app(Store(":memory:")))


def nearby(client):
    return client.get("/api/bathrooms", params={"lat": HOME[0], "lon": HOME[1]}).json()


def pay(client, kind, place_id=None, boxers=False):
    res = client.post("/api/checkout", json={"kind": kind, "place_id": place_id, "boxers": boxers, "lat": HOME[0], "lon": HOME[1]}).json()
    assert res["demo"] is True
    assert client.post("/api/checkout/confirm", json={"session_id": res["checkout_id"]}).status_code == 200


def test_locked_results_leak_nothing(client):
    data = nearby(client)
    text = str(data)
    for secret in SECRETS:
        assert secret not in text
    b = data["bathrooms"][0]
    assert b["locked"] and "lat" not in b and "address" not in b and "name" not in b
    assert b["free"] is True and b["wheelchair"] is True
    assert client.get("/api/bathrooms/node-1").status_code == 402


def test_single_unlock_reveals_only_that_bathroom(client):
    nearby(client)
    pay(client, "single", "node-1")
    by_id = {b["id"]: b for b in nearby(client)["bathrooms"]}
    assert by_id["node-1"]["address"] == "1 Calle Mayor"
    assert by_id["node-1"]["name"] == "Plaza Mayor WC"
    assert by_id["node-2"]["locked"]
    assert client.get("/api/bathrooms/node-1").status_code == 200
    assert client.get("/api/bathrooms/node-2").status_code == 402


def test_pass_unlocks_everything(client):
    nearby(client)
    pay(client, "pass")
    assert all(not b["locked"] for b in nearby(client)["bathrooms"])
    assert client.get("/api/config").json()["pass_expires_at"]


def test_purchase_is_tied_to_the_buying_browser(client):
    nearby(client)
    res = client.post("/api/checkout", json={"kind": "pass"}).json()
    client.cookies.clear()
    assert client.post("/api/checkout/confirm", json={"session_id": res["checkout_id"]}).status_code == 404
    assert all(b["locked"] for b in nearby(client)["bathrooms"])


def test_demo_checkout_refused_once_stripe_is_configured(client, monkeypatch):
    nearby(client)
    res = client.post("/api/checkout", json={"kind": "pass"}).json()
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    assert client.post("/api/checkout/confirm", json={"session_id": res["checkout_id"]}).status_code == 402


def test_stripe_payment_must_be_paid(client, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    monkeypatch.setattr(main.payments, "create_stripe_session", lambda *a: ("cs_test_1", "https://checkout.stripe.com/x"))
    nearby(client)
    assert client.post("/api/checkout", json={"kind": "single", "place_id": "node-2"}).json()["url"].startswith("https://checkout.stripe.com")

    monkeypatch.setattr(main.payments, "stripe_session_paid", lambda sid: False)
    assert client.post("/api/checkout/confirm", json={"session_id": "cs_test_1"}).status_code == 402
    monkeypatch.setattr(main.payments, "stripe_session_paid", lambda sid: True)
    assert client.post("/api/checkout/confirm", json={"session_id": "cs_test_1"}).status_code == 200
    assert client.get("/api/bathrooms/node-2").json()["address"] == "9 Calle Sol"


def test_private_toilets_are_dropped():
    assert places._parse_element({"type": "node", "id": 5, "lat": 1, "lon": 2, "tags": {"amenity": "toilets", "access": "private"}}) is None
    assert places._parse_element({"type": "way", "id": 6, "center": {"lat": 1, "lon": 2}, "tags": {"amenity": "toilets"}})["id"] == "way-6"


def stores(client):
    return client.get("/api/stores", params={"lat": HOME[0], "lon": HOME[1]}).json()["stores"]


def test_boxer_shops_are_locked_and_not_covered_by_the_pass(client):
    s = stores(client)
    assert all(x["locked"] for x in s) and "Farmacia" not in str(s)
    assert s[0]["kind"] == "Pharmacy" and s[0]["category"] == "store"
    pay(client, "pass")
    assert all(x["locked"] for x in stores(client))
    assert client.get("/api/bathrooms/node-50").status_code == 402


def test_boxers_addon_unlocks_bathroom_and_shops(client):
    nearby(client)
    res = client.post("/api/checkout", json={"kind": "single", "place_id": "node-1", "boxers": True, "lat": HOME[0], "lon": HOME[1]}).json()
    assert res["amount_cents"] == 400 + 5000
    assert client.post("/api/checkout/confirm", json={"session_id": res["checkout_id"]}).json()["boxers"] is True
    assert {x["name"] for x in stores(client)} == {"Farmacia Luna", "Ropa Rápida"}
    assert client.get("/api/bathrooms/node-1").status_code == 200


def test_boxers_on_their_own(client):
    pay(client, "boxers")
    assert all(not x["locked"] for x in stores(client))
    assert all(b["locked"] for b in nearby(client)["bathrooms"])


def test_boxers_need_a_location(client):
    assert client.post("/api/checkout", json={"kind": "boxers"}).status_code == 400


def test_restaurants_and_hotels_are_baths(monkeypatch):
    monkeypatch.delenv("APRIETA_EVERYTHING_IS_A_BATH", raising=False)
    assert places.kind_of({"amenity": "restaurant"}) == "Bath"
    assert places.kind_of({"tourism": "hotel"}) == "Bath"
    assert 'amenity"="restaurant"' in places._overpass_query(1, 2, 500)
    monkeypatch.setenv("APRIETA_EVERYTHING_IS_A_BATH", "0")
    assert places.kind_of({"amenity": "restaurant"}) == "Restaurant"
    assert "restaurant" not in places._overpass_query(1, 2, 500)


def test_locked_pins_stay_in_their_cell_and_spread_out():
    a = places.teaser_view({"id": "node-1", "lat": 40.4170, "lon": -3.7040, "tags": {}}, *HOME)
    b = places.teaser_view({"id": "node-2", "lat": 40.4171, "lon": -3.7041, "tags": {}}, *HOME)
    for v in (a, b):
        assert abs(v["approx_lat"] - 40.4170) < places.GRID_DEG and abs(v["approx_lon"] + 3.7040) < places.GRID_DEG
    assert (a["approx_lat"], a["approx_lon"]) != (b["approx_lat"], b["approx_lon"])
    assert a == places.teaser_view({"id": "node-1", "lat": 40.4170, "lon": -3.7040, "tags": {}}, *HOME)
