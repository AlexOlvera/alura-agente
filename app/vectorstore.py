"""Almacen de vectores detras de una interfaz.

NumpyStore es el default: similitud coseno sobre una matriz en memoria. Para
corpus de hasta ~100k trozos una multiplicacion matriz-vector es
instantanea y no arrastra dependencias nativas, lo que importa cuando el
destino es una VM ARM del free tier de OCI.

OracleVectorStore existe como interfaz declarada, no implementada. El plan es
Oracle Database 23ai AI Vector Search, que trae VECTOR como tipo nativo:

    CREATE TABLE chunks (
        id        NUMBER GENERATED ALWAYS AS IDENTITY,
        source    VARCHAR2(400),
        locator   VARCHAR2(200),
        content   CLOB,
        embedding VECTOR(384, FLOAT32)
    );

    SELECT source, locator, content
      FROM chunks
     ORDER BY VECTOR_DISTANCE(embedding, :consulta, COSINE)
     FETCH FIRST :k ROWS ONLY;

Autonomous Database esta en el Always Free de OCI (2 instancias, 20 GB c/u) y
AI Vector Search no cobra extra, asi que la migracion no cambia el costo del
proyecto: solo mueve el indice de un proceso Python a la base de datos.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from .chunking import Chunk


@dataclass
class Hit:
    chunk: Chunk
    score: float


class VectorStore(Protocol):
    def add(self, chunks: list[Chunk], vectores: np.ndarray) -> None: ...

    def search(self, consulta: np.ndarray, k: int) -> list[Hit]: ...

    def save(self) -> None: ...

    def load(self) -> bool: ...

    def __len__(self) -> int: ...


class NumpyStore:
    def __init__(self, vectors_path: Path, chunks_path: Path) -> None:
        self._vectors_path = vectors_path
        self._chunks_path = chunks_path
        self._vectores: np.ndarray | None = None
        self._chunks: list[Chunk] = []

    def __len__(self) -> int:
        return len(self._chunks)

    def add(self, chunks: list[Chunk], vectores: np.ndarray) -> None:
        if len(chunks) != len(vectores):
            raise ValueError("chunks y vectores deben tener el mismo largo")
        self._chunks = list(chunks)
        self._vectores = np.asarray(vectores, dtype=np.float32)

    def search(self, consulta: np.ndarray, k: int) -> list[Hit]:
        if self._vectores is None or not len(self._chunks):
            return []
        puntajes = self._vectores @ np.asarray(consulta, dtype=np.float32)
        k = min(k, len(puntajes))
        # argpartition evita ordenar el arreglo completo para quedarse con k.
        candidatos = np.argpartition(-puntajes, k - 1)[:k]
        candidatos = candidatos[np.argsort(-puntajes[candidatos])]
        return [Hit(chunk=self._chunks[i], score=float(puntajes[i])) for i in candidatos]

    def save(self) -> None:
        self._vectors_path.parent.mkdir(parents=True, exist_ok=True)
        if self._vectores is None:
            raise RuntimeError("no hay vectores que guardar")
        np.save(self._vectors_path, self._vectores)
        with self._chunks_path.open("w", encoding="utf-8") as archivo:
            for chunk in self._chunks:
                archivo.write(json.dumps(chunk.to_dict(), ensure_ascii=False) + "\n")

    def load(self) -> bool:
        if not (self._vectors_path.exists() and self._chunks_path.exists()):
            return False
        self._vectores = np.load(self._vectors_path)
        with self._chunks_path.open(encoding="utf-8") as archivo:
            self._chunks = [Chunk.from_dict(json.loads(linea)) for linea in archivo if linea.strip()]
        return True


class OracleVectorStore:
    def __init__(self, *_args, **_kwargs) -> None:
        raise NotImplementedError(
            "VECTOR_STORE=oracle todavia no esta implementado. "
            "Ver el docstring de este modulo para el esquema y la consulta previstos."
        )


def build_vector_store(settings) -> VectorStore:
    nombre = settings.vector_store.lower()
    if nombre == "numpy":
        return NumpyStore(settings.vectors_path, settings.chunks_path)
    if nombre == "oracle":
        return OracleVectorStore()
    raise ValueError(f"VECTOR_STORE desconocido: {settings.vector_store}")
