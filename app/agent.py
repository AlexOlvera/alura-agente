"""El agente.

Enruta cada pregunta por uno de dos caminos:

  tabular - si hay CSV cargados y el LLM logra traducir la pregunta a un plan
            de consulta valido. Cubre agregaciones, que la busqueda vectorial
            no sabe hacer.
  rag     - recuperacion semantica sobre los trozos + redaccion con citas.

Si el camino tabular falla por lo que sea (plan invalido, columna inexistente,
tabla vacia), cae a RAG en vez de reventar. Degradar es mejor que fallar.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .chunking import Chunk, chunk_all
from .embeddings import Embedder, build_embedder
from .llm import LLMClient, LLMError, build_llm
from .loaders import Table, load_directory
from .tabular import PlanInvalido, construir_prompt, ejecutar_plan, parsear_plan
from .vectorstore import VectorStore, build_vector_store

log = logging.getLogger(__name__)

SISTEMA_RAG = """Eres un asistente que responde preguntas sobre la documentacion interna de una empresa.

Reglas estrictas:
- Responde UNICAMENTE con lo que aparezca en los fragmentos entregados.
- Si los fragmentos no contienen la respuesta, dilo claramente. No inventes.
- Cita las fuentes usando la etiqueta [n] que acompana a cada fragmento.
- Responde en el mismo idioma de la pregunta.
- Se breve y directo. Sin preambulos del tipo "segun los documentos".""" 

SISTEMA_TABLA = """Eres un analista que explica el resultado de una consulta sobre datos.

