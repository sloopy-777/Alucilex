// server.js - Búsqueda Jerárquica: Primero Ley, luego Apuntes, luego IA
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

    let contextoLey = "";
    let contextoApuntes = "";
    let articuloExactoEncontrado = false;

    // 1. BUSCAR NÚMERO DE ARTÍCULO EXACTO (Del 1 al 2524)
    // CORRECCIÓN BUGS: Nueva expresión regular infalible que atrapa "art1455", "art 1455" o "1455"
    const matchNumero = pregunta.match(/(?:art(?:[íi]culo|\.?)?\s*)?(\d{1,4})/i);
    if (matchNumero && matchNumero[1]) {
        const numeroArt = matchNumero[1];
        if (parseInt(numeroArt) >= 1 && parseInt(numeroArt) <= 2524) {
            console.log(`📌 Búsqueda de artículo exacto: ${numeroArt}`);
            const { data, error } = await supabase
                .from('fragmentos_legales')
                .select('contenido, articulo_numero, libro, titulo')
                .eq('tipo', 'ley')
                .eq('numero_limpio', numeroArt)
                .order('libro', { ascending: true, nullsLast: true })
                .limit(1);
            
            if (!error && data && data.length > 0) {
                contextoLey += `[CÓDIGO CIVIL - Art. ${data[0].articulo_numero}]\n${data[0].contenido}\n\n`;
                articuloExactoEncontrado = true;
                console.log(`✅ Artículo ${numeroArt} encontrado en la base.`);
            }
        }
    }

    try {
        // 2. GENERAR EMBEDDING DE LA PREGUNTA
        let embedding;
        if (cacheEmbeddings.has(hashPregunta)) {
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

        // 3. BUSCAR SEMÁNTICAMENTE EN LA LEY (Si no se encontró número exacto)
        if (!articuloExactoEncontrado) {
            console.log("📚 Buscando coincidencias en CÓDIGO CIVIL...");
            const { data: leyes, error: errLey } = await supabase.rpc('buscar_fragmentos', {
                query_embedding: embedding,
                filtro_tipo: 'ley',
                match_threshold: 0.15,
                match_count: 5
            });
            if (!errLey && leyes && leyes.length > 0) {
                contextoLey += leyes.map(f => `[CÓDIGO CIVIL - Art. ${f.articulo_numero || 'S/N'}]\n${f.contenido}`).join('\n\n');
                console.log(`✅ ${leyes.length} fragmentos de ley recuperados.`);
            }
        }

        // 4. BUSCAR SEMÁNTICAMENTE EN LOS APUNTES PERSONALES
        console.log("📚 Buscando coincidencias en APUNTES PERSONALES...");
        const { data: apuntes, error: errApuntes } = await supabase.rpc('buscar_fragmentos', {
            query_embedding: embedding,
            filtro_tipo: 'apunte_personal',
            match_threshold: 0.15,
            match_count: 10
        });
        if (!errApuntes && apuntes && apuntes.length > 0) {
            contextoApuntes += apuntes.map(f => `[APUNTE PERSONAL - ${f.articulo_titulo_completo}]\n${f.contenido}`).join('\n\n');
            console.log(`✅ ${apuntes.length} fragmentos de apuntes recuperados.`);
        }

    } catch (error) {
        console.log("⚠️ Error en búsqueda semántica:", error.message);
    }

    // 5. UNIFICAR CONTEXTOS SEPARANDO LEY DE DOCTRINA
    const contextoTotal = `--- LEY OFICIAL ---\n${contextoLey || 'No se encontraron artículos.'}\n\n--- APUNTES Y DOCTRINA ---\n${contextoApuntes || 'No se encontraron apuntes.'}`;

    // ========== 6. PROMPT DEL SISTEMA (RAG ESTRICTO ANTI-ALUCINACIÓN) ==========
    const systemPrompt = 
        "Eres Alucilex, un asistente legal experto en derecho civil chileno. Eres un sistema RAG estricto. Debes seguir estas reglas de ORO al pie de la letra:\n\n" +
        "1. Tienes dos fuentes de información en el contexto: 'LEY OFICIAL' y 'APUNTES Y DOCTRINA'.\n" +
        "2. CITA TEXTUAL OBLIGATORIA: Para el estudio del alumno es INDISPENSABLE no abrir el libro físico. Si en el contexto existe un artículo de la LEY OFICIAL relacionado a la pregunta, DEBES copiar su texto de forma EXACTA e ÍNTEGRA bajo el título '### TEXTO DEL ARTÍCULO'.\n" +
        "3. LIMITACIÓN DE CONOCIMIENTO: Si tu conocimiento interno te sugiere un artículo que NO ESTÁ físicamente en el contexto provisto, NO redactes su texto de memoria. Limítate a la información del contexto o indica explícitamente que no tienes el texto literal a la vista.\n" +
        "4. FORMATO DE TABLAS ESTRICTO: Cuando uses tablas, es OBLIGATORIO usar sintaxis perfecta de Markdown con barras y guiones para evitar que el texto se desordene. Ejemplo exacto:\n| Columna 1 | Columna 2 |\n|---|---|\n| Dato 1 | Dato 2 |\n" +
        "5. Tu respuesta debe tener obligatoriamente la siguiente estructura EXACTA (SIN agregar paréntesis, ni frases extra a los títulos):\n" +
        "   - ### CONCEPTO LEGAL O DOCTRINARIO\n" +
        "   - ### TEXTO DEL ARTÍCULO\n" +
        "   - ### ELEMENTOS O REQUISITOS (lista en viñetas)\n" +
        "   - ### CARACTERÍSTICAS (lista en viñetas)\n" +
        "   - ### CLASIFICACIONES (usa tabla Markdown estricta si aplica)\n" +
        "   - ### EJEMPLOS (al menos dos ejemplos concretos)\n" +
        "   - ### CONCLUSIÓN\n\n" +
        "6. Responde siempre en español y usa formato Markdown extenso.";

    let mensajes = [{ role: "system", content: systemPrompt }];
    for (let msg of historial) mensajes.push(msg);
    mensajes.push({
        role: "user",
        content: "CONTEXTO RECUPERADO DE LA BASE DE DATOS:\n\n" + contextoTotal + "\n\nPREGUNTA DEL USUARIO: " + pregunta
    });

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });

    const MAX_REINTENTOS = 3;
    let intento = 0;
    let respuestaCompleta = "";
    let streamError = null;

    while (intento < MAX_REINTENTOS) {
        try {
            console.log(`🧠 Consultando a la IA (intento ${intento + 1}/${MAX_REINTENTOS})...`);
            const stream = await openai.chat.completions.create({
                model: "deepseek/deepseek-chat",
                messages: mensajes,
                temperature: 0.0,
                max_tokens: 3000,
                stream: true,
            });

            respuestaCompleta = "";
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
            return;

        } catch (err) {
            streamError = err;
            console.error(`❌ Error en IA (intento ${intento + 1}):`, err.message);
            intento++;
            if (intento < MAX_REINTENTOS) {
                console.log(`⏳ Reintentando en 2 segundos...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    console.error("❌ Todos los reintentos fallaron:", streamError);
    res.write(`data: ${JSON.stringify({ content: "\n\n❌ Error temporal de conexión con la IA. Intenta de nuevo más tarde." })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
});

app.get('/ping', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => {
    res.send('API de Alucilex funcionando. Usa /api/consultar para consultas.');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor ALUCILEX (búsqueda jerárquica) en puerto ${PORT}`));