// consultor.js - v33: DeepSeek + Caché + Streaming + Escudo Anti-Saludos
// Ubicación: C:\Alucilex\consultor.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
// Usamos el SDK de OpenAI para TODO (Embeddings y Chat) conectado a OpenRouter
const openai = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY, 
    baseURL: 'https://openrouter.ai/api/v1' 
});

const MODELO_CHAT = "deepseek/deepseek-chat";

const MAX_FRAGMENTO_CARACTERES = 2000;
const MAX_FRAGMENTOS_ENVIO = 15;
const cache = new Map();          
const cacheEmbeddings = new Map(); 

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const PALABRAS_PROFUNDIDAD = [
    'requisitos', 'elementos', 'características', 'caracteristicas',
    'clases', 'tipos', 'clasificación', 'clasificacion',
    'críticas', 'criticas', 'crítica', 'critica',
    'externos', 'internos', 'imperativas', 'prohibitivas', 'permisivas',
    'perfectas', 'imperfectas', 'nulidad', 'sanción', 'sancion',
    'coercibilidad', 'estatualidad', 'generalidad', 'abstracción', 'abstraccion'
];

// MEJORA 2: Diccionario rápido extraído de la lógica de Niti
const RESPUESTAS_RAPIDAS = {
    "hola": "¡Hola! Soy Alucilex, tu asistente legal. ¿En qué concepto del Código Civil te puedo ayudar hoy?",
    "gracias": "¡De nada! Estoy aquí para cualquier otra consulta jurídica que necesites.",
    "muchas gracias": "¡Un placer ayudarte! ¿Hay algo más que quieras buscar?",
    "adios": "¡Hasta luego! Que tengas una excelente jornada legal.",
    "chao": "¡Nos vemos! Vuelve cuando necesites consultar la ley."
};

function normalizarClave(texto) {
    return texto
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") 
        .replace(/[¿?¡!.,;:()\[\]{}<>"']/g, '')          
        .replace(/\s+/g, ' ')                             
        .trim();
}

function truncar(texto, max) {
    if (texto.length <= max) return texto;
    return texto.substring(0, max) + "... [truncado]";
}

async function generarEmbeddingConsulta(texto) {
    const clave = normalizarClave(texto);
    if (cacheEmbeddings.has(clave)) {
        console.log("   💾 Embedding recuperado de caché (costo cero).");
        return cacheEmbeddings.get(clave);
    }
    const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: texto.substring(0, 8000),
        dimensions: 768
    });
    const embedding = response.data[0].embedding;
    cacheEmbeddings.set(clave, embedding);
    if (cacheEmbeddings.size > 100) {
        const primerKey = cacheEmbeddings.keys().next().value;
        cacheEmbeddings.delete(primerKey);
    }
    return embedding;
}

async function busquedaSemantica(embedding, threshold, limite = 15) {
    const { data, error } = await supabase.rpc('match_fragmentos', {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limite
    });
    if (error) throw error;
    return data || [];
}

async function busquedaPorPalabrasClave(palabras, limite = 8) {
    if (!palabras || palabras.length === 0) return [];
    const condiciones = palabras.map(p => `contenido.ilike.%${p}%`).join(',');
    const { data, error } = await supabase
        .from('fragmentos_legales')
        .select('contenido, tipo, articulo_titulo_completo, autor, articulo_numero')
        .eq('tipo', 'doctrina')
        .or(condiciones)
        .limit(limite);
    if (error) throw error;
    return data || [];
}

function deduplicarResultados(resultados) {
    const vistos = new Map();
    const unicos = [];
    for (const r of resultados) {
        const clave = r.id || r.contenido.substring(0, 150);
        if (!vistos.has(clave)) {
            vistos.set(clave, true);
            unicos.push(r);
        }
    }
    return unicos;
}

