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

// ========== DICCIONARIO DE ORO (completo, el que tú me diste) ==========
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
    "existencia legal": 74,
    "presuncion de concepcion": 76,
    "muerte presunta": 80,
    "esponsales": 98,
    "matrimonio": 102,
    "sociedad conyugal": 135,
    "bienes familiares": 141,
    "patrimonio reservado": 150,
    "separacion total de bienes": 152,
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
    "cosas incorporales": 576,
    "derechos reales": 577,
    "derechos personales": 578,
    "creditos": 578,
    "dominio": 582,
    "propiedad": 582,
    "modos de adquirir el dominio": 588,
    "ocupacion": 606,
    "accesion": 643,
    "tradicion": 670,
    "reserva de dominio": 680,
    "inscripcion conservatoria": 686,
    "posesion": 700,
    "posesion regular": 702,
    "buena fe subjetiva": 706,
    "posesion irregular": 708,
    "posesion violenta": 710,
    "posesion clandestina": 713,
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
    "asignaciones por causa de muerte": 953,
    "apertura de la sucesion": 955,
    "delacion": 956,
    "indignidad": 968,
    "sucesion intestada": 980,
    "derecho de representacion": 984,
    "testamento": 999,
    "asignaciones forzosas": 1167,
    "cuarta de mejoras": 1184,
    "acervos imaginarios": 1185,
    "desheredamiento": 1207,
    "lesion en la aceptacion de herencia": 1234,
    "herencia yacente": 1241,
    "beneficio de inventario": 1247,
    "albacea": 1270,
    "particion": 1317,
    "lesion en la particion": 1348,
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
    "error de hecho": 1453,
    "error obstaculo": 1453,
    "error sustancial": 1454,
    "error en calidades accidentales": 1454,
    "error en la persona": 1455,
    "fuerza": 1456,
    "fuerza moral": 1456,
    "fuerza por tercero": 1457,
    "dolo determinante": 1458,
    "presuncion de dolo": 1459,
    "objeto": 1460,
    "cosa futura": 1461,
    "objeto ilicito": 1464,
    "condonacion de dolo futuro": 1465,
    "contratos prohibidos por ley": 1466,
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
    "resciliacion": 1567,
    "mutuo disenso": 1567,
    "pago efectivo": 1568,
    "imputacion del pago": 1595,
    "pago por consignacion": 1599,
    "pago con subrogacion": 1608,
    "subrogacion legal": 1610,
    "beneficio de competencia": 1625,
    "novacion": 1628,
    "remision": 1652,
    "compensacion": 1655,
    "confusion": 1665,
    "perdida de la cosa que se debe": 1670,
    "nulidad absoluta": 1681,
    "nulidad relativa": 1681,
    "carga de la prueba": 1698,
    "instrumento publico": 1699,
    "simulacion": 1707,
    "contraescrituras": 1707,
    "regimenes patrimoniales": 1715,
    "capitulaciones matrimoniales": 1715,
    "haber de la sociedad conyugal": 1725,
    "donaciones remuneratorias": 1738,
    "presuncion de dominio de la sociedad conyugal": 1739,
    "participacion en los gananciales": 1792,
    "compraventa": 1793,
    "arras": 1803,
    "venta de cosa ajena": 1815,
    "venta con relacion a la cabida": 1831,
    "saneamiento de la eviccion": 1837,
    "eviccion parcial": 1854,
    "vicios redhibitorios": 1857,
    "accion estimatoria": 1868,
    "quanti minoris": 1868,
    "pacto comisorio": 1877,
    "pacto comisorio calificado": 1879,
    "pacto de retroventa": 1881,
    "pacto de retracto": 1886,
    "lesion enorme": 1889,
    "lesion enorme en la permuta": 1900,
    "cesion de derechos": 1901,
    "cesion de derecho de herencia": 1909,
    "arrendamiento": 1915,
    "arrendamiento de transporte": 2013,
    "sociedad": 2053,
    "mandato": 2116,
    "delegacion del mandato": 2135,
    "comodato": 2174,
    "prestamo de uso": 2174,
    "accion de precario": 2195,
    "mutuo": 2196,
    "prestamo de consumo": 2196,
    "deposito": 2211,
    "deposito propiamente dicho": 2215,
    "secuestro": 2249,
    "renta vitalicia": 2259,
    "juego y apuesta": 2264,
    "censo vitalicio": 2279,
    "cuasicontratos": 2284,
    "agencia oficiosa": 2286,
    "pago de lo no debido": 2295,
    "comunidad": 2304,
    "responsabilidad extracontractual": 2314,
    "solidaridad extracontractual": 2317,
    "capacidad extracontractual": 2319,
    "responsabilidad por el hecho ajeno": 2320,
    "ruina de edificio": 2323,
    "presuncion de culpabilidad": 2329,
    "exposicion imprudente al daño": 2330,
    "fianza": 2336,
    "accion de reembolso": 2370,
    "prenda": 2384,
    "hipoteca": 2407,
    "hipoteca de cuota": 2417,
    "hipoteca sobre bienes futuros": 2419,
    "transaccion": 2446,
    "derecho de prenda general": 2465,
    "accion oblicua": 2466,
    "accion pauliana": 2468,
    "accion revocatoria": 2468,
    "prelacion de creditos": 2469,
    "prescripcion": 2492
};

