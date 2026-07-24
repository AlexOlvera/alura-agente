# Lumora

**Lumora** es un agente de descubrimiento de conocimiento. Lee los documentos
internos de una organización (PDF, CSV, TXT, Markdown) y responde preguntas en
lenguaje natural citando de dónde salió cada dato, sin que nadie tenga que abrir
un archivo. La interfaz tiene una constelación viva que reacciona en tiempo real
a lo que el motor está haciendo: buscar, converger, responder.

**Demo en vivo:** `https://<TU-IP>.sslip.io` — desplegado en Oracle Cloud Infrastructure.

<!-- Sustituye la línea de arriba por tu URL real y agrega la captura: -->
<!-- ![Aplicación corriendo en OCI](docs/captura-oci.png) -->

---

## El problema

Una empresa acumula manuales, políticas, reportes y hojas de cálculo. La
información existe, pero encontrarla cuesta horas de trabajo humano. Un buscador
por palabras clave no sirve: la gente no recuerda las palabras exactas del
documento, recuerda la pregunta que quiere hacer.

## La solución

Un sistema RAG (*Retrieval-Augmented Generation*) con **dos rutas de respuesta**,
porque no todas las preguntas se contestan igual.

```
                       ┌─ ¿La pregunta requiere calcular ─┐
                       │   sobre una tabla?               │
                       │                                  │
                     sí │                                  │ no
                       ▼                                  ▼
              RUTA TABULAR                        RUTA SEMÁNTICA
              plan JSON validado                  búsqueda vectorial
              ejecutado con pandas                sobre los fragmentos
                       │                                  │
                       └──────────┬───────────────────────┘
                                  ▼
                       respuesta redactada + citas
```

### Carga de documentos en caliente

La interfaz permite arrastrar documentos (o elegirlos) y la IA los indexa **sin
reiniciar el servidor**. Cada archivo pasa por validación de seguridad antes de
tocar el disco: extensión en lista blanca (`.pdf .csv .txt .md`), tamaño acotado
a 10 MB, y saneo de nombre para bloquear *path traversal* (`../../etc/passwd` se
reduce a un nombre plano dentro de `data/`). Un archivo inválido se rechaza con
mensaje claro; el resto se indexa igual.

### Encender y apagar estrellas

Cada estrella (documento) tiene un interruptor con forma de estrella: encendida
brilla y Lumora la usa; apagada se atenua pero permanece en el firmamento, fuera
de las busquedas. Util para acotar de que fuentes puede responder sin borrarlas.
Ademas se pueden **eliminar** estrellas y **filtrar** el firmamento por nombre o
por tipo (PDF, CSV, TXT, MD).

### Interfaz reactiva

El fondo es una constelación de partículas en `<canvas>` cuyo comportamiento
está atado al estado **real** del motor, no a temporizadores:
- **idle** — respira lento mientras espera.
- **processing** — se acelera cuando Gemini está buscando de verdad.
- **responding** — converge e ilumina en el instante en que llega la respuesta.

El número de partículas crece con la cantidad de documentos cargados. El logo
SVG comparte esos mismos estados. Nada de esto es decorativo-falso: cada
transición se dispara desde el ciclo real de la petición.

### Ruta semántica (RAG clásico)

Los documentos se trocean respetando límites de oración, cada trozo se convierte
en un vector, y la pregunta recupera los `k` trozos más cercanos por similitud
coseno. Esos trozos se le entregan al modelo con instrucción estricta de no
inventar nada fuera de ellos y de citar con marcadores `[n]`.

### Ruta tabular (y por qué existe)

**La búsqueda vectorial no sabe sumar.** Una pregunta como *"¿cuál fue el
producto más vendido en diciembre de 2015?"* no se resuelve recuperando
fragmentos parecidos: se resuelve filtrando, agrupando y ordenando. Un RAG
ingenuo alucina un producto plausible y lo dice con total seguridad.

Aquí el modelo **no escribe código**. Escribe un *plan* en JSON con vocabulario
cerrado:

