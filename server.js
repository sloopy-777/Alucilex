// server.js - Motor Alucilex DEFINITIVO con prompt didáctico y derecho chileno exclusivo
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
    if (!pregunta) {
        return res.status(400).json({ error: "La pregunta está vacía" });
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    let contextoLegal = "";

    // Búsqueda vectorial
    try {
        console.log("🔍 Generando Embedding para:", pregunta);
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: pregunta.substring(0, 8000),
            dimensions: 768
        });
        const embedding = embeddingResponse.data[0].embedding;

        console.log("📚 Buscando en Supabase...");
        const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
            query_embedding: embedding,
            match_threshold: 0.20,
            match_count: 12
        });

        if (error) throw error;

        if (fragmentos && fragmentos.length > 0) {
            contextoLegal = fragmentos.map(f => {
                const tipo = f.tipo === 'ley' ? 'CODIGO CIVIL' : 'DOCTRINA (Orrego)';
                const titulo = f.articulo_titulo_completo || f.articulo_numero || 'Fragmento';
                return `[${tipo} - ${titulo}]\n${f.contenido}`;
            }).join('\n\n');
            console.log("✅ Contexto legal recuperado (" + fragmentos.length + " fragmentos).");
        } else {
            console.log("⚠️ No se encontraron fragmentos relevantes.");
        }
    } catch (dbError) {
        console.log("⚠️ Advertencia: Búsqueda fallida. Motivo:", dbError.message);
        // No fallamos, seguimos sin contexto.
    }

    // Prompt del sistema DIDÁCTICO y con restricción a derecho chileno
    const systemPrompt = `Eres Alucilex, un tutor experto en derecho civil chileno. Tu misión es enseñar de forma clara, profunda y estructurada, usando exclusivamente el Código Civil chileno y la doctrina de Juan Andrés Orrego.

REGLAS ESTRICTAS:
1. RESPUESTA EXTENSA: Desarrolla el tema con al menos 500 palabras (a menos que la pregunta sea muy concreta tipo "¿qué dice el artículo X?").
2. ESTRUCTURA DIDÁCTICA OBLIGATORIA:
   - Si la pregunta se refiere a un concepto legal, comienza citando el artículo del Código Civil correspondiente (transcripción literal).
   - Luego explica el concepto (definición, elementos, naturaleza jurídica).
   - A continuación, desarrolla los requisitos, características, clasificaciones o efectos según corresponda.
   - Usa viñetas, negritas y subtítulos (Markdown) para facilitar la lectura.
   - Incluye ejemplos si los fragmentos los contienen.
3. EXCLUSIVIDAD CHILENA: Responde ÚNICAMENTE con base en derecho chileno. Si el usuario pide comparar con otro ordenamiento (ej. "¿y en Argentina?"), responde: "Lo que me preguntas corresponde a derecho extranjero. ¿Quieres que te explique solo el derecho chileno?" A menos que el usuario diga explícitamente "sal de Chile" o "compáralo con derecho argentino", no salgas del marco chileno.
4. USO DEL CONTEXTO: El CONTEXTO RECUPERADO contiene fragmentos reales de la ley y doctrina. Úsalo prioritariamente. Si el contexto es insuficiente, complementa con tu conocimiento jurídico chileno (pero nunca inventes artículos). Si no encuentras el artículo exacto, indícalo.
5. PROHIBIDO RESPONDER DE FORMA ESCUETA: Las respuestas de una sola línea están prohibidas. Explicate como un profesor.

FORMATO DE RESPUESTA (ejemplo):
### 📜 Código Civil - Artículo [Número]
> Texto literal del artículo

### 📖 Explicación doctrinal
[Definición, elementos, naturaleza]

### ⚙️ Requisitos / Características
- Requisito 1...
- Requisito 2...

### 🧠 Ejemplos (si existen)
...`;

    try {
        console.log("🧠 Consultando a DeepSeek (o modelo configurado)...");
        const stream = await openai.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct:free", // o "deepseek/deepseek-chat" si prefieres pago
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `CONTEXTO LEGAL (priorízalo):\n${contextoLegal || "No se encontraron fragmentos específicos. Usa tu conocimiento jurídico chileno, pero sin inventar artículos."}\n\nPREGUNTA DEL USUARIO: ${pregunta}` }
            ],
            temperature: 0.4,
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
        console.error("❌ Error crítico en OpenRouter:", aiError);
        res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error de conexión con el modelo de IA. Por favor, intenta más tarde." })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Motor Alucilex Blindado en puerto ${PORT}`));