// ========== FUNCIONES AUXILIARES ==========
function calcularSimilitud(s1, s2) {
    let s1Lower = s1.toLowerCase();
    let s2Lower = s2.toLowerCase();
    let costs = new Array();
    for (let i = 0; i <= s1Lower.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2Lower.length; j++) {
            if (i == 0) costs[j] = j;
            else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1Lower.charAt(i - 1) != s2Lower.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[s2Lower.length] = lastValue;
    }
    return (1.0 - (costs[s2Lower.length] / Math.max(s1Lower.length, s2Lower.length)));
}

function buscarEnDiccionario(texto) {
    const textoNormalizado = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const clavesOrdenadas = Object.keys(diccionarioOro).sort((a, b) => b.length - a.length);
    for (const concepto of clavesOrdenadas) {
        const articulo = diccionarioOro[concepto];
        const regex = new RegExp(`\\b${concepto}\\b`, 'i');
        if (regex.test(textoNormalizado)) return articulo;
    }
    const palabrasClave = textoNormalizado.split(/[\s,.-]+/).filter(p => p.length > 3 && !['que', 'como', 'cual', 'para'].includes(p));
    for (const concepto of clavesOrdenadas) {
        const articulo = diccionarioOro[concepto];
        const conceptoNormalizado = concepto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        for (let palabra of palabrasClave) {
            if (calcularSimilitud(palabra, conceptoNormalizado) >= 0.70) return articulo;
        }
        if (textoNormalizado.replace(/\s+/g, '').includes(conceptoNormalizado.replace(/\s+/g, ''))) {
            return articulo;
        }
    }
    return null;
}

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

