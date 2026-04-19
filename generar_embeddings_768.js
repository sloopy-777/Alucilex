// cls - Genera embeddings para fragmentos sin uno
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY, 
    baseURL: 'https://openrouter.ai/api/v1' 
});

async function generarEmbeddings() {
    console.log("🧠 Generando embeddings (dimensión 768) para fragmentos sin embedding...\n");

    let procesados = 0;
    let total = 0;

    while (true) {
        const { data: fragmentos, error } = await supabase
            .from('fragmentos_legales')
            .select('id, contenido')
            .is('embedding', null)
            .limit(50); // Lotes pequeños para evitar timeout

        if (error) throw error;
        if (!fragmentos.length) break;

        total += fragmentos.length;
        console.log(`📦 Procesando lote de ${fragmentos.length} fragmentos (total pendiente: ~${total})...`);

        for (const frag of fragmentos) {
            try {
                // Recortar contenido si es muy largo (máximo 8000 caracteres para el embedding)
                const texto = frag.contenido.substring(0, 8000);
                const response = await openai.embeddings.create({
                    model: 'text-embedding-3-small',
                    input: texto,
                    dimensions: 768
                });
                const embedding = response.data[0].embedding;

                await supabase
                    .from('fragmentos_legales')
                    .update({ embedding })
                    .eq('id', frag.id);

                procesados++;
                console.log(`   ✅ Embedding para ID ${frag.id} (${procesados} procesados)`);
            } catch (err) {
                console.error(`   ❌ Error en fragmento ${frag.id}:`, err.message);
            }
            // Pequeña pausa para no saturar la API
            await new Promise(r => setTimeout(r, 200));
        }
        console.log(`--- Lote completado. Total embeddings generados hasta ahora: ${procesados} ---\n`);
    }

    console.log(`\n🎉 PROCESO COMPLETADO. Se generaron ${procesados} embeddings.`);
}

generarEmbeddings();