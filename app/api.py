"""API HTTP.

El agente se construye una sola vez al arrancar (lifespan) y se reusa en cada
peticion. Cargar el indice y el modelo de embeddings por request tumbaria una
VM de 2 OCPU en el primer usuario concurrente.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from dataclasses import asdict

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .agent import Agent, build_agent, reindex_and_refresh
from .config import settings
from .uploads import MAX_ARCHIVOS, UploadError, eliminar, guardar

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("alura-agente")

_estado: dict[str, Agent | None] = {"agent": None}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("construyendo agente (embedder=%s llm=%s)", settings.embedder, settings.llm)
    _estado["agent"] = build_agent(settings)
    log.info("agente listo: %d trozos, tablas=%s", len(_estado["agent"]), _estado["agent"].tablas)
    yield
    _estado["agent"] = None


app = FastAPI(title="Alura Agente", version="1.0.0", lifespan=lifespan)


class Pregunta(BaseModel):
    question: str = Field(min_length=1, max_length=2000)


def _agente() -> Agent:
    agente = _estado["agent"]
    if agente is None:
        raise HTTPException(status_code=503, detail="el agente todavia no esta listo")
    return agente


@app.get("/api/health")
def health() -> dict:
    agente = _estado["agent"]
    return {
        "status": "ok" if agente else "starting",
        "chunks": len(agente) if agente else 0,
        "tables": agente.tablas if agente else [],
        "embedder": settings.embedder,
        "llm": settings.llm,
    }


@app.post("/api/ask")
def ask(payload: Pregunta) -> dict:
    respuesta = _agente().ask(payload.question)
    return asdict(respuesta)


@app.get("/api/diagnostico")
def diagnostico() -> dict:
    """Prueba cada proveedor de LLM configurado y reporta su estado.

    Con el sistema de fallback, esto revisa TODOS los proveedores de la cascada
    y dice cual responde, cual esta sin cuota, y cual tiene error de config.
    """
    import os

    from .llm import (
        CuotaAgotada,
        GeminiClient,
        LLMError,
        OpenAICompatClient,
        _OPENAI_COMPAT,
    )

    def probar(nombre: str, cliente) -> dict:
        try:
            r = cliente.generate(system="Responde OK.", user="ping")
            return {"proveedor": nombre, "estado": "ok", "detalle": r[:40]}
        except CuotaAgotada as exc:
            return {"proveedor": nombre, "estado": "sin_cuota", "reintentar_en": exc.reintentar_en}
        except LLMError as exc:
            return {"proveedor": nombre, "estado": "error", "detalle": str(exc)[:120]}

    resultados = []
    modo = settings.llm.lower()

    if modo == "echo":
        return {"modo": "echo", "detalle": "sin LLM real (modo de prueba)"}

    # Determinar que proveedores revisar
    orden = (os.environ.get("LLM_FALLBACK_ORDER", "") or "gemini,groq,cerebras").split(",") \
        if modo == "fallback" else [modo]

    for prov in (p.strip().lower() for p in orden if p.strip()):
        try:
            if prov == "gemini":
                if not settings.gemini_api_key:
                    resultados.append({"proveedor": "gemini", "estado": "sin_key"})
                    continue
                resultados.append(probar("gemini", GeminiClient(settings.gemini_api_key, settings.gemini_model)))
            elif prov in _OPENAI_COMPAT:
                base, env_key, modelo_def = _OPENAI_COMPAT[prov]
                key = os.environ.get(env_key, "").strip()
                if not key:
                    resultados.append({"proveedor": prov, "estado": "sin_key"})
                    continue
                modelo = os.environ.get(f"{prov.upper()}_MODEL", "").strip() or modelo_def
                resultados.append(probar(prov, OpenAICompatClient(key, base, modelo, prov)))
        except Exception as exc:  # noqa: BLE001
            resultados.append({"proveedor": prov, "estado": "error", "detalle": str(exc)[:120]})

    hay_ok = any(r.get("estado") == "ok" for r in resultados)
    return {
        "modo": modo,
        "operativo": hay_ok,
        "resumen": "al menos un proveedor responde" if hay_ok else "ningun proveedor disponible ahora",
        "proveedores": resultados,
    }


@app.get("/api/documents")
def documents() -> dict:
    return {"documents": _agente().documentos()}


@app.post("/api/upload")
async def upload(files: list[UploadFile] = File(...)) -> dict:
    """Recibe archivos, los valida, los guarda y reconstruye el indice en caliente."""
    agente = _agente()
    if len(files) > MAX_ARCHIVOS:
        raise HTTPException(status_code=400, detail=f"maximo {MAX_ARCHIVOS} archivos por carga")

    guardados, errores = [], []
    for archivo in files:
        try:
            contenido = await archivo.read()
            resultado = guardar(settings.data_dir, archivo.filename or "archivo", contenido)
            guardados.append({"nombre": resultado.nombre, "bytes": resultado.bytes})
        except UploadError as exc:
            errores.append(str(exc))
        except Exception as exc:  # noqa: BLE001
            log.exception("fallo guardando %s", archivo.filename)
            errores.append(f"'{archivo.filename}': error inesperado ({exc})")

    if not guardados:
        raise HTTPException(status_code=400, detail={"mensaje": "no se guardo ningun archivo", "errores": errores})

    try:
        n_pas, n_chunks = reindex_and_refresh(settings, agente)
    except Exception as exc:  # noqa: BLE001
        log.exception("fallo el reindexado")
        raise HTTPException(status_code=500, detail=f"archivos guardados, pero fallo el reindexado: {exc}")

    return {
        "guardados": guardados,
        "errores": errores,
        "fragmentos": n_chunks,
        "documentos": agente.documentos(),
    }


class Borrado(BaseModel):
    nombre: str = Field(min_length=1, max_length=300)


@app.post("/api/delete")
def delete(payload: Borrado) -> dict:
    """Borra una estrella (documento) y reconstruye el indice.

    Si era la ultima, el indice queda vacio: se limpia en lugar de reindexar,
    porque reindexar sin documentos lanzaria error.
    """
    agente = _agente()
    try:
        eliminar(settings.data_dir, payload.nombre)
    except UploadError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    # Quedan documentos? -> reindexar. Ninguno? -> vaciar el indice en caliente.
    from .loaders import SUPPORTED_SUFFIXES

    quedan = any(
        p.is_file() and p.suffix.lower() in SUPPORTED_SUFFIXES
        for p in settings.data_dir.rglob("*")
    )
    if quedan:
        try:
            _, n_chunks = reindex_and_refresh(settings, agente)
        except Exception as exc:  # noqa: BLE001
            log.exception("fallo el reindexado tras borrar")
            raise HTTPException(status_code=500, detail=f"estrella borrada, pero fallo el reindexado: {exc}")
    else:
        agente.vaciar()
        n_chunks = 0

    return {"fragmentos": n_chunks, "documentos": agente.documentos()}


class Toggle(BaseModel):
    nombre: str = Field(min_length=1, max_length=300)
    activa: bool


@app.post("/api/toggle")
def toggle(payload: Toggle) -> dict:
    """Enciende o apaga una estrella. Apagada = sigue en la lista, fuera de las busquedas."""
    agente = _agente()
    agente.set_activa(payload.nombre, payload.activa)
    # health refleja cuantos fragmentos quedan activos
    return {"documentos": agente.documentos()}


if settings.web_dir.exists():
    app.mount("/static", StaticFiles(directory=settings.web_dir), name="static")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(settings.web_dir / "index.html")
