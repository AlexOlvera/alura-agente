"""Recepcion y validacion de archivos subidos.

Aceptar archivos de un formulario web es aceptar entrada hostil. Cada archivo
pasa por tres filtros antes de tocar el disco:

  1. Extension en lista blanca (.pdf .csv .txt .md). Nada mas se guarda.
  2. Tamano acotado. Un archivo gigante agota la memoria de la VM al indexar.
  3. Nombre saneado. "../../etc/passwd" o nombres con separadores de ruta se
     reducen a un nombre plano dentro de data/. Sin esto, un nombre malicioso
     podria escribir fuera de la carpeta prevista (path traversal).

La validacion vive aqui, separada del endpoint, para poder probarla sola.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

EXTENSIONES_OK = {".pdf", ".csv", ".txt", ".md"}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB por archivo
MAX_ARCHIVOS = 20


class UploadError(ValueError):
    pass


@dataclass
class ArchivoGuardado:
    nombre: str
    bytes: int


def nombre_seguro(nombre: str) -> str:
    """Reduce cualquier nombre a algo plano y seguro dentro de data/."""
    # Quedarse solo con la ultima parte descarta cualquier componente de ruta.
    base = Path(nombre.replace("\\", "/")).name
    # Normalizar acentos y descartar lo que no sea alfanumerico, guion, punto o _.
    base = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode("ascii")
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base).strip("._") or "archivo"
    # Evitar nombres ocultos o sin cuerpo.
    if base.startswith("."):
        base = "archivo" + base
    return base[:120]


def validar_extension(nombre: str) -> str:
    suf = Path(nombre).suffix.lower()
    if suf not in EXTENSIONES_OK:
        permitidas = ", ".join(sorted(EXTENSIONES_OK))
        raise UploadError(f"'{nombre}': tipo no permitido. Solo {permitidas}.")
    return suf


def guardar(data_dir: Path, nombre_original: str, contenido: bytes) -> ArchivoGuardado:
    """Valida y escribe un archivo en data/. Lanza UploadError si algo no cuadra."""
    validar_extension(nombre_original)
    if not contenido:
        raise UploadError(f"'{nombre_original}': el archivo esta vacio.")
    if len(contenido) > MAX_BYTES:
        mb = MAX_BYTES // (1024 * 1024)
        raise UploadError(f"'{nombre_original}': supera el limite de {mb} MB.")

    data_dir.mkdir(parents=True, exist_ok=True)
    destino = data_dir / nombre_seguro(nombre_original)

    # Si ya existe uno con ese nombre, versionar en vez de sobrescribir a ciegas.
    if destino.exists():
        tronco, sufijo = destino.stem, destino.suffix
        n = 2
        while (data_dir / f"{tronco}_{n}{sufijo}").exists():
            n += 1
        destino = data_dir / f"{tronco}_{n}{sufijo}"

    destino.write_bytes(contenido)
    return ArchivoGuardado(nombre=destino.name, bytes=len(contenido))


def eliminar(data_dir: Path, nombre: str) -> None:
    """Borra un archivo de data/. Saneo obligatorio: nunca sale de la carpeta.

    Igual que al subir, el nombre se reduce a algo plano antes de resolverlo. Sin
    esto, un nombre como '../otra/cosa' borraria fuera de data/. Ademas se verifica
    que la ruta final siga dentro de data/ tras resolver symlinks.
    """
    objetivo = (data_dir / nombre_seguro(nombre)).resolve()
    raiz = data_dir.resolve()
    if raiz not in objetivo.parents and objetivo != raiz:
        raise UploadError("ruta fuera de la carpeta de datos")
    if not objetivo.is_file():
        raise UploadError(f"'{nombre}': no existe")
    objetivo.unlink()
