// server.js - Búsqueda exacta de artículos + semántica
require('dotenv').config();
const express = require('express');
const cors = require('cors');
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

app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    if (!pregunta) return res.status(400).json({ error: "Pregunta vacía" });

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    let contextoLegal = "";
    let busquedaExitosa = false;

    // 1. Búsqueda EXACTA por número de artículo (si la pregunta menciona "artículo X")
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
            contextoLegal = `[CODIGO CIVIL - Art. ${data[0].articulo_numero}]\n${data[0].contenido}`;
            busquedaExitosa = true;
            console.log(`✅ Artículo ${numeroArt} encontrado directamente.`);
        } else {
            console.log(`⚠️ No se encontró el artículo ${numeroArt} en la base de datos.`);
        }
    }

    // 2. Si no fue búsqueda exacta o falló, usar búsqueda semántica
    if (!busquedaExitosa) {
        try {
            console.log("🔍 Generando embedding para:", pregunta);
            const embeddingResponse = await openai.embeddings.create({
                model: 'text-embedding-3-small',
                input: pregunta.substring(0, 8000),
                dimensions: 768   // FORZADO a 768
            });
            const embedding = embeddingResponse.data[0].embedding;

            console.log("📚 Buscando en Supabase (semántica)...");
            const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
                query_embedding: embedding,
                match_threshold: 0.20,
                match_count: 8
            });

            if (error) throw error;
            if (fragmentos && fragmentos.length > 0) {
                contextoLegal = fragmentos.map(f => {
                    const tipo = f.tipo === 'ley' ? 'CODIGO CIVIL' : 'DOCTRINA (Orrego)';
                    const titulo = f.articulo_titulo_completo || f.articulo_numero || 'Fragmento';
                    return `[${tipo} - ${titulo}]\n${f.contenido}`;
                }).join('\n\n');
                busquedaExitosa = true;
                console.log(`✅ Contexto recuperado (${fragmentos.length} fragmentos).`);
            } else {
                console.log("⚠️ No se encontraron fragmentos relevantes.");
            }
        } catch (dbError) {
            console.log("⚠️ Búsqueda semántica fallida:", dbError.message);
        }
    }

    // 3. Prompt estricto (obliga a usar el contexto)
    const systemPrompt = `Eres Alucilex, un asistente legal experto en derecho civil chileno. Tus respuestas deben ser SIEMPRE consistentes y confiables.

REGLAS OBLIGATORIAS:
1. Si la consulta pide un artículo específico (ej. "artículo 1444") y el CONTEXTO contiene ese artículo, transcríbelo LITERALMENTE al inicio de la respuesta.
2. Si el contexto NO contiene el artículo solicitado, responde: "No encontré el artículo [número] en mi base de datos. Por favor, verifica el número."
3. PROHIBIDO inventar artículos o citas que no estén en el contexto.
4. Para preguntas conceptuales, desarrolla la respuesta de forma extensa (mínimo 500 palabras), usando el contexto si está disponible. Si no hay contexto, usa tu conocimiento jurídico chileno (pero sin inventar artículos).
5. Las respuestas deben ser iguales para todos los usuarios ante la misma pregunta (no hay sesiones personalizadas).
6. Usa formato Markdown: negritas, viñetas, subtítulos.

RESPONDE DE FORMA DIDÁCTICA Y ESTRUCTURADA.`;

    try {
        console.log("🧠 Consultando a la IA...");
        const stream = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",  // pago
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `CONTEXTO LEGAL (ÚSALO PRIORITARIAMENTE):\n${contextoLegal || "No hay contexto específico. Usa tu conocimiento jurídico chileno sin inventar artículos."}\n\nPREGUNTA: ${pregunta}` }
            ],
            temperature: 0.3,   // más bajo para consistencia
            max_tokens: 2500,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        console.log("✅ Respuesta completada.");
    } catch (aiError) {
        console.error("❌ Error en IA:", aiError);
        res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error temporal. Intenta de nuevo." })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Servidor ALUCILEX (búsqueda exacta) en puerto ${PORT}`));