```json
{
  "applicable": true,
  "table": "ventas_2015.csv",
  "filters": [{"column": "fecha", "op": "between", "value": ["2015-12-01", "2015-12-31"]}],
  "group_by": ["producto"],
  "aggregate": {"column": "cantidad", "func": "sum"},
  "sort_desc": true,
  "limit": 3
}
```

Python valida ese plan contra el esquema real de la tabla y lo ejecuta con
pandas. No hay `eval`, no hay `exec`, no hay SQL concatenado. Un plan que
mencione una columna inexistente o un operador fuera de la lista blanca se
rechaza **antes** de tocar los datos, y el sistema cae a la ruta semántica en
lugar de reventar.

Es la diferencia entre un agente que consulta y un agente que ejecuta lo que sea
que el modelo haya alucinado.

---

## Arquitectura

```
data/*.pdf,csv,md
      │
      ▼
  loaders.py ──── Passage(texto, source, locator)  ──┐
      │                                              │  Table(pandas)
      ▼                                              │
  chunking.py ─── Chunk (corte por oración + solape)  │
      │                                              │
      ▼                                              │
  embeddings.py ─ Embedder  {local | gemini | hash}   │
      │                                              │
      ▼                                              │
  vectorstore.py  VectorStore {numpy | oracle}        │
      │                                              │
      └──────────────┬───────────────────────────────┘
                     ▼
                  agent.py  ── enruta, recupera, redacta, cita
                     │
                     ▼
                  api.py (FastAPI) ── /api/ask · /api/health
                     │
                     ▼
                  web/ (HTML + CSS + JS, sin framework)
```

Cada capa está detrás de una interfaz (`Embedder`, `VectorStore`, `LLMClient`).
Cambiar de proveedor es cambiar una variable en `.env`; ningún módulo de arriba
sabe cuál implementación está activa.

### Decisiones de diseño

| Decisión | Por qué |
|---|---|
| Vector store en NumPy, no FAISS | Para corpus de hasta ~100k trozos una multiplicación matriz-vector es instantánea. Cero dependencias nativas, que es lo que importa al desplegar en una VM ARM del free tier. |
| Embeddings locales por defecto | `sentence-transformers` en CPU no consume cuota ni requiere API key. La ingesta es un proceso de una sola vez; que tarde no importa. |
| Gemini por REST, no por SDK | El endpoint `generateContent` es estable. Una dependencia menos es una cosa menos que puede romperse en el despliegue. |
| El agente se construye una vez, en el `lifespan` | Cargar el índice y el modelo por petición tumbaría una VM de 2 OCPU con el primer usuario concurrente. |
| Frontend sin framework | Tres archivos, sin build step. Se despliega copiando la carpeta. |

### Pendiente: Oracle Database 23ai AI Vector Search

`vectorstore.py` declara `OracleVectorStore` como interfaz, todavía sin
implementar. El plan es mover el índice a la base de datos usando el tipo
`VECTOR` nativo de 23ai:

```sql
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
```

Autonomous Database está en el Always Free de OCI (2 instancias, 20 GB c/u) y AI
Vector Search no cobra extra, así que la migración no cambia el costo del
proyecto: solo mueve el índice de un proceso Python a la base de datos, con lo
que gana persistencia, concurrencia y respaldos sin código adicional.

---

## Ejemplos de preguntas y respuestas

Con los documentos de ejemplo incluidos (`data/politica_interna.md` y
`data/ventas_2015.csv`):

| Pregunta | Ruta | Respuesta |
|---|---|---|
| ¿Cuál fue el producto más vendido en diciembre de 2015? | `tabular` | Monitor 27 4K, con 968 unidades, muy por encima del segundo lugar (Laptop Pro 14, 73 unidades). |
| ¿Qué lenguajes se usan en el back-end de la plataforma de ventas? | `rag` | Java 21 con Spring Boot, más servicios auxiliares en Python 3.12 `[1]`. |
| ¿Cuántos días hay que ir a la oficina? | `rag` | Mínimo dos días presenciales por semana, martes y jueves `[1]`. |
| ¿Puedo conectarme desde el WiFi del aeropuerto? | `rag` | No sin VPN corporativa; está prohibido conectarse a sistemas internos desde redes públicas `[1]`. |
| ¿Cuál es la capital de Australia? | `rag` | Indica que los documentos no contienen esa información, en vez de contestarla de memoria. |

