import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, 'workflows', 'radar-competitivo-ecommerce.json');
const EXAMPLE_HTML_PATH = path.join(ROOT, 'docs', 'ejemplo-reporte.html');

const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

function getNode(name) {
  const node = workflow.nodes.find((n) => n.name === name);
  assert.ok(node, `Falta el nodo "${name}" en el workflow`);
  return node;
}

function runCodeNode(nodeName, { inputItems = [], nodeOutputs = {}, staticData = {} }) {
  const node = getNode(nodeName);
  assert.equal(node.type, 'n8n-nodes-base.code', `El nodo "${nodeName}" no es de tipo Code`);

  const $input = {
    all: () => inputItems,
    first: () => inputItems[0],
  };

  const $ = (refName) => {
    const items = nodeOutputs[refName];
    assert.ok(items, `Referencia de nodo "$('${refName}')" no encontrada en el mock`);
    return {
      all: () => items,
      first: () => items[0],
    };
  };

  const $getWorkflowStaticData = (scope) => {
    assert.equal(scope, 'global');
    return staticData;
  };

  const fn = new Function('$input', '$', '$getWorkflowStaticData', node.parameters.jsCode);
  return fn($input, $, $getWorkflowStaticData);
}

console.log('1) Validando integridad estructural del workflow n8n...');
assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length >= 12);
const nodeNames = new Set(workflow.nodes.map((n) => n.name));
for (const [src, targets] of Object.entries(workflow.connections)) {
  assert.ok(nodeNames.has(src), `Conexión origen inválida: ${src}`);
  for (const branch of targets.main || []) {
    for (const edge of branch) {
      assert.ok(nodeNames.has(edge.node), `Conexión destino inválida: ${edge.node}`);
    }
  }
}
const rawWorkflowText = fs.readFileSync(WORKFLOW_PATH, 'utf8');
assert.ok(!rawWorkflowText.includes('AIzaSy'), 'Detectada posible API key hardcodeada en el JSON');
console.log('   OK · Grafo de conexiones válido y sin credenciales hardcodeadas.');

console.log('2) Probando generación dinámica de fuentes RSS...');
const configNode = getNode('Configuración del Radar');
const config = JSON.parse(configNode.parameters.jsonOutput);
config.competitors[0].blog_rss = 'https://www.shopify.com/blog.atom';

const feeds = runCodeNode('Generar Fuentes RSS', {
  inputItems: [{ json: config }],
});
assert.equal(feeds.length, 7, 'Debe generar 3 competidores + 1 blog RSS + 3 keywords');
assert.ok(feeds[0].json.feed_url.startsWith('https://news.google.com/rss/search?'));
assert.equal(feeds[1].json.feed_url, 'https://www.shopify.com/blog.atom');
console.log(`   OK · ${feeds.length} feeds generados correctamente.`);

console.log('3) Probando parsing RSS 2.0 + Atom, SHA-256, normalización y deduplicación...');
const nowIso = new Date().toISOString();
const recentRfc = new Date(Date.now() - 2 * 3600 * 1000).toUTCString();
const oldRfc = new Date(Date.now() - 96 * 3600 * 1000).toUTCString();
const prevDateYmd = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const prevIso = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
const expiredIso = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();

const alreadySeenUrl = 'https://noticias.ejemplo.com/articulo-ya-visto';
const alreadySeenHash = crypto.createHash('sha256').update(alreadySeenUrl).digest('hex');

const staticData = {
  seen_hashes: {
    [alreadySeenHash]: prevIso,
    'hash_vencido_hace_45_dias': expiredIso,
  },
  seen_titles: {},
  recent_events: [
    {
      date: prevDateYmd,
      recorded_at: prevIso,
      entidad: 'Mercado Libre',
      categoria: 'Pricing',
      hecho: 'Inició pruebas piloto de un nuevo esquema de comisiones para envíos Full en Argentina.',
    },
    {
      date: '2026-01-01',
      recorded_at: expiredIso,
      entidad: 'Shopify',
      categoria: 'Producto',
      hecho: 'Evento antiguo que debe ser podado por TTL.',
    },
  ],
};