Te entregan la pregunta original y una tabla con el resultado ya calculado.
Redacta la respuesta en lenguaje natural apoyandote solo en esa tabla.
Se breve. Menciona las cifras relevantes. Responde en el idioma de la pregunta."""


@dataclass
class Fuente:
    n: int
    source: str
    locator: str
    excerpt: str
    score: float


@dataclass
class Respuesta:
    answer: str
    route: str                      # "tabular" | "rag" | "sin_datos"
    sources: list[Fuente] = field(default_factory=list)
    table: list[dict[str, Any]] | None = None
    plan: dict[str, Any] | None = None


class Agent:
    def __init__(
        self,
        store: VectorStore,
        embedder: Embedder,
        llm: LLMClient,
        tables: dict[str, Table],
        top_k: int = 5,
        settings=None,
    ) -> None:
        self._store = store
        self._embedder = embedder
        self._llm = llm
        self._tables = tables
        self._top_k = top_k
        self._settings = settings

    @property
    def tablas(self) -> list[str]:
        return sorted(self._tables)

    def __len__(self) -> int:
        return len(self._store)

    # ---------- camino tabular ----------

    def _intentar_tabular(self, pregunta: str) -> Respuesta | None:
        if not self._tables:
            return None
        try:
            bruto = self._llm.generate(
                system="Devuelve solo JSON valido.",
                user=construir_prompt(pregunta, self._tables),
                json_mode=True,
            )
        except LLMError as exc:
            log.warning("no se pudo generar el plan tabular: %s", exc)
            return None

        plan = parsear_plan(bruto)
        if plan is None:
            return None

        try:
            resultado = ejecutar_plan(plan, self._tables)
        except PlanInvalido as exc:
            log.info("plan rechazado (%s), cayendo a RAG", exc)
            return None

        if resultado.frame.empty:
            return None

        try:
            texto = self._llm.generate(
                system=SISTEMA_TABLA,
                user=f"Pregunta: {pregunta}\n\nResultado:\n{resultado.to_markdown()}",
            )
        except LLMError as exc:
            texto = f"Resultado de la consulta:\n\n{resultado.to_markdown()}\n\n(No se pudo redactar: {exc})"

        return Respuesta(
            answer=texto,
            route="tabular",
            sources=[Fuente(n=1, source=resultado.table, locator="consulta agregada", excerpt="", score=1.0)],
            table=resultado.frame.head(20).to_dict(orient="records"),
            plan=resultado.plan,
        )

    # ---------- camino RAG ----------

    def _rag(self, pregunta: str) -> Respuesta:
        vector = self._embedder.embed_query(pregunta)
        hits = self._store.search(vector, self._top_k)

        if not hits:
            return Respuesta(
                answer="No hay documentos indexados todavia. Coloca archivos en data/ y corre la ingesta.",
                route="sin_datos",
            )

        fuentes = [
            Fuente(
                n=i,
                source=h.chunk.source,
                locator=h.chunk.locator,
                excerpt=h.chunk.text[:280],
                score=round(h.score, 4),
            )
            for i, h in enumerate(hits, start=1)
        ]
        contexto = "\n\n".join(
            f"[{i}] ({h.chunk.citation})\n{h.chunk.text}" for i, h in enumerate(hits, start=1)
        )

        try:
            texto = self._llm.generate(
                system=SISTEMA_RAG,
                user=f"Fragmentos:\n\n{contexto}\n\n---\n\nPregunta: {pregunta}",
            )
        except LLMError as exc:
            texto = f"No se pudo generar la respuesta: {exc}"

        return Respuesta(answer=texto, route="rag", sources=fuentes)

    # ---------- entrada publica ----------

    def ask(self, pregunta: str) -> Respuesta:
        pregunta = (pregunta or "").strip()
        if not pregunta:
            return Respuesta(answer="Escribe una pregunta.", route="sin_datos")
        return self._intentar_tabular(pregunta) or self._rag(pregunta)

    def documentos(self) -> list[dict[str, Any]]:
        """Lista los archivos fuente actualmente indexados, con su conteo de trozos."""
        from collections import Counter

        conteo = Counter(c.source for c in getattr(self._store, "_chunks", []))
        return [{"nombre": nombre, "fragmentos": n} for nombre, n in sorted(conteo.items())]

    def reindex_from(self, store: VectorStore, tables: dict[str, Table]) -> None:
        """Reemplaza en caliente el indice y las tablas. Lo llama el ingestor tras subir archivos."""
        self._store = store
        self._tables = tables

    def vaciar(self) -> None:
        """Deja el agente sin conocimiento. Para cuando se borra la ultima estrella."""
        if self._settings is not None:
            self._store = build_vector_store(self._settings)
        elif hasattr(self._store, "_chunks"):
            self._store._chunks = []
            self._store._vectores = None
        self._tables = {}


def build_agent(settings) -> Agent:
    """Levanta el agente desde el indice ya construido en disco."""
    embedder = build_embedder(settings)
    store = build_vector_store(settings)
    if not store.load():
        log.warning("no hay indice en %s; corre `python -m app.ingest`", settings.index_dir)

    _, tablas = load_directory(settings.data_dir) if settings.data_dir.exists() else ([], [])
    return Agent(
        store=store,
        embedder=embedder,
        llm=build_llm(settings),
        tables={t.name: t for t in tablas},
        top_k=settings.top_k,
        settings=settings,
    )


def build_index(settings) -> tuple[int, int]:
    """Lee data/, trocea, vectoriza y guarda. Devuelve (pasajes, trozos)."""
    store, _tables, n_pas, n_chunks = _index_directory(settings)
    store.save()
    return n_pas, n_chunks


def _index_directory(settings) -> tuple[VectorStore, dict[str, Table], int, int]:
    """Nucleo compartido: lee data/, trocea, vectoriza y devuelve el store poblado.

    Separado de build_index para que la carga de archivos pueda reconstruir el
    indice en memoria y refrescar el agente sin pasar por disco ni reiniciar.
    """
    passages, tablas = load_directory(settings.data_dir)
    if not passages:
        raise RuntimeError(f"no se encontraron documentos legibles en {settings.data_dir}")

    chunks: list[Chunk] = chunk_all(passages, settings.chunk_size, settings.chunk_overlap)
    embedder = build_embedder(settings)
    vectores = embedder.embed_documents([c.text for c in chunks])

    store = build_vector_store(settings)
    store.add(chunks, vectores)
    return store, {t.name: t for t in tablas}, len(passages), len(chunks)


def reindex_and_refresh(settings, agent: "Agent") -> tuple[int, int]:
    """Reconstruye el indice desde data/ y actualiza el agente en caliente. Persiste a disco."""
    store, tablas, n_pas, n_chunks = _index_directory(settings)
    store.save()
    agent.reindex_from(store, tablas)
    return n_pas, n_chunks
