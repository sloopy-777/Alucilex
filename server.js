// server.js - Búsqueda Jerárquica + Diccionario de Oro + Inyección Determinista + Validador de Reglas de Oro
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
const diccionarioOro = {
    // ... (todo igual que en tu código original, no lo repito para no alargar)
    // (Asegúrate de copiarlo completo aquí)
};
// Fin del diccionario

// Función auxiliar para calcular la similitud matemática entre dos textos (Distancia de Levenshtein)
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
    // ... (igual que en tu código original)
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

// ========== NUEVA FUNCIÓN DE VALIDACIÓN DE LAS REGLAS DE ORO ==========
/**
 * Verifica que la respuesta generada por el modelo cumpla todas las reglas.
 * @param {string} respuesta - Texto completo generado por la IA (sin la ley inyectada).
 * @param {string} contextoLey - El texto legal que se inyectó al inicio, para asegurarnos de que no se repita.
 * @returns {object} { valida: boolean, razones: string[] }
 */
function validarFormatoRespuesta(respuesta, contextoLey) {
    const razones = [];
    const rtaLimpia = respuesta.trim();

    // Regla 1: No debe comenzar repitiendo el artículo de la ley inyectada
    if (contextoLey && contextoLey.trim().length > 0) {
        // Extraemos las primeras líneas del texto legal (primeros 100 caracteres)
        const inicioLey = contextoLey.trim().replace(/\s+/g, ' ').substring(0, 100).toLowerCase();
        const inicioRespuesta = rtaLimpia.replace(/\s+/g, ' ').substring(0, 100).toLowerCase();
        // Comprobamos si la respuesta arranca copiando el texto legal o el número de artículo
        if (inicioRespuesta.includes(inicioLey.substring(0, 50))) {
            razones.push("La respuesta no debe repetir el texto literal de la ley al inicio.");
        }
        // También prohibimos que empiece con algo como "Artículo 1444..." o "### ⚖️ ARTÍCULO..."
        if (/^###\s*⚖️\s*ARTÍCULO/i.test(rtaLimpia)) {
            razones.push("La respuesta no debe comenzar con un encabezado de artículo (### ⚖️ ARTÍCULO).");
        }
    }

    // Regla 5: Debe contener TODAS las secciones obligatorias
    const seccionesObligatorias = [
        '### CONCEPTO DOCTRINARIO',
        '### ELEMENTOS O REQUISITOS',
        '### CARACTERÍSTICAS',
        '### CLASIFICACIONES',
        '### INTEGRACIÓN DE FUENTES',
        '### EJEMPLOS PRÁCTICOS',
        '### CONCLUSIÓN'
    ];

    for (const seccion of seccionesObligatorias) {
        if (!rtaLimpia.includes(seccion)) {
            razones.push(`Falta la sección obligatoria: ${seccion}`);
        }
    }

    // Regla 4 (opcionalmente podrías verificar que si hay tablas, sean markdown estricto)
    // Por ahora no forzamos la validación de tablas para no ser demasiado agresivos, pero podrías agregar:
    // if (rtaLimpia.includes('|') && !/\|[-|]+\|/.test(rtaLimpia)) {
    //     razones.push("Las tablas deben usar sintaxis Markdown estricta (|---|---|)");
    // }

    return {
        valida: razones.length === 0,
        razones
    };
}

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

    // =========================================================================
    // FASE 0: AGENTE ENRUTADOR (TRIAGE DE AMBIGÜEDAD Y CONTRAPREGUNTA)
    // =========================================================================
    try {
        const mensajesTriaje = [
            { 
                role: "system", 
                content: "Eres un Agente Enrutador Jurídico. Tu misión es detectar si la pregunta del usuario mezcla conceptos inconexos (ej. 'el matrimonio es un modo de adquirir el dominio'), es muy ambigua, o tiene graves errores. " +
                         "Si detectas ambigüedad, debes recomponer la pregunta formulando una breve opción aclaratoria para el usuario. " +
                         "FORMATO ESTRICTO: Si hay ambigüedad, responde empezando exactamente con la palabra 'ACLARACION:' seguida de tu pregunta (ej. 'ACLARACION: ¿Deseas saber sobre el matrimonio o sobre los modos de adquirir el dominio?'). " +
                         "Si la pregunta es clara, O si el usuario está respondiendo de forma coherente a una aclaración previa tuya (ej. responde 'del dominio'), responde ÚNICAMENTE con la palabra 'CLARA'." 
            },
            ...historial.slice(-4), // Inyectamos el historial para que entienda el contexto de la respuesta del usuario
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
            
            console.log("🛑 Ambigüedad detectada. Enviando contrapregunta.");
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

    // 1A. BUSCAR NÚMERO DE ARTÍCULO EXACTO EN LA PREGUNTA
    const matchNumero = pregunta.match(/(?:art(?:[íi]culo|\.?)?\s*)?(\d{1,4})/i);
    if (matchNumero && matchNumero[1]) {
        numeroArticuloDetectado = matchNumero[1];
    } else {
        const detectadoDiccionario = buscarEnDiccionario(pregunta);
        if (detectadoDiccionario) {
            numeroArticuloDetectado = detectadoDiccionario;
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
        }
    }

    try {
        // 3. GENERAR EMBEDDING
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

        // 4. BÚSQUEDA SEMÁNTICA EN LEY (solo si falló el enrutador)
        if (!articuloExactoEncontrado) {
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

        // 5. BÚSQUEDA SEMÁNTICA EN APUNTES
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

    // Enviamos el encabezado SSE
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    // ========== INYECCIÓN DETERMINISTA DIRECTA A LA PANTALLA (igual que antes) ==========
    if (contextoLey) {
        const inyeccion = `### ⚖️ ARTÍCULO ${numeroArticuloDetectado}\n${contextoLey.replace(/\[CÓDIGO CIVIL - Art. \d+\]\s*Art. \d+./g, '')}\n---\n\n`;
        res.write(`data: ${JSON.stringify({ content: inyeccion })}\n\n`);
    }

    // ========== PROMPT DEL SISTEMA (PROFESOR Y VALIDADOR) ==========
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

    // ========== PREPARACIÓN DE MENSAJES PARA EL MODELO ==========
    let mensajesBase = [{ role: "system", content: systemPrompt }];
    for (let msg of historial) mensajesBase.push(msg);
    mensajesBase.push({
        role: "user",
        content: "CONTEXTO RECUPERADO DE LA BASE DE DATOS:\n\n" + contextoTotal + "\n\nPREGUNTA DEL USUARIO: " + pregunta
    });

    const MAX_INTENTOS = 3;
    let intento = 0;
    let respuestaValida = false;
    let respuestaFinal = "";
    let ultimoError = null;
    let mensajesParaModelo = mensajesBase.slice(); // copia independiente

    // ======== BUCLE DE GENERACIÓN Y VALIDACIÓN ========
    while (intento < MAX_INTENTOS && !respuestaValida) {
        try {
            // Si no es el primer intento, añadimos un refuerzo de penalización
            if (intento > 0) {
                const penalizacion = "\n\n**⚠️ ATENCIÓN: Tu respuesta anterior fue RECHAZADA por incumplir las REGLAS DE ORO. Recuerda:**\n" +
                    "- Debes comenzar **exactamente** con '### CONCEPTO DOCTRINARIO' y **NO** repetir el artículo de la ley.\n" +
                    "- Debes incluir **TODAS** las secciones obligatorias (CONCEPTO DOCTRINARIO, ELEMENTOS O REQUISITOS, CARACTERÍSTICAS, CLASIFICACIONES, INTEGRACIÓN DE FUENTES, EJEMPLOS PRÁCTICOS, CONCLUSIÓN).\n" +
                    "- Usa tablas Markdown estrictas si clasificas.\n" +
                    "Vuelve a generar la respuesta cumpliendo **estrictamente** todas las reglas.\n";
                // Modificamos el último mensaje del usuario para añadir la penalización
                mensajesParaModelo[mensajesParaModelo.length - 1].content += penalizacion;
            }

            // Acumulamos toda la respuesta de este intento sin enviarla al cliente aún
            let respuestaParcial = "";
            const stream = await openai.chat.completions.create({
                model: "deepseek/deepseek-chat",
                messages: mensajesParaModelo,
                temperature: 0.1,
                max_tokens: 3000,
                stream: true,
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                respuestaParcial += content;
            }

            // Validamos formato
            const resultado = validarFormatoRespuesta(respuestaParcial, contextoLey);
            if (resultado.valida) {
                respuestaFinal = respuestaParcial;
                respuestaValida = true;
            } else {
                console.log(`❌ Intento ${intento + 1} rechazado. Razones: ${resultado.razones.join('; ')}`);
                ultimoError = resultado.razones.join(', ');
                // Restauramos los mensajes originales para el próximo intento (sin la penalización acumulada)
                mensajesParaModelo = mensajesBase.slice();
                intento++;
            }
        } catch (err) {
            ultimoError = err.message;
            intento++;
            console.log(`⚠️ Error en intento ${intento}:`, err.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    // Si después de todos los intentos no conseguimos una respuesta válida, enviamos un mensaje de error
    if (!respuestaValida) {
        const mensajeError = `\n\n❌ **Error de validación:** No se pudo generar una respuesta que cumpla las reglas después de ${MAX_INTENTOS} intentos. Razones: ${ultimoError || 'error desconocido'}`;
        respuestaFinal = mensajeError;
    }

    // Ahora enviamos la respuesta validada (o el error) al cliente
    // Podemos enviarla troceada para simular streaming (cada 50 caracteres, o como prefieras)
    const chunkSize = 50;
    for (let i = 0; i < respuestaFinal.length; i += chunkSize) {
        const chunk = respuestaFinal.substring(i, i + chunkSize);
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        // Pequeña pausa para no saturar (opcional)
        await new Promise(r => setTimeout(r, 20));
    }

    // Enviamos el fin de la transmisión
    res.write('data: [DONE]\n\n');
    res.end();

    // Guardamos en caché y actualizamos historial (solo si la respuesta es válida y no es error)
    if (respuestaValida) {
        cacheRespuestas.set(hashPregunta, { respuesta: respuestaFinal, timestamp: Date.now() });
        historial.push({ role: "user", content: pregunta });
        historial.push({ role: "assistant", content: respuestaFinal });
        conversaciones.set(sessionId, historial.slice(-MAX_HISTORIAL));
    } else {
        // Igual guardamos el error en historial para contexto
        historial.push({ role: "user", content: pregunta });
        historial.push({ role: "assistant", content: respuestaFinal });
        conversaciones.set(sessionId, historial.slice(-MAX_HISTORIAL));
    }
});

app.get('/ping', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.send('API de Alucilex funcionando.'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor ALUCILEX en puerto ${PORT}`));
// ===== NUEVO: MODO QUIZ (mientras el chat genera respuesta) =====

// 1. Mapeo de temas a rangos de artículos del Código Civil (ajusta según tu estructura)
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

/**
 * Obtiene todos los artículos de un tema ordenados por número.
 * Retorna array de objetos { articulo_numero, contenido, titulo }
 */
async function obtenerArticulosPorTema(tema) {
  const filtros = mapeoTemas[tema];
  if (!filtros) return null;

  let query = supabase
    .from('fragmentos_legales')
    .select('articulo_numero, contenido, titulo, libro')
    .eq('tipo', 'ley');

  // Aplicar los filtros de rango
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

// Validador de estructura del JSON del quiz (similar a Reglas de Oro pero para JSON)
function validarFormatoQuiz(jsonString) {
  try {
    const obj = JSON.parse(jsonString);
    if (!obj.pregunta || typeof obj.pregunta !== 'string') return false;
    if (!Array.isArray(obj.opciones) || obj.opciones.length !== 4) return false;
    if (typeof obj.correcta !== 'number' || obj.correcta < 0 || obj.correcta > 3) return false;
    if (!obj.explicacion || typeof obj.explicacion !== 'string') return false;
    return true;
  } catch (e) {
    return false;
  }
}

// Endpoint del quiz
app.post('/api/quiz/generar', async (req, res) => {
  const { tema, indice = 0 } = req.body;
  if (!tema || !mapeoTemas[tema]) {
    return res.status(400).json({ error: 'Tema no válido o no soportado.' });
  }

  try {
    // Obtenemos la lista de artículos (cache local para la sesión podría mejorarse después)
    const articulos = await obtenerArticulosPorTema(tema);
    if (!articulos || articulos.length === 0) {
      return res.status(404).json({ error: 'No se encontraron artículos para este tema.' });
    }

    const total = articulos.length;
    const idx = ((indice % total) + total) % total; // permite índices negativos?
    const articulo = articulos[idx];

    // Preparar el prompt para la IA
    const promptQuiz = [
      {
        role: "system",
        content: `Eres un experto en Derecho Civil chileno. Genera ÚNICAMENTE un objeto JSON válido con el siguiente formato exacto (sin Markdown, sin comentarios):
{
  "pregunta": "texto de la pregunta",
  "opciones": ["A. opción A", "B. opción B", "C. opción C", "D. opción D"],
  "correcta": 0, // índice de la opción correcta (0..3)
  "explicacion": "breve explicación del artículo"
}
La pregunta debe ser de opción múltiple, correcta y basada en el artículo que te proporciono.`
      },
      {
        role: "user",
        content: `Artículo del Código Civil chileno:\nArtículo ${articulo.articulo_numero}:\n${articulo.contenido}\n\nGenera el JSON del quiz.`
      }
    ];

    let quizData = null;
    const MAX_INTENTOS = 3;
    let intento = 0;
    let ultimoError = '';

    while (intento < MAX_INTENTOS && !quizData) {
      try {
        const completion = await openai.chat.completions.create({
          model: "deepseek/deepseek-chat",
          messages: promptQuiz,
          temperature: 0.3,
          max_tokens: 600,
          response_format: { type: "json_object" } // Forzamos JSON si el modelo lo soporta
        });

        const respuesta = completion.choices[0]?.message?.content?.trim();
        if (respuesta && validarFormatoQuiz(respuesta)) {
          quizData = JSON.parse(respuesta);
        } else {
          ultimoError = 'Formato JSON inválido o campos faltantes.';
          intento++;
          // Añadir penalización en el siguiente intento
          promptQuiz[0].content += `\n\n¡Intento ${intento+1}! Asegúrate de devolver EXACTAMENTE el JSON con los campos: pregunta, opciones (array de 4 strings), correcta (índice 0-3), explicacion.`;
        }
      } catch (err) {
        ultimoError = err.message;
        intento++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!quizData) {
      // Fallback: si la IA falla, generar algo básico
      const opcionesFallback = [
        "A. Correcta según el artículo.",
        "B. Incorrecta.",
        "C. Incorrecta.",
        "D. Incorrecta."
      ];
      quizData = {
        pregunta: `¿Qué establece el artículo ${articulo.articulo_numero} del Código Civil?`,
        opciones: opcionesFallback,
        correcta: 0,
        explicacion: `El artículo ${articulo.articulo_numero} dispone: ${articulo.contenido.substring(0, 200)}...`
      };
    }

    res.json({
      articulo: {
        numero: articulo.articulo_numero,
        texto: articulo.contenido,
        titulo: articulo.titulo || ''
      },
      pregunta: quizData.pregunta,
      opciones: quizData.opciones,
      correcta: quizData.correcta,
      explicacion: quizData.explicacion,
      indice: idx,
      total: total
    });

  } catch (error) {
    console.error('Error en /api/quiz/generar:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});