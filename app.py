"""Entry point for Vercel, which looks for a module-level `app` in app.py.

Locally, keep using `python -m server.main`.
"""

from server.main import create_app

app = create_app()