// ===================== CHAT ORIGINAL (COMPLETO) =====================
app.post('/api/consultar', async (req, res) => {
    const { pregunta, sessionId } = req.body;
    if (!pregunta) return res.status(400).json({ error: "Pregunta vacía" });
    if (!sessionId) return res.status(400).json({ error: "Se requiere sessionId" });

    const hashPregunta = hashTexto(pregunta);
    const respuestaCacheada = cacheRespuestas.get(hashPregunta);
    if (respuestaCacheada && Date.now() - respuestaCacheada.timestamp < TTL_RESPUESTA) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ content: respuestaCacheada.respuesta })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
    }

    if (!conversaciones.has(sessionId)) conversaciones.set(sessionId, []);
    let historial = conversaciones.get(sessionId);
    if (historial.length > MAX_HISTORIAL) historial = historial.slice(-MAX_HISTORIAL);

    try {
        const mensajesTriaje = [
            { 
                role: "system", 
                content: "Eres un Agente Enrutador Jurídico. Tu misión es detectar si la pregunta del usuario mezcla conceptos inconexos (ej. 'el matrimonio es un modo de adquirir el dominio'), es muy ambigua, o tiene graves errores. " +
                         "Si detectas ambigüedad, debes recomponer la pregunta formulando una breve opción aclaratoria para el usuario. " +
                         "FORMATO ESTRICTO: Si hay ambigüedad, responde empezando exactamente con la palabra 'ACLARACION:' seguida de tu pregunta (ej. 'ACLARACION: ¿Deseas saber sobre el matrimonio o sobre los modos de adquirir el dominio?'). " +
                         "Si la pregunta es clara, O si el usuario está respondiendo de forma coherente a una aclaración previa tuya (ej. responde 'del dominio'), responde ÚNICAMENTE con la palabra 'CLARA'." 
            },
            ...historial.slice(-4),
            { role: "user", content: pregunta }
        ];

        const triajeResponse = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",
            messages: mensajesTriaje,
            temperature: 0.0,
            max_tokens: 150
        });

        const triajeText = triajeResponse.choices[0]?.message?.content?.trim() || "CLARA";

        if (triajeText.startsWith("ACLARACION:")) {
            const textoAclaracion = triajeText.replace("ACLARACION:", "").trim();
            const respuestaAclaratoria = `🤖 **Filtro de Precisión:**\nHe notado que tu consulta abarca temas distintos. ${textoAclaracion}\n\n*(Por favor, indícame tu preferencia para darte la información exacta)*`;
            
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
            res.write(`data: ${JSON.stringify({ content: respuestaAclaratoria })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();

            historial.push({ role: "user", content: pregunta });
            historial.push({ role: "assistant", content: respuestaAclaratoria });
            conversaciones.set(sessionId, historial.slice(-MAX_HISTORIAL));
            return;
        }
    } catch (errorTriaje) {
        console.log("⚠️ Error en Agente Enrutador, saltando fase de triaje...", errorTriaje.message);
    }

    let contextoLey = "";
    let contextoApuntes = "";
    let articuloExactoEncontrado = false;
    let numeroArticuloDetectado = null;

    const matchNumero = pregunta.match(/(?:art(?:[íi]culo|\.?)?\s*)?(\d{1,4})/i);
    if (matchNumero && matchNumero[1]) {
        numeroArticuloDetectado = matchNumero[1];
    } else {
        const detectadoDiccionario = buscarEnDiccionario(pregunta);
        if (detectadoDiccionario) numeroArticuloDetectado = detectadoDiccionario;
    }

    if (numeroArticuloDetectado && parseInt(numeroArticuloDetectado) >= 1 && parseInt(numeroArticuloDetectado) <= 2524) {
    const { data, error } = await supabase
        .from('fragmentos_legales')
        .select('contenido, articulo_numero, libro, titulo')
        .eq('tipo', 'ley')
        .eq('numero_limpio', numeroArticuloDetectado)
        .in('libro', [1, 2, 3, 4])           // <-- solo artículos del Código Civil
        .order('articulo_numero', { ascending: true })
        .limit(1);   
        if (!error && data && data.length > 0) {
            contextoLey += `[CÓDIGO CIVIL - Art. ${data[0].articulo_numero}]\n${data[0].contenido}\n\n`;
            articuloExactoEncontrado = true;
        }
    }

    try {
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

        if (!articuloExactoEncontrado) {
            const { data: leyes, error: errLey } = await supabase.rpc('buscar_fragmentos', {
                query_embedding: embedding,
                filtro_tipo: 'ley',
                match_threshold: 0.25,
                match_count: 3
            });
            if (!errLey && leyes && leyes.length > 0) {
                contextoLey += leyes.map(f => `[CÓDIGO CIVIL - Art. ${f.articulo_numero || 'S/N'}]\n${f.contenido}`).join('\n\n');
            }
        }

        const { data: apuntes, error: errApuntes } = await supabase.rpc('buscar_fragmentos', {
            query_embedding: embedding,
            filtro_tipo: 'apunte_personal',
            match_threshold: 0.15,
            match_count: 15
        });
        if (!errApuntes && apuntes && apuntes.length > 0) {
            contextoApuntes += apuntes.map(f => `[APUNTE PERSONAL - ${f.articulo_titulo_completo}]\n${f.contenido}`).join('\n\n');
        }

    } catch (error) {
        console.log("⚠️ Error en búsqueda vectorial:", error.message);
    }

    const contextoTotal = `--- LEY OFICIAL ---\n${contextoLey || 'No se encontraron artículos.'}\n\n--- APUNTES Y DOCTRINA ---\n${contextoApuntes || 'No se encontraron apuntes.'}`;

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    if (contextoLey) {
        const inyeccion = `### ⚖️ ARTÍCULO ${numeroArticuloDetectado}\n${contextoLey.replace(/\[CÓDIGO CIVIL - Art. \d+\]\s*Art. \d+./g, '')}\n---\n\n`;
        res.write(`data: ${JSON.stringify({ content: inyeccion })}\n\n`);
    }

    const systemPrompt = 
        "Eres Alucilex, un riguroso Profesor Titular de Derecho Civil chileno. Sigue estas REGLAS DE ORO al pie de la letra:\n\n" +
        "1. PROHIBICIÓN ABSOLUTA DE REPETIR LEY O ENCABEZADOS: El servidor ya le imprimió al alumno el texto literal de la ley y su número. ESTÁ ESTRICTAMENTE PROHIBIDO iniciar tu respuesta repitiendo el artículo, copiando la ley o poniendo íconos de balanza. Arranca de inmediato con el 'CONCEPTO DOCTRINARIO'.\n" +
        "2. PROFUNDIDAD DOGMÁTICA OBLIGATORIA: Tus respuestas no pueden ser superficiales o escuetas. DEBES interconectar instituciones. Por ejemplo, si te preguntan por contratos bilaterales, debes obligatoriamente explicar su importancia práctica mencionando la condición resolutoria tácita, la teoría de los riesgos y la regla 'la mora purga la mora'. Aplica esta misma profundidad analítica y relacional a cualquier tema consultado.\n" +
        "3. PROTOCOLO DE COMPLEMENTACIÓN: Basa tu respuesta PRINCIPALMENTE en la sección 'APUNTES Y DOCTRINA' del contexto. Si falta información, usa tu conocimiento experto del Derecho Chileno citando a Claro Solar, Alessandri, Somarriva o Ramos Pazos.\n" +
        "4. TABLAS INQUEBRANTABLES: Usa sintaxis estricta Markdown (|---|---|) para cualquier tabla de clasificación.\n" +
        "5. ESTRUCTURA OBLIGATORIA:\n" +
        "   - ### CONCEPTO DOCTRINARIO\n" +
        "   - ### ELEMENTOS O REQUISITOS\n" +
        "   - ### CARACTERÍSTICAS\n" +
        "   - ### CLASIFICACIONES\n" +
        "   - ### INTEGRACIÓN DE FUENTES (Interconecta con otras instituciones clave del Código Civil)\n" +
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
    let respuestaFinal = "";

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
                respuestaFinal += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
            break;
        } catch (err) {
            intento++;
            if (intento >= MAX_REINTENTOS) {
                res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error temporal de conexión con la IA. Intenta de nuevo más tarde." })}\n\n`);
            } else {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    cacheRespuestas.set(hashPregunta, { respuesta: respuestaFinal, timestamp: Date.now() });
    historial.push({ role: "user", content: pregunta });
    historial.push({ role: "assistant", content: respuestaFinal });
    conversaciones.set(sessionId, historial.slice(-MAX_HISTORIAL));
});

