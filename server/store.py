"""SQLite storage: places we've seen, checkout sessions, and what each device has paid for."""

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "aprieta.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS places (
    id TEXT PRIMARY KEY,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    tags TEXT NOT NULL,
    address TEXT
);
CREATE TABLE IF NOT EXISTS checkouts (
    id TEXT PRIMARY KEY,
    device TEXT NOT NULL,
    kind TEXT NOT NULL,
    place_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at REAL NOT NULL,
    store_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS unlocks (
    device TEXT NOT NULL,
    place_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (device, place_id)
);
CREATE TABLE IF NOT EXISTS passes (
    device TEXT PRIMARY KEY,
    expires_at REAL NOT NULL
);
"""


class Store:
    def __init__(self, path: str | Path | None = None):
        # Vercel's disk is read-only apart from /tmp, which is wiped between cold
        # starts, so purchases there don't last. Fine for a demo; use a hosted
        # database before taking real payments on Vercel.
        default = Path("/tmp/aprieta.db") if os.getenv("VERCEL") else DEFAULT_DB
        path = Path(path or os.getenv("APRIETA_DB") or default)
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.executescript(_SCHEMA)
            cols = {r["name"] for r in self._db.execute("PRAGMA table_info(checkouts)")}
            if "store_ids" not in cols:
                self._db.execute("ALTER TABLE checkouts ADD COLUMN store_ids TEXT NOT NULL DEFAULT '[]'")

    # -- places -----------------------------------------------------------

    def save_places(self, places: list[dict]) -> None:
        with self._lock, self._db:
            self._db.executemany(
                "INSERT INTO places (id, lat, lon, tags) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET lat=excluded.lat, lon=excluded.lon, tags=excluded.tags",
                [(p["id"], p["lat"], p["lon"], json.dumps(p["tags"])) for p in places],
            )

    def get_place(self, place_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
        if not row:
            return None
        return {"id": row["id"], "lat": row["lat"], "lon": row["lon"], "tags": json.loads(row["tags"]), "address": row["address"]}

    def set_address(self, place_id: str, address: str) -> None:
        with self._lock, self._db:
            self._db.execute("UPDATE places SET address = ? WHERE id = ?", (address, place_id))

    # -- checkouts --------------------------------------------------------

    def create_checkout(
        self, checkout_id: str, device: str, kind: str, place_id: str | None, store_ids: list[str] | None = None
    ) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO checkouts (id, device, kind, place_id, created_at, store_ids) VALUES (?, ?, ?, ?, ?, ?)",
                (checkout_id, device, kind, place_id, time.time(), json.dumps(store_ids or [])),
            )

    def get_checkout(self, checkout_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM checkouts WHERE id = ?", (checkout_id,)).fetchone()
        return dict(row) if row else None

    def complete_checkout(self, checkout_id: str, pass_hours: float) -> bool:
        """Mark a checkout paid and grant what it bought. Idempotent: returns
        False (granting nothing) if it was already completed."""
        now = time.time()
        with self._lock, self._db:
            row = self._db.execute(
                "UPDATE checkouts SET status = 'paid' WHERE id = ? AND status = 'pending' RETURNING *",
                (checkout_id,),
            ).fetchone()
            if not row:
                return False
            if row["kind"] == "pass":
                current = self._db.execute("SELECT expires_at FROM passes WHERE device = ?", (row["device"],)).fetchone()
                start = max(now, current["expires_at"]) if current else now
                self._db.execute(
                    "INSERT INTO passes (device, expires_at) VALUES (?, ?) "
                    "ON CONFLICT(device) DO UPDATE SET expires_at = excluded.expires_at",
                    (row["device"], start + pass_hours * 3600),
                )
            # A checkout unlocks its bathroom (single) plus any boxer shops added on.
            ids = json.loads(row["store_ids"])
            if row["kind"] == "single":
                ids.append(row["place_id"])
            self._db.executemany(
                "INSERT OR IGNORE INTO unlocks (device, place_id, created_at) VALUES (?, ?, ?)",
                [(row["device"], pid, now) for pid in ids],
            )
            return True

    # -- entitlements -----------------------------------------------------

    def pass_expires_at(self, device: str) -> float | None:
        with self._lock:
            row = self._db.execute("SELECT expires_at FROM passes WHERE device = ?", (device,)).fetchone()
        if row and row["expires_at"] > time.time():
            return row["expires_at"]
        return None

    def unlocked_ids(self, device: str) -> set[str]:
        with self._lock:
            rows = self._db.execute("SELECT place_id FROM unlocks WHERE device = ?", (device,)).fetchall()
        return {r["place_id"] for r in rows}

    def can_see(self, device: str, place_id: str) -> bool:
        return self.pass_expires_at(device) is not None or place_id in self.unlocked_ids(device)
