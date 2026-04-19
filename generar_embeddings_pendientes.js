// generar_embeddings_pendientes.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY, 
    baseURL: 'https://openrouter.ai/api/v1' 
});

const PROGRESO_FILE = './embedding_progreso.json';

// Cargar IDs ya procesados
let procesados = new Set();
if (fs.existsSync(PROGRESO_FILE)) {
    const data = JSON.parse(fs.readFileSync(PROGRESO_FILE, 'utf8'));
    procesados = new Set(data.procesados || []);
    console.log(`📂 Progreso cargado: ${procesados.size} embeddings ya generados.`);
}

async function generarPendientes() {
    console.log("\n🧠 Buscando fragmentos sin embedding...\n");

    let offset = 0;
    const LIMITE = 50;  // Procesar de a 50 por ciclo para no saturar
    let totalGenerados = 0;

    while (true) {
        // Obtener fragmentos sin embedding, excluyendo los ya procesados
        let query = supabase
            .from('fragmentos_legales')
            .select('id, contenido')
            .is('embedding', null);

        if (procesados.size > 0) {
            query = query.not('id', 'in', `(${Array.from(procesados).join(',')})`);
        }

        const { data: fragmentos, error } = await query.range(offset, offset + LIMITE - 1);

        if (error) throw error;
        if (!fragmentos || fragmentos.length === 0) break;

        console.log(`📦 Procesando lote de ${fragmentos.length} fragmentos (${totalGenerados} generados hasta ahora)...`);

        for (const frag of fragmentos) {
            try {
                const response = await openai.embeddings.create({
                    model: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
                    input: frag.contenido.substring(0, 8000),
                    dimensions: 768
                });
                await supabase
                    .from('fragmentos_legales')
                    .update({ embedding: response.data[0].embedding })
                    .eq('id', frag.id);

                procesados.add(frag.id);
                totalGenerados++;
                fs.writeFileSync(PROGRESO_FILE, JSON.stringify({ procesados: Array.from(procesados) }, null, 2));
                console.log(`✅ ID ${frag.id} (total acumulado: ${totalGenerados})`);
            } catch (err) {
                console.error(`❌ Error ID ${frag.id}:`, err.message);
                // Guardar progreso y salir para poder reanudar después
                return;
            }
            await new Promise(r => setTimeout(r, 300));
        }
        offset += LIMITE;
    }

    console.log("\n🎉 ¡PROCESO COMPLETADO! Todos los fragmentos tienen embedding.");
}

generarPendientes();