// ======================== QUIZ INSTANTÁNEO ========================
const mapeoTemas = {
    "bienes": [
        { campo: "articulo_numero", operador: "gte", valor: 565 },
        { campo: "articulo_numero", operador: "lte", valor: 595 }
    ],
    "dominio": [
        { campo: "articulo_numero", operador: "gte", valor: 582 },
        { campo: "articulo_numero", operador: "lte", valor: 605 }
    ],
    "tradicion": [
        { campo: "articulo_numero", operador: "gte", valor: 670 },
        { campo: "articulo_numero", operador: "lte", valor: 699 }
    ],
    "posesion": [
        { campo: "articulo_numero", operador: "gte", valor: 700 },
        { campo: "articulo_numero", operador: "lte", valor: 729 }
    ],
    "filiacion": [
        { campo: "articulo_numero", operador: "gte", valor: 179 },
        { campo: "articulo_numero", operador: "lte", valor: 242 }
    ],
    "sucesion": [
        { campo: "articulo_numero", operador: "gte", valor: 951 },
        { campo: "articulo_numero", operador: "lte", valor: 1067 }
    ],
    "obligaciones": [
        { campo: "articulo_numero", operador: "gte", valor: 1437 },
        { campo: "articulo_numero", operador: "lte", valor: 1566 }
    ],
    "contratos": [
        { campo: "articulo_numero", operador: "gte", valor: 1438 },
        { campo: "articulo_numero", operador: "lte", valor: 2456 }
    ],
    "sociedad_conyugal": [
        { campo: "articulo_numero", operador: "gte", valor: 135 },
        { campo: "articulo_numero", operador: "lte", valor: 185 }
    ]
};