// Feed 0: Shopify Google News (incluye 1 nueva, 1 con tracking params igual a la de Tiendanube, 1 vieja y 1 ya vista)
const xmlShopify = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[Shopify lanza checkout con IA y pagos locales en Latinoamérica - Forbes]]></title>
    <link>https://forbes.ejemplo.com/shopify-checkout-ia/?utm_source=gnews&amp;fbclid=123</link>
    <pubDate>${recentRfc}</pubDate>
    <description><![CDATA[<p>La plataforma suma nuevas integraciones para comercios medianos.</p>]]></description>
    <source>Forbes</source>
  </item>
  <item>
    <title>Shopify y Tiendanube compiten por comercios B2B en el Hot Sale - Infobae</title>
    <link>https://infobae.ejemplo.com/shopify-tiendanube-b2b?utm_medium=rss</link>
    <pubDate>${recentRfc}</pubDate>
    <description>Ambas plataformas refuerzan herramientas mayoristas.</description>
    <source>Infobae</source>
  </item>
  <item>
    <title>Noticia antigua fuera de ventana - Diario Viejo</title>
    <link>https://diario.ejemplo.com/vieja</link>
    <pubDate>${oldRfc}</pubDate>
    <description>Debe filtrarse por antigüedad.</description>
  </item>
  <item>
    <title>Artículo ya enviado en corrida previa - Portal</title>
    <link>${alreadySeenUrl}?utm_campaign=repost</link>
    <pubDate>${recentRfc}</pubDate>
    <description>Debe filtrarse por hash SHA-256 histórico.</description>
  </item>
</channel></rss>`;

// Feed 1: Shopify Blog Atom
const xmlShopifyAtom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Novedades de Shopify Editions para logística internacional</title>
    <link rel="alternate" href="https://www.shopify.com/blog/editions-logistica" />
    <id>tag:shopify.com,2026:editions-logistica</id>
    <published>${nowIso}</published>
    <summary>Nuevas APIs de inventario multipaís y tarifas calculadas.</summary>
  </entry>
</feed>`;

// Feed 2: Tiendanube (repite la nota compartida con distinta UTM para probar merge intra-corrida)
const xmlTiendanube = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Shopify y Tiendanube compiten por comercios B2B en el Hot Sale - Infobae</title>
    <link>https://infobae.ejemplo.com/shopify-tiendanube-b2b?utm_source=twitter&amp;gclid=999</link>
    <pubDate>${recentRfc}</pubDate>
    <description>Misma nota detectada bajo Tiendanube.</description>
    <source>Infobae</source>
  </item>
</channel></rss>`;

// Feed 3: Mercado Libre (noticia con cambio relevante frente a recent_events!)
const xmlMeli = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Mercado Libre confirma aumento oficial de comisiones Full desde diciembre - iProUP</title>
    <link>https://iproup.ejemplo.com/meli-comisiones-full-oficial</link>
    <pubDate>${recentRfc}</pubDate>
    <description>Tras el piloto de la semana pasada, la plataforma confirmó la nueva tabla de cargos.</description>
    <source>iProUP</source>
  </item>
</channel></rss>`;

// Feed 4: Sector (simula fallo de red con Continue on Error)
const failedFeed = { error: { message: 'ETIMEDOUT' } };

// Feed 5 y 6: Sector Logística y Pagos
const xmlLogistica = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Crece 28% la adopción de lockers inteligentes en última milla en LATAM - Ámbito</title>
    <link>https://ambito.ejemplo.com/lockers-ultima-milla-latam</link>
    <pubDate>${recentRfc}</pubDate>
    <description>Los retailers medianos reducen hasta 19% los costos de reentrega fallida.</description>
    <source>Ámbito</source>
  </item>
</channel></rss>`;

const xmlPagos = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>`;