El último caso es el que importa: el sistema tiene que **saber cuándo no sabe**.

---

## Cómo ejecutarlo

### Local

```bash
git clone <este-repo> && cd alura-agente
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # pon tu GEMINI_API_KEY (gratis en aistudio.google.com)

# coloca tus documentos en data/  (.pdf .csv .md .txt)
python -m app.ingest          # construye el índice
uvicorn app.api:app --reload  # http://127.0.0.1:8000
```

**Sin API key ni descargas**, para verificar que todo está bien cableado:

```bash
EMBEDDER=hash LLM=echo python -m app.ingest
EMBEDDER=hash LLM=echo uvicorn app.api:app
```

`EMBEDDER=hash` usa una proyección determinista sin modelo, y `LLM=echo`
devuelve el contexto recuperado en lugar de llamar a la API. Sirve para ver
exactamente qué fragmentos está recuperando el sistema.

### Despliegue en OCI

```bash
# en la VM (Ubuntu 22.04/24.04, x86 o ARM)
git clone <este-repo> ~/alura-agente && cd ~/alura-agente
cp .env.example .env && nano .env
sudo bash deploy/setup.sh
```

El script instala dependencias, corre la ingesta, registra el servicio en
systemd, instala Caddy y obtiene un certificado de Let's Encrypt para
`<ip>.sslip.io`. Queda una sola cosa manual, en la consola de OCI:

> **Networking → Virtual Cloud Networks → (tu VCN) → Security Lists → Default →
> Add Ingress Rules**
> `0.0.0.0/0` · TCP · puerto **80** y puerto **443**

Sin esa regla el servidor responde en localhost pero no desde internet, y
Let's Encrypt no puede emitir el certificado.

---

## Configuración

| Variable | Valores | Default | Qué hace |
|---|---|---|---|
| `LLM` | `gemini` `echo` | `gemini` | Proveedor de generación |
| `GEMINI_API_KEY` | — | — | Key de Google AI Studio |
| `GEMINI_MODEL` | — | `gemini-2.5-flash` | Modelo de generación |
| `EMBEDDER` | `local` `gemini` `hash` | `local` | Proveedor de embeddings |
| `VECTOR_STORE` | `numpy` `oracle` | `numpy` | Almacén de vectores |
| `TOP_K` | entero | `5` | Fragmentos recuperados por consulta |
| `CHUNK_SIZE` | entero | `900` | Tamaño objetivo del trozo, en caracteres |
| `CHUNK_OVERLAP` | entero | `150` | Solapamiento entre trozos consecutivos |
| `PORT` | entero | `8000` | Puerto del servidor |

---

## Costos

Todo el proyecto corre en niveles gratuitos permanentes:

| Componente | Costo |
|---|---|
| OCI Compute (Always Free) | $0 |
| Google AI Studio (free tier) | $0 |
| Embeddings locales | $0 |
| Certificado TLS (Let's Encrypt vía Caddy) | $0 |
| Hostname (`sslip.io`) | $0 |

El free tier de Gemini tiene tope de peticiones por minuto y por día; el sistema
detecta el `429` y lo reporta como tal en vez de fallar en silencio.

---

## Estructura

```
alura-agente/
├── app/
│   ├── config.py       Configuración por variables de entorno
│   ├── loaders.py      PDF, CSV y texto → Passage + Table
│   ├── chunking.py     Troceado por oración con solapamiento
│   ├── embeddings.py   Embedder: local | gemini | hash
│   ├── vectorstore.py  VectorStore: numpy | oracle
│   ├── llm.py          LLMClient: gemini | echo
│   ├── tabular.py      Plan JSON validado → pandas
│   ├── agent.py        Enrutado, recuperación, redacción, citas
│   ├── ingest.py       Construcción del índice
│   └── api.py          FastAPI
├── web/                Frontend sin framework
├── deploy/             setup.sh, systemd, Caddy
└── data/               Tus documentos
```

## Licencia

MIT.