const cachePreguntasQuiz = new Map();

const fallbackEstaticoGlobal = [
    {
        tema: "bienes",
        pregunta: "¿Qué son los bienes muebles por anticipación?",
        opciones: [
            "A. Cosas que se mueven por sí mismas.",
            "B. Inmuebles por destinación que se consideran muebles antes de su separación.",
            "C. Bienes incorporales como los derechos.",
            "D. Cosas que están destinadas a ser trasladadas de un lugar a otro."
        ],
        correcta: 1
    },
    {
        tema: "dominio",
        pregunta: "El dominio o propiedad, según el artículo 582, es el derecho real que...",
        opciones: [
            "A. Permite usar, gozar y disponer de una cosa, sin más limitaciones que las legales.",
            "B. Solo permite usar la cosa ajena.",
            "C. Otorga únicamente el goce de la cosa.",
            "D. Es exclusivo de las personas jurídicas."
        ],
        correcta: 0
    },
    {
        tema: "tradicion",
        pregunta: "¿Cuál de los siguientes modos de adquirir el dominio se denomina 'tradición'?",
        opciones: [
            "A. La ocupación.",
            "B. La accesión.",
            "C. La entrega que el dueño hace a otro de la cosa, con ánimo de transferir el dominio.",
            "D. La sucesión por causa de muerte."
        ],
        correcta: 2
    },
    {
        tema: "obligaciones",
        pregunta: "¿Qué caracteriza a las obligaciones solidarias?",
        opciones: [
            "A. El deudor puede pagar por partes.",
            "B. Cualquier codeudor puede ser compelido al pago total de la deuda.",
            "C. Cada deudor paga solo su cuota.",
            "D. La solidaridad se presume, no necesita pacto expreso."
        ],
        correcta: 1
    },
    {
        tema: "contratos",
        pregunta: "¿Qué es la lesión enorme en la compraventa?",
        opciones: [
            "A. Un vicio del consentimiento.",
            "B. Un perjuicio económico que permite anular el contrato.",
            "C. El incumplimiento de una obligación.",
            "D. Una sanción penal para el vendedor."
        ],
        correcta: 1
    }
];

async function obtenerArticulosPorTema(tema) {
    const filtros = mapeoTemas[tema];
    if (!filtros) return null;
    let query = supabase
        .from('fragmentos_legales')
        .select('articulo_numero, contenido, titulo, libro')
        .eq('tipo', 'ley');
    filtros.forEach(f => {
        if (f.operador === 'gte') query = query.gte(f.campo, f.valor);
        else if (f.operador === 'lte') query = query.lte(f.campo, f.valor);
    });
    const { data, error } = await query.order('articulo_numero', { ascending: true });
    if (error) {
        console.error('Error al obtener artículos del tema:', error);
        return [];
    }
    return data;
}

function obtenerFallbackEstatico(tema) {
    const disponibles = fallbackEstaticoGlobal.filter(p => p.tema === tema);
    if (disponibles.length === 0) return null;
    return disponibles[Math.floor(Math.random() * disponibles.length)];
}

function validarFormatoQuiz(jsonString) {
    try {
        const obj = JSON.parse(jsonString);
        return obj.pregunta && Array.isArray(obj.opciones) && obj.opciones.length === 4 &&
               typeof obj.correcta === 'number' && obj.correcta >= 0 && obj.correcta <= 3 &&
               obj.explicacion;
    } catch (e) { return false; }
}

