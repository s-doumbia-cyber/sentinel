"""sentinel-ml-serve: runs the inference API with uvicorn."""

from __future__ import annotations

import argparse
import logging
import os

import uvicorn

from .api import create_app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sentinel-ml-serve")
    parser.add_argument("--host", default=os.environ.get("SENTINEL_ML_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SENTINEL_ML_PORT", "8000")))
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
