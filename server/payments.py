"""Stripe Checkout, with a demo mode for running without a Stripe account.

Demo mode is on whenever STRIPE_SECRET_KEY is unset: checkout shows a fake
card form and "paying" unlocks immediately. Set the key to charge for real.
"""

import os
import secrets
from dataclasses import dataclass


@dataclass
class Pricing:
    single_cents: int
    pass_cents: int
    pass_hours: float
    currency: str
    boxers_cents: int

    @classmethod
    def from_env(cls) -> "Pricing":
        return cls(
            single_cents=int(os.getenv("APRIETA_PRICE_SINGLE_CENTS", "400")),
            pass_cents=int(os.getenv("APRIETA_PRICE_PASS_CENTS", "299")),
            pass_hours=float(os.getenv("APRIETA_PASS_HOURS", "24")),
            currency=os.getenv("APRIETA_CURRENCY", "usd"),
            boxers_cents=int(os.getenv("APRIETA_PRICE_BOXERS_CENTS", "5000")),
        )

    def amount(self, kind: str, boxers: bool = False) -> int:
        base = {"pass": self.pass_cents, "single": self.single_cents, "boxers": 0}[kind]
        return base + (self.boxers_cents if boxers or kind == "boxers" else 0)


def stripe_key() -> str | None:
    return os.getenv("STRIPE_SECRET_KEY") or None


def demo_mode() -> bool:
    return stripe_key() is None


def new_demo_checkout_id() -> str:
    return "demo_" + secrets.token_urlsafe(16)


def _line(pricing: Pricing, cents: int, name: str) -> dict:
    return {"quantity": 1, "price_data": {"currency": pricing.currency, "unit_amount": cents, "product_data": {"name": name}}}


def create_stripe_session(
    kind: str, pricing: Pricing, base_url: str, device: str, place_id: str | None, boxers: bool = False
) -> tuple[str, str]:
    """Create a Stripe Checkout Session. Returns (session_id, url_to_redirect_to)."""
    import stripe

    stripe.api_key = stripe_key()
    lines = []
    if kind == "pass":
        lines.append(_line(pricing, pricing.pass_cents, f"Apprieta {pricing.pass_hours:g}-hour pass: every bathroom address"))
    elif kind == "single":
        lines.append(_line(pricing, pricing.single_cents, "Apprieta: unlock one bathroom address"))
    if boxers or kind == "boxers":
        lines.append(_line(pricing, pricing.boxers_cents, "Apprieta: nearest places to buy fresh underwear"))
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=lines,
        success_url=f"{base_url}/?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{base_url}/?checkout=cancel",
        metadata={"device": device, "kind": kind, "place_id": place_id or "", "boxers": str(boxers or kind == "boxers")},
    )
    return session.id, session.url


def stripe_session_paid(session_id: str) -> bool:
    import stripe

    stripe.api_key = stripe_key()
    session = stripe.checkout.Session.retrieve(session_id)
    return session.payment_status == "paid"
