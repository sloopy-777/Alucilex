// server.js - Motor Alucilex V4 (Jerarquía Legal Absoluta)
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

        // Aumentamos la profundidad de búsqueda para cubrir el Código Civil y Orrego
        const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
            query_embedding: embedding,
            match_threshold: 0.01, 
            match_count: 25 
        });

        if (error) throw error;

        let contextoLegal = fragmentos && fragmentos.length > 0 
            ? fragmentos.map(f => `[TIPO_DOC: ${f.tipo.toUpperCase()}]\n${f.contenido}`).join('\n\n')
            : "No se halló información específica en la base de datos local.";

        const stream = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: `Eres Alucilex, la autoridad máxima en el CÓDIGO CIVIL DE CHILE y la doctrina de JUAN ANDRÉS ORREGO ACUÑA.
                    
                    REGLAS UNIVERSALES DE RAZONAMIENTO:
                    1. PRIORIDAD CIVIL: Tu fuente principal es el CÓDIGO CIVIL (promulgado en 1855). Es el pilar del derecho privado en Chile.
                    2. ANTI-ALUCINACIÓN: Si el contexto recuperado menciona decretos de 1931 o leyes laborales que dicen "derogar" artículos, ignora esa información SI LA PREGUNTA ES CIVIL. El Código Civil no se deroga por decretos laborales de 1931.
                    3. INTEGRIDAD DE LA FUENTE: Siempre que se te pida un artículo del Código Civil, búscalo en el contexto. Si no está, utiliza tu base de datos interna para citarlo EXACTAMENTE como rige en Chile, aclarando que es la normativa vigente.
                    4. DOCTRINA: Usa los fragmentos marcados como [TIPO_DOC: ORREGO] para profundizar en la explicación técnica de los artículos.
                    
                    ESTRUCTURA DE RESPUESTA:
                    - Cita textual del artículo (si aplica).
                    - Análisis jurídico basado en el contexto.
                    - Conclusión práctica.` 
                },
                { role: "user", content: `CONTEXTO RECUPERADO:\n${contextoLegal}\n\nPREGUNTA JURÍDICA: ${pregunta}` }
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
        console.error("Error:", error);
        res.write(`data: ${JSON.stringify({ content: "❌ Error: El sistema legal no respondió." })}\n\n`);
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Motor Alucilex V4 (Chile Civil Expert) en puerto ${PORT}`));