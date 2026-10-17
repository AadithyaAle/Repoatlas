"""Print the OpenAPI document: `uv run python -m app.scripts.dump_openapi > openapi.json`.

Importing the app neither runs the lifespan (no worker) nor opens DB connections (the engine is
created lazily on first use).
"""

import json

from app.main import app


def main() -> None:
    print(json.dumps(app.openapi(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
