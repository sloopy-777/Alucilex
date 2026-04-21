// server.js - Versión final con prompt didáctico y búsqueda corregida
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
            // dimensions: 1536  // ya es el valor por defecto, opcional
        });
        const embedding = embeddingResponse.data[0].embedding;

        console.log("📚 Buscando en Supabase...");
        const { data: fragmentos, error } = await supabase.rpc('match_fragmentos', {
            query_embedding: embedding,
            match_threshold: 0.20,   // relevancia
            match_count: 10
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
        // continuamos sin contexto
    }

    // Prompt del sistema DIDÁCTICO (exige respuesta larga y estructurada)
    const systemPrompt = `Eres Alucilex, un tutor experto en derecho civil chileno. Responde de forma DIDÁCTICA, EXTENSA (mínimo 500 palabras) y ESTRUCTURADA.

REGLAS OBLIGATORIAS:
1. Si la pregunta se refiere a un concepto legal, primero cita el artículo del Código Civil (texto literal).
2. Luego desarrolla el concepto: definición, elementos, requisitos, características, clasificaciones.
3. Usa subtítulos (###), negritas, viñetas y ejemplos si los hay.
4. Si el contexto legal está disponible, úsalo prioritariamente. Si no, complementa con tu conocimiento jurídico chileno.
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
        console.log("🧠 Consultando a la IA...");
        const stream = await openai.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct:free", // o cámbialo por "deepseek/deepseek-chat" si quieres pago
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
        res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error de conexión con la IA." })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Servidor ALUCILEX en puerto ${PORT}`));