async function generarPreguntaConIA(articulo, tema) {
    const prompt = [
        {
            role: "system",
            content: `Eres un experto en Derecho Civil chileno. Devuelve ÚNICAMENTE un JSON con este formato exacto (sin Markdown, sin comentarios):
{
  "pregunta": "...",
  "opciones": ["A. ...","B. ...","C. ...","D. ..."],
  "correcta": 0,
  "explicacion": "..."
}
La pregunta debe ser de opción múltiple, basada en el artículo proporcionado.`
        },
        {
            role: "user",
            content: `Artículo ${articulo.articulo_numero}:\n${articulo.contenido}\n\nGenera el JSON del quiz.`
        }
    ];
    let quizData = null;
    const MAX_INTENTOS = 2;
    let intento = 0;
    while (intento < MAX_INTENTOS && !quizData) {
        try {
            const completion = await openai.chat.completions.create({
                model: "deepseek/deepseek-chat",
                messages: prompt,
                temperature: 0.3,
                max_tokens: 600,
                response_format: { type: "json_object" }
            });
            const respuesta = completion.choices[0]?.message?.content?.trim();
            if (respuesta && validarFormatoQuiz(respuesta)) {
                quizData = JSON.parse(respuesta);
            } else {
                intento++;
                prompt[0].content += `\n\nIntento ${intento+1}: Asegúrate de devolver el JSON con los campos exactos.`;
            }
        } catch (err) {
            intento++;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    if (!quizData) {
        quizData = {
            pregunta: `¿Qué establece el artículo ${articulo.articulo_numero} del Código Civil?`,
            opciones: [
                "A. Correcta según el artículo.",
                "B. Incorrecta.",
                "C. Incorrecta.",
                "D. Incorrecta."
            ],
            correcta: 0,
            explicacion: `El artículo ${articulo.articulo_numero} dispone: ${articulo.contenido.substring(0, 200)}...`
        };
    }
    return quizData;
}

app.post('/api/quiz/generar', async (req, res) => {
    const { tema, indice = 0 } = req.body;
    if (!tema || !mapeoTemas[tema]) {
        return res.status(400).json({ error: 'Tema no soportado.' });
    }
    try {
        const articulos = await obtenerArticulosPorTema(tema);
        if (!articulos || articulos.length === 0) {
            return res.status(404).json({ error: 'No hay artículos para este tema.' });
        }
        const total = articulos.length;
        const idx = ((indice % total) + total) % total;
        const articulo = articulos[idx];
        const claveCache = `${tema}_${idx}`;

        if (cachePreguntasQuiz.has(claveCache)) {
            const cached = cachePreguntasQuiz.get(claveCache);
            return res.json({
                articulo: { numero: articulo.articulo_numero, texto: articulo.contenido, titulo: articulo.titulo || '' },
                pregunta: cached.pregunta,
                opciones: cached.opciones,
                correcta: cached.correcta,
                explicacion: cached.explicacion,
                indice: idx,
                total,
                origen: 'cache'
            });
        }

        const fallback = obtenerFallbackEstatico(tema) || {
            pregunta: `¿Qué establece el artículo ${articulo.articulo_numero}?`,
            opciones: ["A. Incorrecta.", "B. Incorrecta.", "C. Incorrecta.", "D. Correcta según el artículo."],
            correcta: 3
        };
        const explicacionFallback = `El artículo ${articulo.articulo_numero} dispone: ${articulo.contenido.substring(0, 200)}...`;

        res.json({
            articulo: { numero: articulo.articulo_numero, texto: articulo.contenido, titulo: articulo.titulo || '' },
            pregunta: fallback.pregunta,
            opciones: fallback.opciones,
            correcta: fallback.correcta,
            explicacion: explicacionFallback,
            indice: idx,
            total,
            origen: 'fallback'
        });

        (async () => {
            try {
                const quizIA = await generarPreguntaConIA(articulo, tema);
                if (quizIA) {
                    cachePreguntasQuiz.set(claveCache, {
                        pregunta: quizIA.pregunta,
                        opciones: quizIA.opciones,
                        correcta: quizIA.correcta,
                        explicacion: quizIA.explicacion
                    });
                }
            } catch (e) {
                console.error('Error generando pregunta IA en segundo plano:', e);
            }
        })();
    } catch (error) {
        console.error('Error en /api/quiz/generar:', error);
        res.status(500).json({ error: 'Error interno del servidor.' });
    }
});

// Rutas de mantenimiento
app.get('/ping', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.send('API de Alucilex funcionando.'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor ALUCILEX en puerto ${PORT}`));