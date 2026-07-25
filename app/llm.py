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


class CuotaAgotada(LLMError):
    """El free tier de Gemini respondio 429. El frontend lo muestra bonito."""

    def __init__(self, reintentar_en: int = 60) -> None:
        self.reintentar_en = reintentar_en
        super().__init__("cuota agotada")


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
            # Google a veces sugiere cuanto esperar en el cuerpo (retryDelay).
            reintentar = 60
            try:
                cuerpo = respuesta.json()
                for detalle in cuerpo.get("error", {}).get("details", []):
                    delay = detalle.get("retryDelay", "")
                    if delay.endswith("s") and delay[:-1].isdigit():
                        reintentar = int(delay[:-1])
                        break
            except Exception:  # noqa: BLE001
                pass
            raise CuotaAgotada(reintentar_en=reintentar)
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


class OpenAICompatClient:
    """Cliente para proveedores con API estilo OpenAI (Groq, Cerebras, etc.).

    Groq y Cerebras exponen /chat/completions con el mismo formato que OpenAI,
    asi que un solo cliente sirve para ambos cambiando la URL base y el modelo.
    Esto permite sumar proveedores sin escribir un cliente nuevo para cada uno.
    """

    def __init__(self, api_key: str, base_url: str, model: str, nombre: str, timeout: float = 60.0) -> None:
        if not api_key:
            raise RuntimeError(f"{nombre} requiere API key")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._nombre = nombre
        self._timeout = timeout

    def generate(self, system: str, user: str, json_mode: bool = False) -> str:
        cuerpo: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "max_tokens": 2048,
        }
        if json_mode:
            cuerpo["response_format"] = {"type": "json_object"}

        try:
            respuesta = httpx.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"},
                json=cuerpo,
                timeout=self._timeout,
            )
        except httpx.HTTPError as exc:
            raise LLMError(f"no se pudo contactar a {self._nombre}: {exc}") from exc

        if respuesta.status_code == 429:
            reintentar = 60
            try:
                ra = respuesta.headers.get("retry-after")
                if ra and ra.isdigit():
                    reintentar = int(ra)
            except Exception:  # noqa: BLE001
                pass
            raise CuotaAgotada(reintentar_en=reintentar)
        if respuesta.status_code >= 400:
            raise LLMError(f"{self._nombre} respondio {respuesta.status_code}: {respuesta.text[:300]}")

        datos = respuesta.json()
        opciones = datos.get("choices") or []
        if not opciones:
            raise LLMError(f"{self._nombre} no devolvio ninguna respuesta")
        texto = (opciones[0].get("message", {}).get("content") or "").strip()
        if not texto:
            raise LLMError(f"{self._nombre} devolvio una respuesta vacia")
        return texto


class FallbackClient:
    """Prueba varios proveedores en orden. Si uno se agota o falla, salta al siguiente.

    El usuario nunca ve el salto: solo recibe la respuesta del primero que funcione.
    Solo si TODOS fallan por cuota se propaga CuotaAgotada (para el mensaje bonito);
    si fallan por otra razon, se propaga el ultimo error real.
    """

    def __init__(self, proveedores: list[tuple[str, LLMClient]]) -> None:
        if not proveedores:
            raise RuntimeError("FallbackClient necesita al menos un proveedor")
        self._proveedores = proveedores  # [(nombre, cliente), ...]

    def generate(self, system: str, user: str, json_mode: bool = False) -> str:
        import logging
        log = logging.getLogger("app.llm")

        ultima_cuota: CuotaAgotada | None = None
        ultimo_error: Exception | None = None

        for nombre, cliente in self._proveedores:
            try:
                texto = cliente.generate(system=system, user=user, json_mode=json_mode)
                if len(self._proveedores) > 1:
                    log.info("respuesta via %s", nombre)
                return texto
            except CuotaAgotada as exc:
                log.warning("%s sin cuota, probando siguiente", nombre)
                ultima_cuota = exc
                continue
            except LLMError as exc:
                log.warning("%s fallo (%s), probando siguiente", nombre, exc)
                ultimo_error = exc
                continue

        # Todos fallaron. Si al menos uno fue por cuota, mostramos el mensaje de cuota.
        if ultima_cuota is not None:
            raise ultima_cuota
        raise ultimo_error or LLMError("todos los proveedores fallaron")


# Catalogo de proveedores estilo OpenAI: nombre -> (url base, variable de key, modelo por defecto)
_OPENAI_COMPAT = {
    "groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY", "llama-3.3-70b-versatile"),
    "cerebras": ("https://api.cerebras.ai/v1", "CEREBRAS_API_KEY", "llama-3.3-70b"),
}


def build_llm(settings) -> LLMClient:
    """Construye el cliente segun settings.llm.

    settings.llm puede ser:
      - "echo": stub sin red
      - "gemini": solo Gemini
      - "groq" / "cerebras": solo ese proveedor
      - "fallback": cascada de todos los que tengan API key configurada
    """
    import os

    nombre = settings.llm.lower()

    if nombre == "echo":
        return EchoClient()

    if nombre == "gemini":
        return GeminiClient(settings.gemini_api_key, settings.gemini_model)

    if nombre in _OPENAI_COMPAT:
        base, env_key, modelo_def = _OPENAI_COMPAT[nombre]
        key = os.environ.get(env_key, "").strip()
        modelo = os.environ.get(f"{nombre.upper()}_MODEL", "").strip() or modelo_def
        return OpenAICompatClient(key, base, modelo, nombre)

    if nombre == "fallback":
        return _build_fallback(settings)

    raise ValueError(f"LLM desconocido: {settings.llm}")


def _build_fallback(settings) -> LLMClient:
    """Arma la cascada con todos los proveedores que tengan credenciales.

    El orden lo fija GEMINI_FALLBACK_ORDER (por defecto: gemini, groq, cerebras).
    Solo se incluyen los que tengan su API key; los demas se omiten en silencio.
    """
    import logging
    import os

    log = logging.getLogger("app.llm")

    orden = (os.environ.get("LLM_FALLBACK_ORDER", "") or "gemini,groq,cerebras").split(",")
    proveedores: list[tuple[str, LLMClient]] = []

    for prov in (p.strip().lower() for p in orden if p.strip()):
        try:
            if prov == "gemini" and settings.gemini_api_key:
                proveedores.append(("gemini", GeminiClient(settings.gemini_api_key, settings.gemini_model)))
            elif prov in _OPENAI_COMPAT:
                base, env_key, modelo_def = _OPENAI_COMPAT[prov]
                key = os.environ.get(env_key, "").strip()
                if key:
                    modelo = os.environ.get(f"{prov.upper()}_MODEL", "").strip() or modelo_def
                    proveedores.append((prov, OpenAICompatClient(key, base, modelo, prov)))
        except Exception as exc:  # noqa: BLE001
            log.warning("no se pudo configurar %s: %s", prov, exc)

    if not proveedores:
        # Sin ninguna key: caemos a echo para que la app siga viva y lo diga.
        log.warning("fallback sin proveedores con API key; usando echo")
        return EchoClient()

    log.info("fallback configurado: %s", " -> ".join(n for n, _ in proveedores))
    return FallbackClient(proveedores)
