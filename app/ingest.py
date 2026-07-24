"""Script de ingesta. Uso: python -m app.ingest"""

from __future__ import annotations

import logging
import sys

from .agent import build_index
from .config import settings


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    print(f"Leyendo documentos de: {settings.data_dir}")
    print(f"Embedder: {settings.embedder}  |  Vector store: {settings.vector_store}")
    try:
        pasajes, trozos = build_index(settings)
    except Exception as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1
    print(f"\nListo. {pasajes} pasajes -> {trozos} trozos indexados en {settings.index_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
