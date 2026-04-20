// server.js - Motor Alucilex DEFINITIVO (Blindaje Anti-Crash)
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
    
    // 1. Evitamos que una pregunta vacía colapse el servidor
    if (!pregunta) {
        return res.status(400).json({ error: "La pregunta está vacía" });
    }

    // 2. Fijamos la respuesta como "Exitosa" (200) desde el inicio para evitar Errores 500
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    let contextoLegal = "";

    // BLOQUE A: Búsqueda Vectorial (AISLADA)
    // Si esto falla (por OpenRouter o Supabase), el código sobrevive y pasa al Bloque B.
    try {
        console.log("🔍 Generando Embedding para:", pregunta);
        const embeddingResponse = await openai.embeddings.create({
            model: 'openai/text-embedding-3-small', // PREFIJO CORREGIDO PARA OPENROUTER
            input: pregunta.substring(0, 8000)
        });
        const embedding = embeddingResponse.data[0].embedding;

        console.log("📚 Buscando en Supabase...");
        const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
            query_embedding: embedding,
            match_threshold: 0.01, 
            match_count: 10
        });

        if (error) throw error;

        if (fragmentos && fragmentos.length > 0) {
            contextoLegal = fragmentos.map(f => `[DOCUMENTO]: ${f.contenido}`).join('\n\n');
            console.log("✅ Contexto legal recuperado.");
        }
    } catch (dbError) {
        console.log("⚠️ Advertencia: Búsqueda fallida. Pasando a memoria absoluta de la IA. Motivo:", dbError.message);
        // NO lanzamos el error. El servidor sigue vivo.
    }

    // BLOQUE B: Respuesta de la Inteligencia Artificial (INFALIBLE)
    try {
        console.log("🧠 Consultando a DeepSeek...");
        const stream = await openai.chat.completions.create({
            model: "openai/gpt-3.5-turbo",
            messages: [
                { 
                    role: "system", 
                    content: `Eres Alucilex, el abogado digital más experto en el Código Civil de Chile y la doctrina de Orrego.

                    REGLAS DE ORO (INQUEBRANTABLES):
                    1. PROHIBIDO RENDIRSE: JAMÁS digas "no se menciona en el contexto" o "no puedo proporcionar información". 
                    2. CONOCIMIENTO ABSOLUTO: Si el usuario pregunta por un artículo (ej. Artículo 588) y el contexto está vacío o es confuso, TÚ DEBES RECITARLO de memoria usando tu vasto conocimiento del Código Civil Chileno vigente.
                    3. EL CONTEXTO ES UN APOYO: Lee el 'CONTEXTO RECUPERADO'. Si te sirve, úsalo. Si tiene leyes derogadas de 1931 o información que no corresponde al Código Civil, IGNÓRALO COMPLETA Y ABSOLUTAMENTE.
                    4. FORMATO: Responde siempre como un profesional, directo al grano, usando Markdown (negritas y viñetas).` 
                },
                { role: "user", content: `CONTEXTO RECUPERADO (Úsalo solo si es útil):\n${contextoLegal}\n\nPREGUNTA DEL CLIENTE: ${pregunta}` }
            ],
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
        console.error("❌ Error crítico en OpenRouter:", aiError);
        res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error de conexión con el modelo de Inteligencia Artificial." })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Motor Alucilex Blindado en puerto ${PORT}`));