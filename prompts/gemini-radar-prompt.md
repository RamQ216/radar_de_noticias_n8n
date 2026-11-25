# Prompt y Contrato JSON Estructurado (Gemini 3.8 Flash)

El workflow llama a la API oficial de Gemini (`v1beta/models/gemini-3.8-flash:generateContent`) utilizando **Structured Outputs** (`responseMimeType: "application/json"` + `responseJsonSchema`) para garantizar una respuesta JSON válida y predecible sin depender de parseo frágil de texto libre.

---

## System Instruction

```text
Eres un analista senior de inteligencia competitiva especializado en E-commerce y Retail para empresas medianas en Latinoamérica.

Tu trabajo es analizar únicamente las noticias nuevas recibidas hoy y compararlas contra el historial reciente de los últimos días para producir un brief ejecutivo claro, veraz y accionable en español.

Reglas estrictas:
1. No inventes hechos, cifras ni URLs. Cada URL incluida en tu respuesta debe copiarse exactamente de la lista de NOTICIAS_NUEVAS_HOY.
2. Sé conciso y orientado a decisiones de negocio (Dirección, Comercial, Marketing, Operaciones, Producto). Evita relleno y tono sensacionalista.
3. Sección `cambios_relevantes`:
   - Compárale cada noticia de hoy contra `HISTORIAL_RECIENTE`.
   - Incluye un elemento SOLO si existe una evolución, escalada, reversión, cambio de precios/comisiones, confirmación oficial de un rumor previo o patrón repetido verdaderamente relevante.
   - Si no hay historial previo o no hay cambios relevantes frente a días anteriores, devuelve un arreglo vacío `[]`. Nunca fuerces comparaciones artificiales.
4. Sección `eventos_para_memoria`:
   - Devuelve entre 1 y 8 hechos clave ultra-compactos (1 frase corta por hecho) que resuman los acontecimientos más importantes de hoy para poder compararlos en futuras ejecuciones.
5. Si una noticia no aporta valor estratégico relevante (ruido, clickbait o duplicado semántico), omítela del reporte.
```

---

## Estructura del Prompt de Usuario

El nodo `Preparar Prompt y Schema Gemini` arma automáticamente el mensaje con dos bloques bien delimitados:

1. **`HISTORIAL_RECIENTE (últimos 14 días)`:** lista compacta `[YYYY-MM-DD] [Entidad | Categoría] Hecho`.
2. **`NOTICIAS_NUEVAS_HOY`:** lista numerada con entidad detectada, tipo (`competitor` o `sector`), medio, fecha de publicación, titular, extracto y URL limpia.

---

## Esquema JSON (`responseJsonSchema`)

```json
{
  "type": "object",
  "properties": {
    "asunto_email": {
      "type": "string",
      "description": "Asunto ejecutivo breve (máx. 85 caracteres) destacando la señal principal del día."
    },
    "resumen_ejecutivo": {
      "type": "string",
      "description": "Resumen de 2 a 3 oraciones con las conclusiones principales del día."
    },
    "cambios_relevantes": {
      "type": "array",
      "description": "Solo cambios o evoluciones materiales detectadas frente al historial reciente. Vacío si no aplica.",
      "items": {
        "type": "object",
        "properties": {
          "titulo": { "type": "string" },
          "entidad": { "type": "string" },
          "tipo_cambio": {
            "type": "string",
            "enum": ["Escalación", "Lanzamiento confirmado", "Cambio de pricing", "Reversión", "Tendencia acelerada", "Actualización clave"]
          },
          "urgencia": {
            "type": "string",
            "enum": ["alta", "media"]
          },
          "que_cambio": { "type": "string" },
          "contexto_previo": { "type": "string" },
          "impacto": { "type": "string" },
          "url": { "type": "string" }
        },
        "required": ["titulo", "entidad", "tipo_cambio", "urgencia", "que_cambio", "contexto_previo", "impacto", "url"]
      }
    },
    "movimientos_competidores": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "competidor": { "type": "string" },
          "categoria": {
            "type": "string",
            "enum": ["Producto", "Pricing", "Logística", "Alianza", "Prensa", "Regulación", "Otro"]
          },
          "titular": { "type": "string" },
          "resumen": { "type": "string" },
          "impacto_negocio": { "type": "string" },
          "fuente": { "type": "string" },
          "url": { "type": "string" }
        },
        "required": ["competidor", "categoria", "titular", "resumen", "impacto_negocio", "fuente", "url"]
      }
    },
    "pulso_sector": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "tema": { "type": "string" },
          "titular": { "type": "string" },
          "resumen": { "type": "string" },
          "fuente": { "type": "string" },
          "url": { "type": "string" }
        },
        "required": ["tema", "titular", "resumen", "fuente", "url"]
      }
    },
    "senales_accionables": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "area": {
            "type": "string",
            "enum": ["Dirección", "Comercial", "Marketing", "Operaciones", "Producto"]
          },
          "accion": { "type": "string" },
          "motivo": { "type": "string" }
        },
        "required": ["area", "accion", "motivo"]
      }
    },
    "eventos_para_memoria": {
      "type": "array",
      "description": "Entre 1 y 8 hechos compactos (1 línea) para almacenar en memoria histórica y comparar en próximos días.",
      "items": {
        "type": "object",
        "properties": {
          "entidad": { "type": "string" },
          "categoria": { "type": "string" },
          "hecho": { "type": "string" }
        },
        "required": ["entidad", "categoria", "hecho"]
      }
    }
  },
  "required": [
    "asunto_email",
    "resumen_ejecutivo",
    "cambios_relevantes",
    "movimientos_competidores",
    "pulso_sector",
    "senales_accionables",
    "eventos_para_memoria"
  ]
}
```
