// server.js - Búsqueda semántica mejorada + uso exclusivo del contexto
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

// ========== CACHÉS ==========
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

// ========== ENDPOINT PRINCIPAL ==========
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

    // 1. Búsqueda exacta por número de artículo (prioritaria)
    let contextoLegal = "";
    let busquedaExitosa = false;
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
            contextoLegal = `[CODIGO CIVIL - Art. ${data[0].articulo_numero} - ${data[0].articulo_titulo_completo || ''}]\n${data[0].contenido}`;
            busquedaExitosa = true;
            console.log(`✅ Artículo ${numeroArt} encontrado directamente.`);
        } else {
            console.log(`⚠️ No se encontró el artículo ${numeroArt}.`);
        }
    }

    // 2. Búsqueda semántica si no hubo exacta
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
                // Ordenar: primero ley, luego doctrina (opcional, ya viene por similitud)
                const leyes = fragmentos.filter(f => f.tipo === 'ley');
                const doctrina = fragmentos.filter(f => f.tipo === 'doctrina');
                const ordenados = [...leyes, ...doctrina];
                // Limitar a 12 fragmentos en total para no saturar
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

    // 3. Si no hay contexto, forzar a la IA a decirlo
    if (!contextoLegal) {
        contextoLegal = "No se encontraron fragmentos relevantes en la base de datos para esta consulta.";
    }

    // 4. Prompt del sistema extremadamente estricto
    const systemPrompt = `Eres Alucilex, un asistente legal experto en derecho civil chileno. Tu ÚNICA fuente de información es el CONTEXTO LEGAL que se te proporciona. No tienes conocimiento propio ni puedes inventar artículos.

REGLAS OBLIGATORIAS:
1. Si el contexto contiene fragmentos del Código Civil o doctrina, úsalos EXCLUSIVAMENTE para responder.
2. Si el contexto dice "No se encontraron fragmentos relevantes", responde: "No tengo información en mi base de datos para responder a esta pregunta. Por favor, reformula tu consulta."
3. PROHIBIDO mencionar artículos o conceptos que no estén en el contexto.
4. Si el contexto contiene artículos, transcríbelos literalmente.
5. Responde de forma extensa y didáctica (mínimo 500 palabras) solo si el contexto lo permite. Si no, sé breve y honesto.

RESPONDE SIEMPRE EN ESPAÑOL.`;

    let mensajes = [{ role: "system", content: systemPrompt }];
    for (let msg of historial) mensajes.push(msg);
    mensajes.push({
        role: "user",
        content: `CONTEXTO LEGAL (ÚNICA FUENTE):\n${contextoLegal}\n\nPREGUNTA: ${pregunta}`
    });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    try {
        console.log("🧠 Consultando a la IA...");
        const stream = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",
            messages: mensajes,
            temperature: 0.2,
            max_tokens: 2500,
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
app.listen(PORT, () => console.log(`🚀 Servidor ALUCILEX mejorado en puerto ${PORT}`));