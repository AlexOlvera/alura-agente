"""Configuracion central. Todo se controla por variables de entorno.

Ningun modulo lee os.environ directamente: todos importan Settings desde aqui.
Eso permite cambiar de proveedor de embeddings, LLM o vector store sin tocar
codigo, y hace que los tests puedan inyectar una configuracion distinta.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


# Modelos que Google jubilo. Si un .env viejo los trae, se remapean al vigente
# en lugar de fallar con 404. Asi un despliegue con configuracion vieja sigue vivo.
_MODELOS_OBSOLETOS = {
    "gemini-2.5-flash": "gemini-3.6-flash",
    "gemini-2.0-flash": "gemini-3.6-flash",
    "gemini-1.5-flash": "gemini-3.6-flash",
    "gemini-1.5-pro": "gemini-3.6-flash",
}
_EMBED_OBSOLETOS = {
    "models/text-embedding-004": "gemini-embedding-001",
    "text-embedding-004": "gemini-embedding-001",
    "models/embedding-001": "gemini-embedding-001",
}


def _env_model(name: str, default: str, remap: dict[str, str]) -> str:
    valor = _env(name, default)
    return remap.get(valor, valor)


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    # --- Rutas ---
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(BASE_DIR / "data"))))
    index_dir: Path = field(default_factory=lambda: Path(_env("INDEX_DIR", str(BASE_DIR / "index"))))
    web_dir: Path = field(default_factory=lambda: BASE_DIR / "web")

    # --- Chunking ---
    chunk_size: int = field(default_factory=lambda: _env_int("CHUNK_SIZE", 900))
    chunk_overlap: int = field(default_factory=lambda: _env_int("CHUNK_OVERLAP", 150))

    # --- Embeddings ---
    # "local"  -> sentence-transformers, sin API key, corre en CPU
    # "gemini" -> API de Google, requiere GEMINI_API_KEY
    embedder: str = field(default_factory=lambda: _env("EMBEDDER", "local"))
    local_embed_model: str = field(
        default_factory=lambda: _env("LOCAL_EMBED_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    )
    gemini_embed_model: str = field(default_factory=lambda: _env_model("GEMINI_EMBED_MODEL", "gemini-embedding-001", _EMBED_OBSOLETOS))

    # --- Vector store ---
    # "numpy"  -> similitud coseno en memoria, cero dependencias nativas
    # "oracle" -> Oracle Database 23ai AI Vector Search (ver vectorstore.py)
    vector_store: str = field(default_factory=lambda: _env("VECTOR_STORE", "numpy"))
    top_k: int = field(default_factory=lambda: _env_int("TOP_K", 5))

    # --- LLM ---
    # "gemini" -> Google AI Studio
    # "echo"   -> stub sin red, para probar el cableado sin gastar cuota
    llm: str = field(default_factory=lambda: _env("LLM", "gemini"))
    gemini_model: str = field(default_factory=lambda: _env_model("GEMINI_MODEL", "gemini-3.6-flash", _MODELOS_OBSOLETOS))
    gemini_api_key: str = field(default_factory=lambda: _env("GEMINI_API_KEY", ""))

    # --- Servidor ---
    host: str = field(default_factory=lambda: _env("HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: _env_int("PORT", 8000))

    @property
    def vectors_path(self) -> Path:
        return self.index_dir / "vectors.npy"

    @property
    def chunks_path(self) -> Path:
        return self.index_dir / "chunks.jsonl"

    @property
    def tables_path(self) -> Path:
        return self.index_dir / "tables.json"


settings = Settings()
