import argparse
import os
import secrets
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import payments, places
from .store import Store

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
DEVICE_COOKIE = "aprieta_device"
MAX_RADIUS_M = 3000


class CheckoutRequest(BaseModel):
    kind: Literal["single", "pass", "boxers"]
    place_id: str | None = None
    # "Too late?" add-on: also unlock the nearest shops selling underwear.
    boxers: bool = False
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)


class ConfirmRequest(BaseModel):
    session_id: str


def create_app(store: Store | None = None) -> FastAPI:
    app = FastAPI(title="Aprieta")
    app.state.store = store or Store()

    def get_store() -> Store:
        return app.state.store

    def device_id(request: Request, response: Response) -> str:
        """Anonymous per-browser id that purchases are tied to. No accounts."""
        device = request.cookies.get(DEVICE_COOKIE)
        if not device or len(device) > 64:
            device = secrets.token_urlsafe(24)
            response.set_cookie(
                DEVICE_COOKIE, device, max_age=60 * 60 * 24 * 365 * 2, httponly=True, samesite="lax",
                secure=request.url.scheme == "https",
            )
        return device

    @app.get("/api/config")
    def config(device: str = Depends(device_id), store: Store = Depends(get_store)):
        pricing = payments.Pricing.from_env()
        return {
            "demo": payments.demo_mode(),
            "currency": pricing.currency,
            "single_cents": pricing.single_cents,
            "pass_cents": pricing.pass_cents,
            "pass_hours": pricing.pass_hours,
            "boxers_cents": pricing.boxers_cents,
            "pass_expires_at": store.pass_expires_at(device),
        }

    @app.get("/api/bathrooms")
    def nearby(
        lat: float = Query(..., ge=-90, le=90),
        lon: float = Query(..., ge=-180, le=180),
        radius: int = Query(1200, ge=100, le=MAX_RADIUS_M),
        device: str = Depends(device_id),
        store: Store = Depends(get_store),
    ):
        try:
            found = places.fetch_places(lat, lon, radius)
        except RuntimeError as e:
            raise HTTPException(503, str(e))
        store.save_places(found)

        has_pass = store.pass_expires_at(device) is not None
        unlocked = store.unlocked_ids(device)
        results = []
        for p in found:
            if has_pass or p["id"] in unlocked:
                results.append(places.full_view(store.get_place(p["id"]) or p, lat, lon))
            else:
                results.append(places.teaser_view(p, lat, lon))
        results.sort(key=lambda r: r["distance_m"])
        return {"bathrooms": results[:60], "has_pass": has_pass}

    @app.get("/api/stores")
    def stores(
        lat: float = Query(..., ge=-90, le=90),
        lon: float = Query(..., ge=-180, le=180),
        device: str = Depends(device_id),
        store: Store = Depends(get_store),
    ):
        """Nearest places to buy fresh underwear. The bathroom pass doesn't cover these."""
        try:
            found = places.fetch_stores(lat, lon)
        except RuntimeError as e:
            raise HTTPException(503, str(e))
        store.save_places(found)
        unlocked = store.unlocked_ids(device)
        return {"stores": [
            places.full_view(store.get_place(p["id"]) or p, lat, lon) if p["id"] in unlocked else places.teaser_view(p, lat, lon)
            for p in found
        ]}

    @app.get("/api/bathrooms/{place_id}")
    def bathroom(
        place_id: str,
        lat: float | None = None,
        lon: float | None = None,
        device: str = Depends(device_id),
        store: Store = Depends(get_store),
    ):
        place = store.get_place(place_id)
        if not place:
            raise HTTPException(404, "Unknown bathroom")
        allowed = place_id in store.unlocked_ids(device) if places.is_store(place["tags"]) else store.can_see(device, place_id)
        if not allowed:
            raise HTTPException(402, "Unlock this place to see its address")
        if not place.get("address") and not places.address_from_tags(place["tags"]):
            addr = places.reverse_geocode(place["lat"], place["lon"])
            if addr:
                store.set_address(place_id, addr)
                place["address"] = addr
        return places.full_view(place, lat, lon)

    @app.post("/api/checkout")
    def checkout(body: CheckoutRequest, request: Request, device: str = Depends(device_id), store: Store = Depends(get_store)):
        if body.kind == "single" and (not body.place_id or not store.get_place(body.place_id)):
            raise HTTPException(400, "Pick a bathroom to unlock")
        place_id = body.place_id if body.kind == "single" else None
        pricing = payments.Pricing.from_env()
        boxers = body.boxers or body.kind == "boxers"
        store_ids: list[str] = []
        if boxers:
            if body.lat is None or body.lon is None:
                raise HTTPException(400, "Share your location to find underwear nearby")
            try:
                found = places.fetch_stores(body.lat, body.lon)
            except RuntimeError as e:
                raise HTTPException(503, str(e))
            if not found:
                raise HTTPException(404, "No shops selling underwear found nearby")
            store.save_places(found)
            store_ids = [p["id"] for p in found]

        if payments.demo_mode():
            checkout_id = payments.new_demo_checkout_id()
            store.create_checkout(checkout_id, device, body.kind, place_id, store_ids)
            return {"demo": True, "checkout_id": checkout_id, "amount_cents": pricing.amount(body.kind, boxers)}

        base_url = os.getenv("APRIETA_PUBLIC_URL") or str(request.base_url).rstrip("/")
        session_id, url = payments.create_stripe_session(body.kind, pricing, base_url, device, place_id, boxers)
        store.create_checkout(session_id, device, body.kind, place_id, store_ids)
        return {"demo": False, "url": url}

    @app.post("/api/checkout/confirm")
    def confirm(body: ConfirmRequest, device: str = Depends(device_id), store: Store = Depends(get_store)):
        record = store.get_checkout(body.session_id)
        # Purchases stay with the browser that started them, so a leaked
        # session id can't be replayed from somewhere else.
        if not record or record["device"] != device:
            raise HTTPException(404, "Checkout not found")
        if record["status"] != "paid":
            if body.session_id.startswith("demo_"):
                if not payments.demo_mode():
                    raise HTTPException(402, "Demo payments are disabled")
            elif not payments.stripe_session_paid(body.session_id):
                raise HTTPException(402, "Payment not completed")
            store.complete_checkout(body.session_id, payments.Pricing.from_env().pass_hours)
        return {"ok": True, "kind": record["kind"], "place_id": record["place_id"], "boxers": record["store_ids"] != "[]"}

    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app


def main() -> None:
    import uvicorn

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    parser = argparse.ArgumentParser(description="Aprieta: find a bathroom, fast")
    parser.add_argument("--host", default=os.getenv("APRIETA_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8430")))
    args = parser.parse_args()
    mode = "DEMO payments (no Stripe key set)" if payments.demo_mode() else "live Stripe payments"
    print(f"Aprieta running at http://{args.host}:{args.port} with {mode}")
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