const rawResponses = [
  { json: { raw_xml: xmlShopify } },
  { json: { raw_xml: xmlShopifyAtom } },
  { json: { raw_xml: xmlTiendanube } },
  { json: { raw_xml: xmlMeli } },
  { json: failedFeed },
  { json: { raw_xml: xmlLogistica } },
  { json: { raw_xml: xmlPagos } },
];

const dedupOut = runCodeNode('Normalizar y Deduplicar (SHA-256 + Estado)', {
  inputItems: rawResponses,
  nodeOutputs: { 'Generar Fuentes RSS': feeds },
  staticData,
});

const dedupJson = dedupOut[0].json;
assert.equal(dedupJson.has_new_items, true);
assert.equal(dedupJson.new_items_count, 5, 'Deben quedar 5 artículos únicos nuevos');
assert.equal(dedupJson.run_metadata.filtered_historical_duplicates, 1, 'Debe filtrar 1 duplicado histórico por SHA-256');
assert.equal(dedupJson.run_metadata.filtered_intra_run_duplicates, 1, 'Debe fusionar 1 duplicado intra-corrida');
assert.equal(dedupJson.run_metadata.filtered_by_age, 1, 'Debe filtrar 1 artículo viejo');
assert.equal(dedupJson.failed_sources.length, 1, 'Debe registrar 1 fuente fallida sin romper el flujo');
assert.equal(dedupJson.recent_events.length, 1, 'Debe incluir solo el evento dentro del TTL de 14 días');

// Verifica que el hash pure-JS coincide bit-a-bit con crypto.createHash('sha256')
const shopifyArt = dedupJson.articles.find((a) => a.url === 'https://forbes.ejemplo.com/shopify-checkout-ia');
assert.ok(shopifyArt, 'Debe normalizar URL quitando utm_source, fbclid y barra final');
assert.equal(
  shopifyArt.article_hash,
  crypto.createHash('sha256').update('https://forbes.ejemplo.com/shopify-checkout-ia').digest('hex'),
  'SHA-256 puro en JS debe coincidir exactamente con Node crypto'
);

// Verifica fusión de entidades en duplicado intra-corrida
const sharedArt = dedupJson.articles.find((a) => a.url === 'https://infobae.ejemplo.com/shopify-tiendanube-b2b');
assert.deepEqual(sharedArt.matched_entities, ['Shopify', 'Tiendanube']);

// Verifica que Static Data NO fue mutado antes del envío de Gmail
assert.equal(Object.keys(staticData.seen_hashes).length, 2, 'Static Data NO debe mutarse antes del Commit post-envío');
console.log('   OK · SHA-256 exacto, URL limpia, dedup histórica e intra-corrida verificadas, Static Data intacto.');

console.log('4) Probando construcción de payload y JSON Schema para Gemini...');
const geminiPrepOut = runCodeNode('Preparar Prompt y Schema Gemini', {
  inputItems: dedupOut,
});
const geminiPayload = geminiPrepOut[0].json.gemini_payload;
assert.equal(geminiPayload.generationConfig.responseMimeType, 'application/json');
assert.ok(geminiPayload.generationConfig.responseJsonSchema.properties.cambios_relevantes);
assert.ok(geminiPayload.contents[0].parts[0].text.includes('HISTORIAL_RECIENTE'));
assert.ok(geminiPayload.contents[0].parts[0].text.includes('Mercado Libre'));
console.log('   OK · Payload Gemini válido con memoria histórica y responseJsonSchema.');

