// server.js - Búsqueda Jerárquica + Diccionario de Oro + Inyección Determinista
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY, 
    baseURL: 'https://openrouter.ai/api/v1' 
});

const cacheRespuestas = new Map();
const cacheEmbeddings = new Map();
const conversaciones = new Map();
const TTL_RESPUESTA = 3600000;
const MAX_HISTORIAL = 10;

// ========== DICCIONARIO DE ORO (ESTRATEGIA 1) ==========
// Matriz determinista unificada: Tier 1, Tier 2 y Extracciones Avanzadas de Apuntes.
const diccionarioOro = {
    "ley": 1,
    "costumbre": 2,
    "renuncia de los derechos": 12,
    "efectos territoriales": 14,
    "interpretacion de la ley": 19,
    "dolo": 44,
    "culpa": 44,
    "fuerza mayor": 45,
    "caso fortuito": 45,
    "cauciones": 46,
    "presunciones": 47,
    "persona natural": 55,
    "domicilio civil": 59,
    "pluralidad de domicilios": 67,
    "nasciturus": 74,
    "muerte presunta": 80,
    "esponsales": 98,
    "matrimonio": 102,
    "sociedad conyugal": 135,
    "bienes familiares": 141,
    "patrimonio reservado": 150,
    "filiacion": 186,
    "patria potestad": 243,
    "estado civil": 304,
    "derecho de alimentos": 321,
    "tutelas": 338,
    "curadurias": 338,
    "persona juridica": 545,
    "bienes corporales": 565,
    "bienes muebles": 567,
    "bienes inmuebles": 568,
    "muebles por anticipacion": 571,
    "dominio": 582,
    "propiedad": 582,
    "modos de adquirir": 588,
    "ocupacion": 606,
    "accesion": 643,
    "tradicion": 670,
    "inscripcion conservatoria": 686,
    "posesion": 700,
    "buena fe subjetiva": 706,
    "mero tenedor": 714,
    "mera tenencia": 714,
    "fideicomiso": 733,
    "propiedad fiduciaria": 733,
    "usufructo": 764,
    "derecho de uso": 811,
    "derecho de habitacion": 811,
    "servidumbre": 820,
    "posesion efectiva": 877,
    "accion reivindicatoria": 889,
    "acciones posesorias": 916,
    "denuncia de obra nueva": 930,
    "accion de obra ruinosa": 932,
    "sucesion por causa de muerte": 951,
    "indignidad": 968,
    "sucesion intestada": 980,
    "derecho de representacion": 984,
    "testamento": 999,
    "asignaciones forzosas": 1167,
    "cuarta de mejoras": 1184,
    "acervos imaginarios": 1185,
    "desheredamiento": 1207,
    "beneficio de inventario": 1247,
    "albacea": 1270,
    "particion": 1317,
    "beneficio de separacion": 1378,
    "fuentes de las obligaciones": 1437,
    "contrato": 1438,
    "convencion": 1438,
    "elementos del contrato": 1444,
    "capacidad": 1445,
    "representacion": 1448,
    "estipulacion a favor de otro": 1449,
    "promesa de hecho ajeno": 1450,
    "vicios del consentimiento": 1451,
    "error": 1452,
    "fuerza": 1456,
    "objeto ilicito": 1464,
    "causa": 1467,
    "causa ilicita": 1467,
    "obligaciones naturales": 1470,
    "obligaciones condicionales": 1473,
    "condicion resolutoria tacita": 1489,
    "obligaciones a plazo": 1494,
    "obligaciones de genero": 1508,
    "obligaciones solidarias": 1511,
    "solidaridad pasiva": 1511,
    "clausula penal": 1535,
    "clausula penal enorme": 1544,
    "fuerza obligatoria": 1545,
    "ley para los contratantes": 1545,
    "ejecucion de buena fe": 1546,
    "obligacion de entregar": 1548,
    "mora": 1551,
    "excepcion de contrato no cumplido": 1552,
    "obligaciones de hacer": 1553,
    "promesa": 1554,
    "obligaciones de no hacer": 1555,
    "indemnizacion de perjuicios": 1556,
    "intereses moratorios": 1559,
    "interpretacion de los contratos": 1560,
    "pago efectivo": 1568,
    "imputacion del pago": 1595,
    "pago por consignacion": 1599,
    "pago con subrogacion": 1608,
    "subrogacion legal": 1610,
    "beneficio de competencia": 1625,
    "novacion": 1628,
    "remision": 1652,
    "compensacion": 1655,
    "perdida de la cosa que se debe": 1670,
    "nulidad absoluta": 1681,
    "nulidad relativa": 1681,
    "carga de la prueba": 1698,
    "instrumento publico": 1699,
    "simulacion": 1707,
    "contraescrituras": 1707,
    "compraventa": 1793,
    "saneamiento de la eviccion": 1837,
    "vicios redhibitorios": 1857,
    "pacto comisorio": 1877,
    "pacto comisorio calificado": 1879,
    "pacto de retroventa": 1881,
    "lesion enorme": 1889,
    "cesion de derechos": 1901,
    "cesion de derecho de herencia": 1909,
    "arrendamiento": 1915,
    "sociedad": 2053,
    "mandato": 2116,
    "comodato": 2174,
    "prestamo de uso": 2174,
    "accion de precario": 2195,
    "mutuo": 2196,
    "prestamo de consumo": 2196,
    "deposito": 2211,
    "secuestro": 2249,
    "renta vitalicia": 2259,
    "juego y apuesta": 2264,
    "cuasicontratos": 2284,
    "agencia oficiosa": 2286,
    "pago de lo no debido": 2295,
    "comunidad": 2304,
    "responsabilidad extracontractual": 2314,
    "responsabilidad por el hecho ajeno": 2320,
    "ruina de edificio": 2323,
    "presuncion de culpabilidad": 2329,
    "fianza": 2336,
    "prenda": 2384,
    "hipoteca": 2407,
    "transaccion": 2446,
    "derecho de prenda general": 2465,
    "accion oblicua": 2466,
    "accion pauliana": 2468,
    "accion revocatoria": 2468,
    "prelacion de creditos": 2469,
    "prescripcion": 2492
};

