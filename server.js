// server.js - ALUCILEX definitivo (dimensiones 768, DeepSeek pago)
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

    try {
        console.log("🔍 Generando embedding para:", pregunta);
        const embeddingResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: pregunta.substring(0, 8000),
            dimensions: 768   // <-- CLAVE: forzar 768 para coincidir con tus datos
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
            console.log(`✅ Contexto legal recuperado (${fragmentos.length} fragmentos).`);
        } else {
            console.log("⚠️ No se encontraron fragmentos relevantes.");
        }
    } catch (dbError) {
        console.log("⚠️ Búsqueda fallida. Motivo:", dbError.message);
    }

    const systemPrompt = `Eres Alucilex, un tutor experto en derecho civil chileno. Responde de forma EXTENSA (mínimo 500 palabras), ESTRUCTURADA y DIDÁCTICA.

REGLAS:
1. Si la pregunta se refiere a un concepto legal, cita el artículo del Código Civil chileno (texto literal).
2. Luego desarrolla: definición, elementos, requisitos, características, clasificaciones.
3. Usa subtítulos (###), negritas, viñetas y ejemplos.
4. Prioriza el contexto legal proporcionado. Si es insuficiente, complementa con tu conocimiento jurídico chileno (pero no inventes artículos).
5. PROHIBIDO responder de forma escueta. Explicate como un profesor universitario.

FORMATO OBLIGATORIO:
### 📜 Código Civil - Artículo [número]
> texto literal

### 📖 Definición y concepto
...

### ⚙️ Elementos o requisitos
...

### 🧩 Características
...

### 📚 Clasificaciones (si aplica)
...

### 💡 Ejemplo (si existe)
...`;

    try {
        console.log("🧠 Consultando a DeepSeek (pago)...");
        const stream = await openai.chat.completions.create({
            model: "deepseek/deepseek-chat",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `CONTEXTO LEGAL (prioriza esto):\n${contextoLegal || "No hay contexto específico. Usa tu conocimiento jurídico chileno."}\n\nPREGUNTA: ${pregunta}` }
            ],
            temperature: 0.5,
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
        res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error de conexión con la IA. Por favor, intenta más tarde." })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Servidor ALUCILEX (768) en puerto ${PORT}`));