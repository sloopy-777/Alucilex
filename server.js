// server.js - Búsqueda con prioridad: Ley > Doctrina > Apuntes > IA general
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

    let contextoLegal = "";
    let busquedaExitosa = false;

    // 1. Búsqueda exacta por número de artículo
    const matchArt = pregunta.match(/\b(art[íi]culo|art\.)\s*(\d{1,4})\b/i);
    if (matchArt && matchArt[2]) {
        const numeroArt = matchArt[2];
        console.log(`📌 Búsqueda exacta del artículo ${numeroArt}...`);
        const { data, error } = await supabase
            .from('fragmentos_legales')
            .select('contenido, tipo, articulo_titulo_completo, articulo_numero')
            .eq('tipo', 'ley')
            .eq('articulo_numero', numeroArt)
            .limit(1);
        if (!error && data && data.length > 0) {
            contextoLegal = `### TEXTO LITERAL (DEBES COPIAR ESTO EXACTAMENTE) ###\n${data[0].contenido}\n### FIN DEL TEXTO LITERAL ###\n\n[CODIGO CIVIL - Art. ${data[0].articulo_numero}]`;
            busquedaExitosa = true;
            console.log(`✅ Artículo ${numeroArt} encontrado directamente.`);
        } else {
            console.log(`⚠️ No se encontró el artículo ${numeroArt}.`);
        }
    }

    // 2. Búsqueda por concepto (artículo que define algo)
    if (!busquedaExitosa && /cuál es el artículo que define|qué artículo define|artículo que habla de|qué articulo regula/i.test(pregunta)) {
        let concepto = "";
        const matchDefine = pregunta.match(/define\s+([a-záéíóúñ]+(?: [a-záéíóúñ]+)?)/i);
        const matchHabla = pregunta.match(/habla de\s+([a-záéíóúñ]+(?: [a-záéíóúñ]+)?)/i);
        const matchRegula = pregunta.match(/regula\s+([a-záéíóúñ]+(?: [a-záéíóúñ]+)?)/i);
        if (matchDefine) concepto = matchDefine[1];
        else if (matchHabla) concepto = matchHabla[1];
        else if (matchRegula) concepto = matchRegula[1];
        
        if (concepto) {
            console.log(`📌 Buscando artículo que define/regula "${concepto}"...`);
            try {
                const embeddingResponse = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: concepto,
                    dimensions: 768
                });
                const embedding = embeddingResponse.data[0].embedding;
                const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
                    query_embedding: embedding,
                    match_threshold: 0.1,
                    match_count: 7
                });
                if (!error && fragmentos && fragmentos.length > 0) {
                    const mejor = fragmentos.find(f => 
                        (f.contenido && (f.contenido.toLowerCase().includes("define") || f.contenido.toLowerCase().includes("concepto"))) ||
                        (f.articulo_titulo_completo && f.articulo_titulo_completo.toLowerCase().includes(concepto.toLowerCase()))
                    ) || fragmentos[0];
                    contextoLegal = `### TEXTO LITERAL (DEBES COPIAR ESTO EXACTAMENTE) ###\n${mejor.contenido}\n### FIN DEL TEXTO LITERAL ###\n\n[CODIGO CIVIL - Art. ${mejor.articulo_numero}]`;
                    busquedaExitosa = true;
                    console.log(`✅ Artículo ${mejor.articulo_numero} encontrado por concepto "${concepto}".`);
                }
            } catch (err) {
                console.log("⚠️ Error en búsqueda por concepto:", err.message);
            }
        }
    }

    // 3. Búsqueda semántica general (prioriza ley, luego doctrina, luego apuntes)
    if (!busquedaExitosa) {
        try {
            let embedding;
            if (cacheEmbeddings.has(hashPregunta)) {
                console.log("💾 Embedding desde caché");
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

            console.log("📚 Búsqueda semántica (umbral 0.15, 20 fragmentos)...");
            const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
                query_embedding: embedding,
                match_threshold: 0.15,
                match_count: 20
            });
            if (error) throw error;
            if (fragmentos && fragmentos.length > 0) {
                // Ordenar: primero ley, luego doctrina, luego apuntes_personales
                const ordenPrioridad = { ley: 1, doctrina: 2, apunte_personal: 3 };
                const ordenados = [...fragmentos].sort((a, b) => 
                    (ordenPrioridad[a.tipo] || 99) - (ordenPrioridad[b.tipo] || 99)
                );
                const seleccionados = ordenados.slice(0, 12);
                contextoLegal = seleccionados.map(f => {
                    let tipoLabel = "";
                    switch (f.tipo) {
                        case 'ley': tipoLabel = 'CODIGO CIVIL'; break;
                        case 'doctrina': tipoLabel = 'DOCTRINA (Orrego)'; break;
                        case 'apunte_personal': tipoLabel = 'APUNTES PERSONALES DEL USUARIO'; break;
                        default: tipoLabel = f.tipo;
                    }
                    const titulo = f.articulo_titulo_completo || f.articulo_numero || 'Fragmento';
                    return `[${tipoLabel} - ${titulo}]\n${f.contenido}`;
                }).join('\n\n');
                busquedaExitosa = true;
                console.log(`✅ Contexto recuperado (${seleccionados.length} fragmentos). Prioridad: ley, doctrina, apuntes.`);
            } else {
                console.log("⚠️ No se encontraron fragmentos relevantes.");
            }
        } catch (dbError) {
            console.log("⚠️ Búsqueda semántica fallida:", dbError.message);
        }
    }

    if (!contextoLegal) contextoLegal = "No se encontraron fragmentos relevantes en la base de datos.";

    // ========== SYSTEM PROMPT CORREGIDO Y CON PRIORIDAD A APUNTES ==========
    const systemPrompt = 
        "Eres Alucilex, un asistente legal experto en derecho civil chileno. Debes seguir estas instrucciones al pie de la letra:\n\n" +
        "1. busca en el codigo civil los articulos desde el articulo 1 hasta el 2524 y citarlos  100% , si corresponde al tema  :\n" +
        "2. PRIORIDAD DE FUENTES: CODIGO CIVIL  siempre debe citarse el articulo del codigo civil ,si es que corresponde , APUNTES PERSONALES DEL USUARIO,Luego usa DOCTRINA (Orrego).\n" +
        "3. ESTRUCTURA OBLIGATORIA DE RESPUESTA:\n" +
        "   - ### CONCEPTO Y DEFINICIÓN\n" +
        "   - ### ELEMENTOS O REQUISITOS (lista en viñetas)\n" +
        "   - ### CARACTERÍSTICAS (lista en viñetas)\n" +
        "   - ### CLASIFICACIONES (si aplica, usa tabla de Markdown si hay más de dos categorías)\n" +
        "   - ### EJEMPLOS (al menos dos ejemplos concretos)\n\n" +
        "3. CIERRE: NO incluyas una conclusión tradicional. En su lugar, finaliza la respuesta invitando al usuario a profundizar, por ejemplo: '¿Te gustaría que profundice en algún aspecto particular de este tema?' o 'Si necesitas más detalles sobre [subtema relevante], no dudes en preguntar.'\n" +
        "3. CITA LITERAL: Si el contexto contiene un artículo del Código Civil o un texto marcado con '### TEXTO LITERAL...', transcríbelo exactamente, sin modificar.\n" +
        "4. PROHIBICIONES: No inventes artículos ni citas que no estén en el contexto. Si no hay información suficiente, responde: 'No encontré suficiente información en mi base de datos para responder completamente.'\n" +
        "5. FORMATO: Usa Markdown (negritas, viñetas, tablas). La respuesta debe ser extensa (mínimo 800 palabras).\n" +
        "6. IDIOMA: Español.";

    let mensajes = [{ role: "system", content: systemPrompt }];
    for (let msg of historial) mensajes.push(msg);
    mensajes.push({
        role: "user",
        content: "CONTEXTO LEGAL (ÚNICA FUENTE DE INFORMACIÓN):\n" + contextoLegal + "\n\nINSTRUCCIÓN: Prioriza los APUNTES PERSONALES si existen. Luego la doctrina y el Código Civil. Si el contexto contiene un artículo literal, cópialo exactamente. Responde con la estructura completa (concepto, elementos, características, clasificaciones, ejemplos, conclusión).\n\nPREGUNTA DEL USUARIO: " + pregunta
    });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    // ========== REINTENTOS ==========
    const MAX_REINTENTOS = 3;
    let intento = 0;
    let respuestaCompleta = "";
    let streamError = null;

    while (intento < MAX_REINTENTOS) {
        try {
            console.log(`🧠 Consultando a la IA (intento ${intento + 1}/${MAX_REINTENTOS})...`);
            const stream = await openai.chat.completions.create({
                model: "deepseek/deepseek-chat", // o "google/gemini-2.0-flash-lite-001", etc.
                messages: mensajes,
                temperature: 0.0,
                max_tokens: 2500,
                stream: true,
            });

            respuestaCompleta = "";
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
            console.log("✅ Respuesta completada.");
            return; // éxito

        } catch (err) {
            streamError = err;
            console.error(`❌ Error en IA (intento ${intento + 1}):`, err.message);
            intento++;
            if (intento < MAX_REINTENTOS) {
                console.log(`⏳ Reintentando en 2 segundos...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    // Si todos los reintentos fallaron
    console.error("❌ Todos los reintentos fallaron:", streamError);
    res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error temporal de conexión con la IA. Intenta de nuevo más tarde." })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
});

app.get('/ping', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor ALUCILEX (prioridad: ley > doctrina > apuntes) en puerto ${PORT}`));