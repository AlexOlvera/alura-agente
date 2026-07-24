"""Preguntas agregadas sobre CSV.

La busqueda vectorial no sabe sumar. "Cual fue el producto mas vendido en
diciembre de 2015" no se contesta recuperando trozos parecidos: se contesta
filtrando, agrupando y ordenando. Por eso los CSV tienen su propio camino.

Como funciona: el LLM no escribe codigo, escribe un PLAN en JSON con un
vocabulario cerrado (filtros, group_by, agregacion, orden, limite). Python
valida ese plan contra el esquema real de la tabla y lo ejecuta con pandas.

No hay eval, no hay exec, no hay SQL concatenado. Un plan malformado o que
mencione columnas inexistentes se rechaza antes de tocar los datos. Es la
diferencia entre un agente que consulta y un agente que ejecuta lo que sea
que el modelo haya alucinado.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import pandas as pd

from .loaders import Table

OPERADORES = {"eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "between"}
AGREGACIONES = {"sum", "mean", "count", "min", "max", "nunique"}

PROMPT_PLAN = """Eres un traductor de preguntas a planes de consulta sobre tablas.

Tablas disponibles:
{esquemas}

Responde UNICAMENTE con un objeto JSON, sin texto alrededor y sin markdown.

Si la pregunta NO requiere calcular sobre la tabla (agregar, filtrar, ordenar,
contar), responde exactamente: {{"applicable": false}}

Si SI la requiere, responde con esta forma:
{{
  "applicable": true,
  "table": "<nombre exacto del archivo>",
  "filters": [{{"column": "<columna>", "op": "<eq|ne|gt|gte|lt|lte|contains|in|between>", "value": <valor>}}],
  "group_by": ["<columna>"],
  "aggregate": {{"column": "<columna>", "func": "<sum|mean|count|min|max|nunique>"}},
  "sort_desc": true,
  "limit": 5
}}

Reglas:
- Usa solo nombres de columna que aparezcan en el esquema, tal cual.
- "filters", "group_by" y "aggregate" son opcionales; omite lo que no apliques.
- Para rangos de fecha usa op "between" con value = ["inicio", "fin"] en ISO.
- Para texto parcial usa "contains".

Pregunta: {pregunta}"""


@dataclass
class TableResult:
    table: str
    frame: pd.DataFrame
    plan: dict[str, Any]

    def to_markdown(self, max_rows: int = 20) -> str:
        recorte = self.frame.head(max_rows)
        return recorte.to_markdown(index=False)


class PlanInvalido(ValueError):
    pass


def _validar_columna(nombre: Any, frame: pd.DataFrame) -> str:
    if not isinstance(nombre, str) or nombre not in frame.columns:
        raise PlanInvalido(f"columna inexistente: {nombre!r}")
    return nombre


def _aplicar_filtro(frame: pd.DataFrame, filtro: dict[str, Any]) -> pd.DataFrame:
    columna = _validar_columna(filtro.get("column"), frame)
    op = filtro.get("op")
    valor = filtro.get("value")
    if op not in OPERADORES:
        raise PlanInvalido(f"operador no permitido: {op!r}")

    serie = frame[columna]
    # Para comparaciones de rango sobre texto con pinta de fecha, convertir ayuda.
    if op in {"gt", "gte", "lt", "lte", "between"} and serie.dtype == object:
        convertida = pd.to_datetime(serie, errors="coerce")
        if convertida.notna().mean() > 0.8:
            serie = convertida
            if op == "between" and isinstance(valor, list):
                valor = [pd.to_datetime(v, errors="coerce") for v in valor]
            else:
                valor = pd.to_datetime(valor, errors="coerce")

    if op == "eq":
        return frame[serie == valor]
    if op == "ne":
        return frame[serie != valor]
    if op == "gt":
        return frame[serie > valor]
    if op == "gte":
        return frame[serie >= valor]
    if op == "lt":
        return frame[serie < valor]
    if op == "lte":
        return frame[serie <= valor]
    if op == "contains":
        return frame[serie.astype(str).str.contains(str(valor), case=False, na=False)]
    if op == "in":
        if not isinstance(valor, list):
            raise PlanInvalido("op 'in' requiere una lista")
        return frame[serie.isin(valor)]
    if op == "between":
        if not isinstance(valor, list) or len(valor) != 2:
            raise PlanInvalido("op 'between' requiere [inicio, fin]")
        return frame[(serie >= valor[0]) & (serie <= valor[1])]
    raise PlanInvalido(f"operador no manejado: {op!r}")


def ejecutar_plan(plan: dict[str, Any], tablas: dict[str, Table]) -> TableResult:
    nombre = plan.get("table")
    if nombre not in tablas:
        raise PlanInvalido(f"tabla inexistente: {nombre!r}")

    frame = tablas[nombre].frame.copy()

    for filtro in plan.get("filters") or []:
        if not isinstance(filtro, dict):
            raise PlanInvalido("cada filtro debe ser un objeto")
        frame = _aplicar_filtro(frame, filtro)

    group_by = [_validar_columna(c, frame) for c in (plan.get("group_by") or [])]
    agregado = plan.get("aggregate") or {}

    if group_by and agregado:
        columna = _validar_columna(agregado.get("column"), frame)
        func = agregado.get("func")
        if func not in AGREGACIONES:
            raise PlanInvalido(f"agregacion no permitida: {func!r}")
        frame = frame.groupby(group_by, dropna=False)[columna].agg(func).reset_index()
        orden = columna
    elif agregado:
        columna = _validar_columna(agregado.get("column"), frame)
        func = agregado.get("func")
        if func not in AGREGACIONES:
            raise PlanInvalido(f"agregacion no permitida: {func!r}")
        valor = frame[columna].agg(func)
        frame = pd.DataFrame({f"{func}_{columna}": [valor]})
        orden = None
    else:
        orden = None

    if orden:
        frame = frame.sort_values(orden, ascending=not bool(plan.get("sort_desc", True)))

    limite = plan.get("limit")
    if isinstance(limite, int) and limite > 0:
        frame = frame.head(limite)

    return TableResult(table=nombre, frame=frame, plan=plan)


def construir_prompt(pregunta: str, tablas: dict[str, Table]) -> str:
    esquemas = "\n\n".join(t.profile() for t in tablas.values())
    return PROMPT_PLAN.format(esquemas=esquemas, pregunta=pregunta)


def parsear_plan(bruto: str) -> dict[str, Any] | None:
    texto = bruto.strip()
    if texto.startswith("```"):
        texto = texto.split("```")[1] if "```" in texto[3:] else texto[3:]
        texto = texto.removeprefix("json").strip()
    try:
        plan = json.loads(texto)
    except json.JSONDecodeError:
        return None
    if not isinstance(plan, dict) or not plan.get("applicable"):
        return None
    return plan