console.log('5) Probando parseo de Gemini, sanitización XSS y renderizado HTML ejecutivo...');
const mockGeminiReport = {
  asunto_email: 'Mercado Libre oficializa suba Full + Shopify lanza checkout IA',
  resumen_ejecutivo:
    'Mercado Libre confirmó oficialmente el ajuste de comisiones Full que estaba en piloto desde hace 3 días. En paralelo, Shopify y Tiendanube aceleran su oferta para comercios medianos y B2B con foco en checkout con IA y logística eficiente.',
  cambios_relevantes: [
    {
      titulo: 'Mercado Libre pasa de piloto a aumento oficial en comisiones Full',
      entidad: 'Mercado Libre',
      tipo_cambio: 'Cambio de pricing',
      urgencia: 'alta',
      que_cambio: 'Confirmó oficialmente la nueva tabla de cargos para vendedores Full a partir de diciembre.',
      contexto_previo: 'Hace 3 días solo se habían reportado pruebas piloto acotadas en Argentina sin fecha confirmada.',
      impacto: 'Reduce el margen directo en SKUs de ticket bajo/medio operados vía Full; conviene recalcular rentabilidad esta semana.',
      url: 'https://iproup.ejemplo.com/meli-comisiones-full-oficial',
    },
  ],
  movimientos_competidores: [
    {
      competidor: 'Mercado Libre',
      categoria: 'Pricing',
      titular: 'Confirma aumento oficial de comisiones Full desde diciembre',
      resumen: 'La plataforma formalizó el esquema de comisiones para operación logística Full tras pruebas previas.',
      impacto_negocio: 'Revisar márgenes por categoría y evaluar qué productos migrar a envío propio o tienda directa.',
      fuente: 'iProUP',
      url: 'https://iproup.ejemplo.com/meli-comisiones-full-oficial',
    },
    {
      competidor: 'Shopify',
      categoria: 'Producto',
      titular: 'Lanza checkout con IA y mejoras de logística multipaís',
      resumen: 'Incorpora personalización en checkout con pagos locales y nuevas APIs de inventario internacional.',
      impacto_negocio: 'Eleva la vara de conversión en tienda propia para retailers que venden cross-border.',
      fuente: 'Forbes',
      url: 'https://forbes.ejemplo.com/shopify-checkout-ia',
    },
    {
      competidor: 'Tiendanube',
      categoria: 'Prensa',
      titular: 'Competencia directa con Shopify por el segmento B2B en Hot Sale',
      resumen: 'Ambas plataformas están reforzando funcionalidades mayoristas y listas de precios diferenciadas.',
      impacto_negocio: 'Oportunidad para evaluar migración de pedidos mayoristas manuales a canal digital.',
      fuente: 'Infobae',
      url: 'https://infobae.ejemplo.com/shopify-tiendanube-b2b',
    },
  ],
  pulso_sector: [
    {
      tema: 'Logística Última Milla',
      titular: 'Crece 28% la adopción de lockers inteligentes en LATAM',
      resumen: 'Empresas medianas reportan hasta 19% de ahorro en costos por reentregas fallidas.',
      fuente: 'Ámbito',
      url: 'https://ambito.ejemplo.com/lockers-ultima-milla-latam',
    },
  ],
  senales_accionables: [
    {
      area: 'Dirección',
      accion: 'Recalcular margen neto por SKU en Mercado Libre Full antes del inicio de diciembre',
      motivo: 'El cambio de comisiones ya pasó de piloto a vigencia confirmada.',
    },
    {
      area: 'Operaciones',
      accion: 'Cotizar integración de puntos de retiro / lockers en zonas de alta tasa de reentrega',
      motivo: 'La tendencia regional muestra ahorros directos cercanos al 19% en última milla.',
    },
    {
      area: 'Marketing',
      accion: 'Evaluar campañas de redirección de clientes recurrentes hacia tienda propia',
      motivo: 'Compensar el incremento de comisiones del marketplace fortaleciendo el canal directo.',
    },
  ],
  eventos_para_memoria: [
    {
      entidad: 'Mercado Libre',
      categoria: 'Pricing',
      hecho: 'Confirmó aumento oficial de comisiones Full vigente desde diciembre.',
    },
    {
      entidad: 'Shopify',
      categoria: 'Producto',
      hecho: 'Lanzó checkout con IA, pagos locales y APIs de logística multipaís en LATAM.',
    },
  ],
};

