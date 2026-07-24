"""Cliente de LLM detras de una interfaz.

Se habla con Gemini por REST en vez de por SDK a proposito: el endpoint
generateContent es estable, y una dependencia menos es una cosa menos que
puede romperse al desplegar en la VM ARM.

EchoClient permite arrancar la app y probar ingesta, recuperacion y frontend
sin consumir cuota ni tener API key.
"""

from __future__ import annotations

import json
from typing import Protocol

import httpx

_BASE = "https://generativelanguage.googleapis.com/v1beta"


class LLMError(RuntimeError):
    pass


class LLMClient(Protocol):
    def generate(self, system: str, user: str, json_mode: bool = False) -> str: ...


class GeminiClient:
    def __init__(self, api_key: str, model: str, timeout: float = 60.0) -> None:
        if not api_key:
            raise RuntimeError("LLM=gemini requiere GEMINI_API_KEY")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout

    def generate(self, system: str, user: str, json_mode: bool = False) -> str:
        cuerpo: dict = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 2048},
        }
        if json_mode:
            cuerpo["generationConfig"]["responseMimeType"] = "application/json"

        url = f"{_BASE}/models/{self._model}:generateContent"
        try:
            respuesta = httpx.post(
                url,
                headers={"x-goog-api-key": self._api_key, "Content-Type": "application/json"},
                json=cuerpo,
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise LLMError(f"no se pudo contactar a Gemini: {exc}") from exc

        if respuesta.status_code == 429:
            raise LLMError("cuota del free tier agotada (429). Espera un momento o revisa tus limites en AI Studio.")
        if respuesta.status_code >= 400:
            raise LLMError(f"Gemini respondio {respuesta.status_code}: {respuesta.text[:300]}")

        datos = respuesta.json()
        candidatos = datos.get("candidates") or []
        if not candidatos:
            raise LLMError("Gemini no devolvio ninguna respuesta")
        partes = candidatos[0].get("content", {}).get("parts") or []
        texto = "".join(p.get("text", "") for p in partes).strip()
        if not texto:
            raise LLMError("Gemini devolvio una respuesta vacia")
        return texto


class EchoClient:
    """Devuelve el contexto recibido. Util para verificar que el RAG recupera bien."""

    def generate(self, system: str, user: str, json_mode: bool = False) -> str:
        if json_mode:
            return json.dumps({"answerable": False, "reason": "EchoClient no razona"})
        return (
            "[modo echo — sin LLM real]\n\n"
            "Esto es lo que el recuperador le habria pasado al modelo:\n\n" + user[:1500]
        )


def build_llm(settings) -> LLMClient:
    nombre = settings.llm.lower()
    if nombre == "gemini":
        return GeminiClient(settings.gemini_api_key, settings.gemini_model)
    if nombre == "echo":
        return EchoClient()
    raise ValueError(f"LLM desconocido: {settings.llm}")
