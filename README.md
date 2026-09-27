# Aprieta

**¿Te aprieta?** Find the nearest bathroom, fast. The list is free to browse.
The exact address costs a small one-time payment.

- **Free to browse:** distance, walking time, type (public restroom, café, …),
  free/paid entry, wheelchair access, baby changing, all-gender, hours. On the
  map each locked bathroom is a fuzzy ~200 m circle, not a pin.
- **Paywall:** name, street address, exact pin, and a walking-directions button
  only unlock after paying. Two options:
  - **This bathroom:** $4
  - **24-hour pass:** $2.99, every bathroom everywhere
- **"Too late?" upsell:** on the pay screen, add backup boxers for $50
  (the nearest shops selling underwear), or skip the bathroom and buy just that.
- No accounts. Purchases are tied to the browser (an anonymous cookie).
- Works as a phone web app: open it on your phone and use "Add to Home Screen".

Bathroom data comes live from OpenStreetMap (free, worldwide).

## Try the prototype (no install)

Open `prototype/index.html` in any browser. It's a single file with the
whole app running against sample bathrooms and shops in downtown
Vancouver, on an illustrated map, with simulated payments. It also works
from GitHub Pages.

After changing anything in `web/`, rebuild it with `python prototype/build.py`.

## Run it

```
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m server.main            # http://127.0.0.1:8430
```

Your phone only shares its location with an `https://` site or with
`localhost`. To try it on your phone, deploy it (below) or use a tunnel such as
`cloudflared tunnel --url http://localhost:8430`.

## Payments

With `STRIPE_SECRET_KEY` empty the app runs in **demo mode**: a "Demo payments"
chip shows, and checkout is a fake card form that unlocks without charging.

To take real money:
1. Create a Stripe account and copy a secret key (start with `sk_test_...`; card `4242 4242 4242 4242` works in test mode).
2. Put it in `.env` as `STRIPE_SECRET_KEY`. Set `APRIETA_PUBLIC_URL` to your site's URL.
3. Restart. Checkout now goes to Stripe's hosted payment page. When the buyer comes back, the server asks
   Stripe whether they paid before unlocking anything. Once a key is set, demo checkouts stop working.

Prices, currency and pass length are set in `.env`.

## Why the paywall can't be skipped

Addresses never reach the browser before payment. The server looks up the bathrooms and sends
locked ones without name, address or coordinates. Each map area snaps to a fixed grid cell
(not random jitter, so refreshing can't average it out), and distances are rounded to 50 m. The full
record only comes from `/api/bathrooms/{id}`, which returns `402` unless this browser
bought that bathroom or has an active pass. Payment is confirmed server-side, and a checkout can only be
redeemed by the browser that started it. `tests/test_paywall.py` covers all of this.

One honest caveat: OpenStreetMap data is public, so a determined person could look it up
there themselves. What people pay for is speed and convenience when they need to go *now*.

## Deploy

It's a single Python process with a SQLite file (`data/aprieta.db`). Any host that runs
Python works (Render, Railway, Fly.io, a VPS):

```
python -m server.main --host 0.0.0.0 --port $PORT
```

Put it behind HTTPS (needed for location and Stripe) and keep `data/` on a persistent disk,
because purchases live there.

## Tests

```
pip install pytest
python -m pytest
```
