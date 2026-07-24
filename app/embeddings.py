"""Embeddings detras de una interfaz.

Tres implementaciones:
  LocalEmbedder  - sentence-transformers en CPU. Sin API key, sin cuota, sin red
                   despues de la primera descarga del modelo.
  GeminiEmbedder - API de Google. Mas preciso, consume cuota del free tier.
  HashEmbedder   - deterministico y sin dependencias. Solo para pruebas del
                   cableado; la calidad de recuperacion es mala a proposito.

Cambiar de uno a otro es cambiar EMBEDDER en el .env. Nada mas arriba en la
pila sabe cual esta activo.
"""

from __future__ import annotations

import hashlib
from typing import Protocol

import numpy as np


class Embedder(Protocol):
    dimension: int

    def embed_documents(self, textos: list[str]) -> np.ndarray: ...

    def embed_query(self, texto: str) -> np.ndarray: ...


def _normalizar(matriz: np.ndarray) -> np.ndarray:
    """L2. Con vectores unitarios, el coseno es un producto punto."""
    normas = np.linalg.norm(matriz, axis=1, keepdims=True)
    normas[normas == 0] = 1.0
    return matriz / normas


class LocalEmbedder:
    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(model_name)
        self.dimension = int(self._model.get_sentence_embedding_dimension())

    def embed_documents(self, textos: list[str]) -> np.ndarray:
        vectores = self._model.encode(textos, batch_size=32, show_progress_bar=False, convert_to_numpy=True)
        return _normalizar(np.asarray(vectores, dtype=np.float32))

    def embed_query(self, texto: str) -> np.ndarray:
        return self.embed_documents([texto])[0]


class GeminiEmbedder:
    """Habla por REST, igual que el cliente de LLM. Una dependencia menos."""

    _BASE = "https://generativelanguage.googleapis.com/v1beta"

    def __init__(self, api_key: str, model: str) -> None:
        if not api_key:
            raise RuntimeError("EMBEDDER=gemini requiere GEMINI_API_KEY")
        self._api_key = api_key
        self._model = model if model.startswith("models/") else f"models/{model}"
        self.dimension = 768

    def _embed(self, textos: list[str], task_type: str) -> np.ndarray:
        import httpx

        url = f"{self._BASE}/{self._model}:batchEmbedContents"
        cuerpo = {
            "requests": [
                {"model": self._model, "content": {"parts": [{"text": t}]}, "taskType": task_type} for t in textos
            ]
        }
        respuesta = httpx.post(
            url,
            headers={"x-goog-api-key": self._api_key, "Content-Type": "application/json"},
            json=cuerpo,
            timeout=60.0,
        )
        if respuesta.status_code >= 400:
            raise RuntimeError(f"Gemini embeddings respondio {respuesta.status_code}: {respuesta.text[:300]}")
        datos = respuesta.json()
        vectores = np.asarray([e["values"] for e in datos["embeddings"]], dtype=np.float32)
        return _normalizar(vectores)

    def embed_documents(self, textos: list[str]) -> np.ndarray:
        salida = [self._embed(textos[i : i + 100], "RETRIEVAL_DOCUMENT") for i in range(0, len(textos), 100)]
        return np.vstack(salida) if salida else np.zeros((0, self.dimension), dtype=np.float32)

    def embed_query(self, texto: str) -> np.ndarray:
        return self._embed([texto], "RETRIEVAL_QUERY")[0]


class HashEmbedder:
    """Bolsa de palabras proyectada por hash. Sin red, sin modelo, deterministico."""

    def __init__(self, dimension: int = 256) -> None:
        self.dimension = dimension

    def _vector(self, texto: str) -> np.ndarray:
        vector = np.zeros(self.dimension, dtype=np.float32)
        for palabra in texto.lower().split():
            digest = hashlib.md5(palabra.encode("utf-8")).digest()
            vector[int.from_bytes(digest[:4], "little") % self.dimension] += 1.0
        return vector

    def embed_documents(self, textos: list[str]) -> np.ndarray:
        if not textos:
            return np.zeros((0, self.dimension), dtype=np.float32)
        return _normalizar(np.vstack([self._vector(t) for t in textos]))

    def embed_query(self, texto: str) -> np.ndarray:
        return self.embed_documents([texto])[0]


def build_embedder(settings) -> Embedder:
    nombre = settings.embedder.lower()
    if nombre == "local":
        return LocalEmbedder(settings.local_embed_model)
    if nombre == "gemini":
        return GeminiEmbedder(settings.gemini_api_key, settings.gemini_embed_model)
    if nombre == "hash":
        return HashEmbedder()
    raise ValueError(f"EMBEDDER desconocido: {settings.embedder}")
