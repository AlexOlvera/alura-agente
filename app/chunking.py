"""Troceado de pasajes.

Cortar a ciegas cada N caracteres parte oraciones a la mitad y degrada la
recuperacion. Aqui se corta en limites de parrafo/oracion y solo se recurre al
corte duro cuando una sola oracion excede el tamano objetivo.

El solapamiento existe para que una respuesta que cae justo en la frontera
entre dos trozos siga siendo recuperable desde cualquiera de los dos.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .loaders import Passage

_SEPARADORES = re.compile(r"(?<=[.!?:;])\s+|\n{2,}|\n")


@dataclass
class Chunk:
    text: str
    source: str
    locator: str
    index: int = 0
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def citation(self) -> str:
        return f"{self.source} — {self.locator}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "text": self.text,
            "source": self.source,
            "locator": self.locator,
            "index": self.index,
            "meta": self.meta,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Chunk":
        return cls(
            text=raw["text"],
            source=raw["source"],
            locator=raw["locator"],
            index=raw.get("index", 0),
            meta=raw.get("meta", {}),
        )


def _partir_duro(texto: str, size: int) -> list[str]:
    return [texto[i : i + size] for i in range(0, len(texto), size)]


def _unidades(texto: str, size: int) -> list[str]:
    """Divide en oraciones/parrafos; parte a la fuerza lo que siga siendo enorme."""
    unidades: list[str] = []
    for pieza in _SEPARADORES.split(texto):
        pieza = (pieza or "").strip()
        if not pieza:
            continue
        if len(pieza) > size:
            unidades.extend(_partir_duro(pieza, size))
        else:
            unidades.append(pieza)
    return unidades


def chunk_passage(passage: Passage, size: int, overlap: int) -> list[Chunk]:
    if len(passage.text) <= size:
        return [Chunk(text=passage.text, source=passage.source, locator=passage.locator, meta=dict(passage.meta))]

    chunks: list[Chunk] = []
    actual: list[str] = []
    largo = 0

    def cerrar() -> None:
        nonlocal actual, largo
        if not actual:
            return
        chunks.append(
            Chunk(
                text=" ".join(actual).strip(),
                source=passage.source,
                locator=passage.locator,
                index=len(chunks),
                meta=dict(passage.meta),
            )
        )
        # Arrastra la cola como solapamiento del siguiente trozo.
        cola: list[str] = []
        acumulado = 0
        for unidad in reversed(actual):
            if acumulado + len(unidad) > overlap:
                break
            cola.insert(0, unidad)
            acumulado += len(unidad)
        actual = cola
        largo = acumulado

    for unidad in _unidades(passage.text, size):
        if largo + len(unidad) > size and actual:
            cerrar()
        actual.append(unidad)
        largo += len(unidad) + 1

    if actual:
        chunks.append(
            Chunk(
                text=" ".join(actual).strip(),
                source=passage.source,
                locator=passage.locator,
                index=len(chunks),
                meta=dict(passage.meta),
            )
        )
    return chunks


def chunk_all(passages: list[Passage], size: int, overlap: int) -> list[Chunk]:
    if overlap >= size:
        raise ValueError("CHUNK_OVERLAP debe ser menor que CHUNK_SIZE")
    salida: list[Chunk] = []
    for passage in passages:
        salida.extend(chunk_passage(passage, size, overlap))
    return salida