function buscarEnDiccionario(texto) {
    const textoNormalizado = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const [concepto, articulo] of Object.entries(diccionarioOro)) {
        const regex = new RegExp(`\\b${concepto}\\b`, 'i');
        if (regex.test(textoNormalizado)) {
            return articulo;
        }
    }
    return null;
}

// =======================================================

function hashTexto(texto) {
    return crypto.createHash('sha256').update(texto).digest('hex');
}

function limpiarCaches() {
    const now = Date.now();
    for (const [key, val] of cacheRespuestas.entries()) {
        if (now - val.timestamp > TTL_RESPUESTA) cacheRespuestas.delete(key);
    }
    if (cacheEmbeddings.size > 500) {
        const primerKey = cacheEmbeddings.keys().next().value;
        cacheEmbeddings.delete(primerKey);
    }
}
setInterval(limpiarCaches, 600000);

app.post('/api/consultar', async (req, res) => {
    const { pregunta, sessionId } = req.body;
    if (!pregunta) return res.status(400).json({ error: "Pregunta vacía" });
    if (!sessionId) return res.status(400).json({ error: "Se requiere sessionId" });

    const hashPregunta = hashTexto(pregunta);
    const respuestaCacheada = cacheRespuestas.get(hashPregunta);
    if (respuestaCacheada && Date.now() - respuestaCacheada.timestamp < TTL_RESPUESTA) {
        console.log("💾 Respuesta desde caché global");
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ content: respuestaCacheada.respuesta })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
    }

    if (!conversaciones.has(sessionId)) conversaciones.set(sessionId, []);
    let historial = conversaciones.get(sessionId);
    if (historial.length > MAX_HISTORIAL) historial = historial.slice(-MAX_HISTORIAL);

    let contextoLey = "";
    let contextoApuntes = "";
    let articuloExactoEncontrado = false;
    let numeroArticuloDetectado = null;

    // 1A. BUSCAR NÚMERO DE ARTÍCULO EXACTO EN LA PREGUNTA
    const matchNumero = pregunta.match(/(?:art(?:[íi]culo|\.?)?\s*)?(\d{1,4})/i);
    if (matchNumero && matchNumero[1]) {
        numeroArticuloDetectado = matchNumero[1];
        console.log(`📌 Número detectado por regex: ${numeroArticuloDetectado}`);
    } else {
        // 1B. SI NO HAY NÚMERO, EL ENRUTADOR REVISA EL DICCIONARIO DE ORO
        const detectadoDiccionario = buscarEnDiccionario(pregunta);
        if (detectadoDiccionario) {
            numeroArticuloDetectado = detectadoDiccionario;
            console.log(`📌 Concepto maestro detectado. Redirigiendo al Art: ${numeroArticuloDetectado}`);
        }
    }

    // 2. INYECCIÓN DETERMINISTA DE LA LEY
    if (numeroArticuloDetectado && parseInt(numeroArticuloDetectado) >= 1 && parseInt(numeroArticuloDetectado) <= 2524) {
        const { data, error } = await supabase
            .from('fragmentos_legales')
            .select('contenido, articulo_numero, libro, titulo')
            .eq('tipo', 'ley')
            .eq('numero_limpio', numeroArticuloDetectado)
            .order('libro', { ascending: true, nullsLast: true })
            .limit(1);
        
        if (!error && data && data.length > 0) {
            contextoLey += `[CÓDIGO CIVIL - Art. ${data[0].articulo_numero}]\n${data[0].contenido}\n\n`;
            articuloExactoEncontrado = true;
            console.log(`✅ Ley inyectada desde base de datos: Art. ${numeroArticuloDetectado}`);
        }
    }

    try {
        // 3. GENERAR EMBEDDING (Para buscar apuntes o ley si falló el enrutador)
        let embedding;
        if (cacheEmbeddings.has(hashPregunta)) {
            embedding = cacheEmbeddings.get(hashPregunta);
        } else {
            const embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: pregunta.substring(0, 8000),
                dimensions: 768
            });
            embedding = embeddingResponse.data[0].embedding;
            cacheEmbeddings.set(hashPregunta, embedding);
        }

        // 4. BÚSQUEDA SEMÁNTICA EN LEY (Solo si el diccionario y el regex fallaron)
        if (!articuloExactoEncontrado) {
            console.log("📚 Buscando coincidencias semánticas en CÓDIGO CIVIL...");
            const { data: leyes, error: errLey } = await supabase.rpc('buscar_fragmentos', {
                query_embedding: embedding,
                filtro_tipo: 'ley',
                match_threshold: 0.15,
                match_count: 3
            });
            if (!errLey && leyes && leyes.length > 0) {
                contextoLey += leyes.map(f => `[CÓDIGO CIVIL - Art. ${f.articulo_numero || 'S/N'}]\n${f.contenido}`).join('\n\n');
            }
        }

        // 5. BÚSQUEDA SEMÁNTICA ESTRICTA EN APUNTES
        console.log("📚 Buscando coincidencias en APUNTES PERSONALES...");
        const { data: apuntes, error: errApuntes } = await supabase.rpc('buscar_fragmentos', {
            query_embedding: embedding,
            filtro_tipo: 'apunte_personal',
            match_threshold: 0.15,
            match_count: 10
        });
        if (!errApuntes && apuntes && apuntes.length > 0) {
            contextoApuntes += apuntes.map(f => `[APUNTE PERSONAL - ${f.articulo_titulo_completo}]\n${f.contenido}`).join('\n\n');
        }

    } catch (error) {
        console.log("⚠️ Error en búsqueda vectorial:", error.message);
    }

    const contextoTotal = `--- LEY OFICIAL ---\n${contextoLey || 'No se encontraron artículos.'}\n\n--- APUNTES Y DOCTRINA ---\n${contextoApuntes || 'No se encontraron apuntes.'}`;

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    let respuestaCompleta = "";

    // ========== INYECCIÓN DETERMINISTA DIRECTA A LA PANTALLA ==========
    if (contextoLey) {
        const inyeccion = `### ⚖️ TEXTO DEL ARTÍCULO (Ley Oficial)\n${contextoLey}\n---\n\n`;
        respuestaCompleta += inyeccion;
        res.write(`data: ${JSON.stringify({ content: inyeccion })}\n\n`);
    }

    // ========== PROMPT DEL SISTEMA (PROFESOR Y VALIDADOR) ==========
    const systemPrompt = 
        "Eres Alucilex, un riguroso Profesor Titular de Derecho Civil chileno. Sigue estas REGLAS DE ORO al pie de la letra:\n\n" +
        "1. PROHIBICIÓN DE REPETIR LEY: El servidor ya le imprimió al alumno el texto literal de la ley. ESTÁ ESTRICTAMENTE PROHIBIDO que transcribas o repitas artículos del Código Civil.\n" +
        "2. ANÁLISIS EXHAUSTIVO: Basa tu respuesta PRINCIPALMENTE en la sección 'APUNTES Y DOCTRINA' del contexto.\n" +
        "3. PROTOCOLO DE COMPLEMENTACIÓN Y CONTRASTE: Si aportas conocimiento para complementar los apuntes, DEBES:\n" +
        "   a) Verificar que NO contradiga los apuntes.\n" +
        "   b) Declarar explícitamente la fuente oficial chilena de tu aporte (ej. 'Según la jurisprudencia de la Corte Suprema', 'Siguiendo a René Ramos Pazos o Claro Solar').\n" +
        "4. TABLAS INQUEBRANTABLES: Usa sintaxis estricta Markdown (|---|---|) para cualquier tabla de clasificación.\n" +
        "5. ESTRUCTURA OBLIGATORIA:\n" +
        "   - ### CONCEPTO DOCTRINARIO\n" +
        "   - ### ELEMENTOS O REQUISITOS\n" +
        "   - ### CARACTERÍSTICAS\n" +
        "   - ### CLASIFICACIONES\n" +
        "   - ### INTEGRACIÓN DE FUENTES\n" +
        "   - ### EJEMPLOS PRÁCTICOS\n" +
        "   - ### CONCLUSIÓN";

    let mensajes = [{ role: "system", content: systemPrompt }];
    for (let msg of historial) mensajes.push(msg);
    mensajes.push({
        role: "user",
        content: "CONTEXTO RECUPERADO DE LA BASE DE DATOS:\n\n" + contextoTotal + "\n\nPREGUNTA DEL USUARIO: " + pregunta
    });

    const MAX_REINTENTOS = 3;
    let intento = 0;
    let streamError = null;

    while (intento < MAX_REINTENTOS) {
        try {
            const stream = await openai.chat.completions.create({
                model: "deepseek/deepseek-chat",
                messages: mensajes,
                temperature: 0.1,
                max_tokens: 3000,
                stream: true,
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                respuestaCompleta += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
            res.write('data: [DONE]\n\n');
            res.end();

            cacheRespuestas.set(hashPregunta, { respuesta: respuestaCompleta, timestamp: Date.now() });
            historial.push({ role: "user", content: pregunta });
            historial.push({ role: "assistant", content: respuestaCompleta });
            conversaciones.set(sessionId, historial.slice(-MAX_HISTORIAL));
            return;

        } catch (err) {
            streamError = err;
            intento++;
            if (intento < MAX_REINTENTOS) await new Promise(r => setTimeout(r, 2000));
        }
    }

    res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error temporal de conexión con la IA. Intenta de nuevo más tarde." })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
});

app.get('/ping', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.send('API de Alucilex funcionando.'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor ALUCILEX en puerto ${PORT}`));