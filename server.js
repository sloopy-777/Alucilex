// server.js - Motor Alucilex DEFINITIVO (Cero Alucinaciones / Cero Negativas)
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

async function generarEmbedding(texto) {
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texto.substring(0, 8000)
    });
    return response.data[0].embedding;
}

app.post('/api/consultar', async (req, res) => {
    const { pregunta } = req.body;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const embedding = await generarEmbedding(pregunta);

        // Búsqueda extra-amplia. Si falla o trae basura, la IA lo ignorará.
        const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
            query_embedding: embedding,
            match_threshold: 0.01, 
            match_count: 10
        });

        if (error) {
            console.error("Error en Supabase:", error);
            // No detenemos el servidor si la base de datos falla, dejamos que la IA responda
        }

        let contextoLegal = fragmentos && fragmentos.length > 0 
            ? fragmentos.map(f => `[DOCUMENTO]: ${f.contenido}`).join('\n\n')
            : "";

        const stream = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",
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

    } catch (error) {
        console.error("Error crítico en el servidor:", error);
        res.write(`data: ${JSON.stringify({ content: "❌ Error de procesamiento. Por favor, intenta de nuevo." })}\n\n`);
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Motor Alucilex Definitivo en puerto ${PORT}`));