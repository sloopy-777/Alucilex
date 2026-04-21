// server.js - Versión FINAL con cita literal + estructura didáctica completa
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
            contextoLegal = `### TEXTO LITERAL ###\n${data[0].contenido}\n### FIN TEXTO LITERAL ###\n\n[CODIGO CIVIL - Art. ${data[0].articulo_numero}]`;
            busquedaExitosa = true;
            console.log(`✅ Artículo ${numeroArt} encontrado directamente.`);
        } else {
            console.log(`⚠️ No se encontró el artículo ${numeroArt}.`);
        }
    }

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

    const systemPrompt = `Eres Alucilex, un tutor experto en derecho civil chileno. Tu respuesta debe seguir ESTRICTAMENTE esta estructura didáctica:

1. CITA LITERAL: Si el contexto contiene "### TEXTO LITERAL ###", transcribe ese texto exactamente al inicio (usando formato de cita >). Si no, omite este paso.
2. CONCEPTO Y DEFINICIÓN: Explica el significado del tema, basándote en la doctrina de Orrego.
3. ELEMENTOS O REQUISITOS: Enumera en viñetas los componentes necesarios.
4. CARACTERÍSTICAS: Enumera en viñetas los rasgos esenciales.
5. CLASIFICACIONES (si aplica): Presenta los tipos o categorías. Si hay más de dos, usa una tabla de Markdown para comparar.
6. EJEMPLOS: Incluye al menos dos ejemplos concretos y explicados.
7. CONCLUSIÓN: Resumen breve de la importancia del concepto.

La respuesta debe ser EXTENSA (mínimo 800 palabras), usar formato Markdown (negritas, viñetas, tablas) y estar en español.`;

    let mensajes = [{ role: "system", content: systemPrompt }];
    for (let msg of historial) mensajes.push(msg);
    mensajes.push({
        role: "user",
        content: `INSTRUCCIÓN ESPECÍFICA: Aplica la estructura didáctica completa (cita literal, concepto, elementos, características, clasificaciones (con tabla si corresponde), ejemplos, conclusión).\n\nCONTEXTO LEGAL:\n${contextoLegal}\n\nPREGUNTA: ${pregunta}`
    });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    try {
        console.log("🧠 Consultando a DeepSeek...");
        const stream = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",
            messages: mensajes,
            temperature: 0.1,
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
app.listen(PORT, () => console.log(`🚀 Servidor ALUCILEX (didáctico completo) en puerto ${PORT}`));