async function realizarConsultaLegal(preguntaUsuario) {
    if (!preguntaUsuario || preguntaUsuario.toLowerCase() === 'salir') process.exit(0);

    const claveCache = normalizarClave(preguntaUsuario);

    // ESCUDO ANTI-SALUDOS (Intercepción temprana)
    if (RESPUESTAS_RAPIDAS[claveCache]) {
        console.log(`\n🤖 ALUCILEX: ${RESPUESTAS_RAPIDAS[claveCache]}\n`);
        preguntar();
        return;
    }

    if (cache.has(claveCache)) {
        console.log("\n💾 Respuesta desde caché (costo cero):");
        console.log("==========================================");
        console.log(cache.get(claveCache));
        console.log("==========================================\n");
        preguntar();
        return;
    }

    console.log(`\n🔍 Consulta: "${preguntaUsuario}"\n`);

    try {
        const matchArt = preguntaUsuario.match(/\b(art[íi]culo|art\.)\s*(\d{1,4})\b/i);
        let resultados = [];

        if (matchArt && matchArt[2]) {
            console.log(`📌 Detectado artículo ${matchArt[2]}, buscando directamente...`);
            const { data } = await supabase
                .from('fragmentos_legales')
                .select('contenido, tipo, articulo_titulo_completo, articulo_numero, autor')
                .eq('tipo', 'ley')
                .eq('articulo_numero', matchArt[2])
                .limit(1);
            if (data && data.length) resultados = data;
        }

        if (resultados.length === 0) {
            console.log("⏳ Generando embedding y buscando fragmentos semánticos...");
            const embedding = await generarEmbeddingConsulta(preguntaUsuario);
            let resultadosSem = await busquedaSemantica(embedding, 0.25, 15);
            if (resultadosSem.length < 4) {
                console.log("   Bajando umbral a 0.15...");
                resultadosSem = await busquedaSemantica(embedding, 0.15, 15);
            }
            resultados = resultadosSem;
        }

        if (resultados.length < 5) {
            console.log("   Complementando con palabras clave...");
            const kwResults = await busquedaPorPalabrasClave(PALABRAS_PROFUNDIDAD, 8);
            resultados.push(...kwResults);
        }

        const esConceptual = !matchArt && preguntaUsuario.length > 10;
        if (esConceptual) {
            const doctrinaActual = resultados.filter(r => r.tipo === 'doctrina');
            if (doctrinaActual.length < 3) {
                const embedding = await generarEmbeddingConsulta(preguntaUsuario);
                const doctrinaExtra = await busquedaSemantica(embedding, 0.2, 5);
                for (const d of doctrinaExtra) {
                    if (d.tipo === 'doctrina' && !resultados.some(r => r.id === d.id)) {
                        resultados.push(d);
                    }
                }
            }
        }

        resultados = deduplicarResultados(resultados);
        if (resultados.length === 0) {
            console.log("❌ No se encontró información relevante.");
            preguntar();
            return;
        }

        const consultaLower = preguntaUsuario.toLowerCase();
        const esPreguntaDeRequisitos = /requisitos|elementos|características|caracteristicas|clases|tipos|componentes|partes|condiciones|presupuestos/.test(consultaLower);
        const esPreguntaDeDefinicion = /qué es|define|concepto de|definición de|definicion de/.test(consultaLower) && !esPreguntaDeRequisitos;

        let promptBase = `Eres un asistente legal experto en derecho civil chileno. Debes responder de forma DIDÁCTICA y ESTRUCTURADA.`;

        if (esPreguntaDeRequisitos) {
            promptBase += `\n\nLa consulta pide REQUISITOS, ELEMENTOS, CARACTERÍSTICAS, CLASES o TIPOS. Para responder:
1. Busca en los fragmentos listas (números, letras, subniveles como a.1.1) y palabras clave.
2. Organiza: primero el artículo del Código Civil (si existe), luego los requisitos/elementos en lista numerada, luego explicaciones doctrinales.
3. Si hay listas incompletas, combina información de varios fragmentos.`;
        } else if (esPreguntaDeDefinicion) {
            promptBase += `\n\nLa consulta pide una definición o concepto. Organiza: 1) Cita del Código Civil, 2) Desarrollo doctrinal, 3) Ejemplos o distinciones.`;
        } else {
            promptBase += `\n\nOrganiza la respuesta de forma clara, usando conectores lógicos. Prioriza el Código Civil y complementa con doctrina.`;
        }

        promptBase += `\n\nDebes usar EXCLUSIVAMENTE la información de los fragmentos. NO inventes datos externos.
Si la información es insuficiente, responde: "No encuentro suficiente información en los fragmentos para responder completamente."

CONSULTA: ${preguntaUsuario}

FRAGMENTOS DISPONIBLES:\n`;

        let contador = 0;
        let tieneLey = false;
        let tieneDoctrina = false;
        for (const f of resultados) {
            if (contador >= MAX_FRAGMENTOS_ENVIO) break;
            const fuente = f.tipo === 'ley' 
                ? `📜 Código Civil (Art. ${f.articulo_numero || '?'}) - ${f.articulo_titulo_completo || ''}`
                : `📖 Doctrina (${f.autor || 'Orrego'}) - ${f.articulo_titulo_completo || 'Fragmento'}`;
            if (f.tipo === 'ley') tieneLey = true;
            if (f.tipo === 'doctrina') tieneDoctrina = true;
            promptBase += `\n--- ${fuente} ---\n${truncar(f.contenido, MAX_FRAGMENTO_CARACTERES)}\n`;
            contador++;
        }

        console.log(`📊 Enviando ${contador} fragmentos a la IA (Ley: ${tieneLey ? 'sí' : 'no'}, Doctrina: ${tieneDoctrina ? 'sí' : 'no'}).`);

        console.log("\n==========================================");
        console.log("📚 REDACTANDO RESPUESTA EN TIEMPO REAL:");
        console.log("==========================================");

        // MEJORA 1: Streaming activado con el SDK de OpenAI (Flujo de datos en tiempo real)
        let respuestaFinal = "";
        const stream = await openai.chat.completions.create({
            model: MODELO_CHAT,
            messages: [{ role: "user", content: promptBase }],
            temperature: 0.3,
            max_tokens: 1800,
            stream: true // El disparador de la magia
        });

        for await (const chunk of stream) {
            const contenido = chunk.choices[0]?.delta?.content || "";
            process.stdout.write(contenido); // Imprime letra por letra en la consola
            respuestaFinal += contenido;     // Acumula para guardar en caché
        }

        console.log("\n==========================================\n");

        if (cache.size > 50) cache.delete(cache.keys().next().value);
        cache.set(claveCache, respuestaFinal);

    } catch (error) {
        console.error("\n❌ Error grave:", error.message);
        console.log("⚠️ Por favor, inténtalo de nuevo más tarde.");
    }
    preguntar();
}

function preguntar() {
    rl.question('💬 ¿Qué quieres consultar? (salir para terminar): ', realizarConsultaLegal);
}

console.log("\n⚖️ ALUCILEX v33 - Streaming Constante y Escudo Inteligente");
console.log("===============================================================================");
preguntar();