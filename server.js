// server.js - Búsqueda genérica de artículos por concepto (sin diccionario)
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

    // 2. Búsqueda por concepto (genérico) si la pregunta pide un artículo que define algo
    if (!busquedaExitosa && /cuál es el artículo que define|qué artículo define|artículo que habla de|qué articulo regula/i.test(pregunta)) {
        // Extraer el concepto: tomar la palabra después de "define", "habla de" o "regula"
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
                // Generar embedding del concepto
                const embeddingResponse = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: concepto,
                    dimensions: 768
                });
                const embedding = embeddingResponse.data[0].embedding;
                
                // Buscar solo en ley, umbral bajo
                const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
                    query_embedding: embedding,
                    match_threshold: 0.1,
                    match_count: 5
                });
                if (!error && fragmentos && fragmentos.length > 0) {
                    // Priorizar fragmentos que contengan "define", "concepto", o el concepto en el título
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

    // 3. Búsqueda semántica general si no se encontró nada
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
                const leyes = fragmentos.filter(f => f.tipo === 'ley');
                const doctrina = fragmentos.filter(f => f.tipo === 'doctrina');
                const ordenados = [...leyes, ...doctrina];
                const seleccionados = ordenados.slice(0, 12);
                contextoLegal = seleccionados.map(f => {
                    const tipo = f.tipo === 'ley' ? 'CODIGO CIVIL' : 'DOCTRINA (Orrego)';
                    const titulo = f.articulo_titulo_completo || f.articulo_numero || 'Fragmento';
                    return `[${tipo} - ${titulo}]\n${f.contenido}`;
                }).join('\n\n');
                busquedaExitosa = true;
                console.log(`✅ Contexto recuperado (${seleccionados.length} fragmentos).`);
            } else {
                console.log("⚠️ No se encontraron fragmentos relevantes.");
            }
        } catch (dbError) {
            console.log("⚠️ Búsqueda semántica fallida:", dbError.message);
        }
    }

    if (!contextoLegal) contextoLegal = "No se encontraron fragmentos relevantes en la base de datos.";

    // System prompt simplificado pero exigente
    const systemPrompt = 
        "Eres Alucilex, un asistente legal experto en derecho civil chileno. Debes seguir estas instrucciones al pie de la letra:\n\n" +
        "1. Si el contexto contiene el marcador '### TEXTO LITERAL (DEBES COPIAR ESTO EXACTAMENTE) ###', entonces debes copiar el texto que está entre ese marcador y '### FIN DEL TEXTO LITERAL ###' sin cambiar ni una letra, ni puntuación, ni espacios. Usa formato de cita con '> ' al inicio de cada línea.\n\n" +
        "2. Después de la cita literal, desarrolla el concepto con esta estructura exacta:\n" +
        "   - ### ARTICULO DE CODIGO CIVIL CHILENO DE BASEDE DATOS\n" +
        "   - ### DOCTRINA O APUNTES  DE LA BASE DE DATOS QUE CONTENGA  LOS SIGUIENTES PARAMETROS :\n" +
        "   - ### CONCEPTO Y DEFINICIÓN\n" +
        "   - ### ELEMENTOS O REQUISITOS (lista en viñetas)\n" +
        "   - ### CARACTERÍSTICAS (lista en viñetas)\n" +
        "   - ### CLASIFICACIONES (si aplica, usa tabla de Markdown si hay más de dos categorías)\n" +
        "   - ### EJEMPLOS (al menos dos ejemplos concretos)\n" +
        "   - ### CONCLUSIÓN\n\n" +
        "3. PROHIBIDO inventar artículos o citas que no estén en el contexto.\n" +
        "4. Si el contexto no contiene el artículo solicitado, responde exactamente: 'No encontré el artículo en mi base de datos.'\n" +
        "5. Usa formato Markdown (negritas, viñetas, tablas). La respuesta debe ser extensa (mínimo 800 palabras).\n" +
        "6. Responde siempre en español.";

    let mensajes = [{ role: "system", content: systemPrompt }];
    for (let msg of historial) mensajes.push(msg);
    mensajes.push({
        role: "user",
        content: "CONTEXTO LEGAL (ÚNICA FUENTE):\n" + contextoLegal + "\n\nINSTRUCCIÓN ESPECÍFICA: Si el contexto contiene '### TEXTO LITERAL...', copia ese texto exactamente. Luego desarrolla el tema con la estructura completa (concepto, elementos, características, clasificaciones, ejemplos, conclusión). No inventes.\n\nPREGUNTA DEL USUARIO: " + pregunta
    });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    try {
        console.log("🧠 Consultando a la IA...");
        const stream = await openai.chat.completions.create({
            model: "google/gemini-2.0-flash-lite-001", // Cambia a otro modelo si lo prefieres
            messages: mensajes,
            temperature: 0.0,
            max_tokens: 3500,
            stream: true,
        });

        let respuestaCompleta = "";
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
    } catch (aiError) {
        console.error("❌ Error en IA:", aiError);
        res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error temporal. Intenta de nuevo." })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

app.get('/ping', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor ALUCILEX (búsqueda genérica por concepto) en puerto ${PORT}`));