const renderOut = runCodeNode('Parsear Respuesta y Generar Email HTML', {
  inputItems: [
    {
      json: {
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(mockGeminiReport) }],
            },
          },
        ],
      },
    },
  ],
  nodeOutputs: {
    'Normalizar y Deduplicar (SHA-256 + Estado)': dedupOut,
  },
});

const rendered = renderOut[0].json;
assert.ok(rendered.email_subject.startsWith('[Cambio Relevante] '));
assert.ok(rendered.email_html.includes('5 noticias nuevas'), 'Debe mostrar el conteo real de noticias nuevas');
assert.ok(rendered.email_html.includes('2 duplicados filtrados'), 'Debe mostrar el conteo real de duplicados filtrados');
assert.ok(rendered.email_html.includes('Cambios Relevantes vs. Reportes Anteriores'));
assert.ok(rendered.email_html.includes('Aviso técnico: 1 fuente(s) no respondieron'));

// Guardar ejemplo HTML auténtico generado por el propio nodo del workflow
fs.mkdirSync(path.dirname(EXAMPLE_HTML_PATH), { recursive: true });
fs.writeFileSync(EXAMPLE_HTML_PATH, rendered.email_html, 'utf8');
console.log('   OK · Email HTML generado y guardado en docs/ejemplo-reporte.html.');

// Test XSS + bloque cambios_relevantes oculto cuando está vacío
const emptyDeltaReport = {
  ...mockGeminiReport,
  resumen_ejecutivo: 'Resumen con <script>alert(1)</script> sanitizado.',
  cambios_relevantes: [],
  movimientos_competidores: [
    {
      ...mockGeminiReport.movimientos_competidores[0],
      url: 'javascript:alert(1)',
    },
  ],
};
const xssOut = runCodeNode('Parsear Respuesta y Generar Email HTML', {
  inputItems: [{ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(emptyDeltaReport) }] } }] } }],
  nodeOutputs: { 'Normalizar y Deduplicar (SHA-256 + Estado)': dedupOut },
});
assert.ok(!xssOut[0].json.email_html.includes('<script>'), 'Debe escapar HTML peligroso');
assert.ok(!xssOut[0].json.email_html.includes('javascript:alert'), 'Debe bloquear URLs no HTTP(S)');
assert.ok(!xssOut[0].json.email_html.includes('Cambios Relevantes vs. Reportes Anteriores'), 'Debe ocultar bloque de cambios cuando está vacío');
console.log('   OK · Sanitización XSS/URL y ocultamiento condicional de alertas verificados.');

console.log('6) Probando Commit Post-Envío + Poda TTL + Idempotencia en segunda corrida...');
const commitOut = runCodeNode('Commit de Estado e Historial (Post-Envío)', {
  inputItems: [{ json: { id: 'gmail_msg_001' } }],
  nodeOutputs: { 'Parsear Respuesta y Generar Email HTML': renderOut },
  staticData,
});
const commitJson = commitOut[0].json;
assert.equal(commitJson.status, 'committed');
assert.equal(commitJson.committed_hashes, 5);
assert.ok(!staticData.seen_hashes['hash_vencido_hace_45_dias'], 'Debe podar hashes vencidos >30d');
assert.equal(staticData.recent_events.length, 3, 'Debe conservar 1 evento vigente + 2 nuevos y podar el vencido');

// Segunda corrida inmediata con los mismos feeds: debe dar 0 novedades (Short-circuit!)
const secondRunOut = runCodeNode('Normalizar y Deduplicar (SHA-256 + Estado)', {
  inputItems: rawResponses,
  nodeOutputs: { 'Generar Fuentes RSS': feeds },
  staticData,
});
assert.equal(secondRunOut[0].json.has_new_items, false, 'En segunda corrida idéntica no debe haber novedades');
assert.equal(secondRunOut[0].json.new_items_count, 0);
console.log('   OK · Commit atómico, poda TTL y short-circuit en segunda ejecución verificados.');

console.log('\n✅ TODAS LAS PRUEBAS PASARON EXITOSAMENTE.');
