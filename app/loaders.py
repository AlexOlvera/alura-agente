"""Lectura de documentos fuente.

Cada loader devuelve Passage: un bloque de texto con su procedencia (archivo y
localizador). La procedencia es obligatoria porque el agente cita sus fuentes;
un pasaje sin origen no sirve.

Los CSV producen dos cosas distintas:
  1. Passages -> para preguntas semanticas ("de que trata este archivo").
  2. Table     -> para preguntas agregadas ("cual fue el mas vendido en 2015"),
                  que se resuelven con pandas, no con busqueda vectorial.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

import pandas as pd

SUPPORTED_SUFFIXES = {".pdf", ".csv", ".txt", ".md"}


@dataclass
class Passage:
    text: str
    source: str          # nombre del archivo
    locator: str         # "pag. 4", "filas 120-140", "seccion 2"
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def citation(self) -> str:
        return f"{self.source} — {self.locator}"


@dataclass
class Table:
    name: str            # nombre del archivo
    frame: pd.DataFrame

    def profile(self) -> str:
        """Ficha tecnica legible que se le pasa al LLM para que sepa que existe."""
        lines = [f"Tabla: {self.name}", f"Filas: {len(self.frame)}", "Columnas:"]
        for col in self.frame.columns:
            serie = self.frame[col]
            dtype = str(serie.dtype)
            muestra = ", ".join(str(v) for v in serie.dropna().unique()[:5])
            lines.append(f"  - {col} ({dtype}) ejemplos: {muestra}")
        return "\n".join(lines)


def load_pdf(path: Path) -> Iterator[Passage]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    for numero, pagina in enumerate(reader.pages, start=1):
        texto = (pagina.extract_text() or "").strip()
        if texto:
            yield Passage(text=texto, source=path.name, locator=f"pag. {numero}")


def load_text(path: Path) -> Iterator[Passage]:
    texto = path.read_text(encoding="utf-8", errors="replace").strip()
    if texto:
        yield Passage(text=texto, source=path.name, locator="documento completo")


def load_csv(path: Path, rows_per_passage: int = 25) -> tuple[list[Passage], Table]:
    frame = pd.read_csv(path)
    tabla = Table(name=path.name, frame=frame)

    passages: list[Passage] = [
        Passage(text=tabla.profile(), source=path.name, locator="ficha tecnica", meta={"kind": "profile"})
    ]

    encabezado = " | ".join(str(c) for c in frame.columns)
    for inicio in range(0, len(frame), rows_per_passage):
        bloque = frame.iloc[inicio : inicio + rows_per_passage]
        filas = "\n".join(
            " | ".join("" if pd.isna(v) else str(v) for v in fila)
            for fila in bloque.itertuples(index=False, name=None)
        )
        passages.append(
            Passage(
                text=f"{encabezado}\n{filas}",
                source=path.name,
                locator=f"filas {inicio + 1}-{inicio + len(bloque)}",
                meta={"kind": "rows"},
            )
        )
    return passages, tabla


def load_directory(data_dir: Path) -> tuple[list[Passage], list[Table]]:
    """Recorre data/ y devuelve todo lo que sepa leer. Ignora lo demas en silencio."""
    passages: list[Passage] = []
    tables: list[Table] = []

    for path in sorted(data_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        suffix = path.suffix.lower()
        if suffix == ".pdf":
            passages.extend(load_pdf(path))
        elif suffix == ".csv":
            csv_passages, tabla = load_csv(path)
            passages.extend(csv_passages)
            tables.append(tabla)
        else:
            passages.extend(load_text(path))

    return passages, tables
