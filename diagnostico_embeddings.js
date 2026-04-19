// diagnostico_embeddings.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function diagnosticarEmbeddings() {
    console.log("\n📊 DIAGNÓSTICO DE EMBEDDINGS EN LA BASE DE DATOS\n");
    console.log("==========================================");

    // Total de fragmentos
    const { count: total, error: errTotal } = await supabase
        .from('fragmentos_legales')
        .select('*', { count: 'exact', head: true });
    if (errTotal) throw errTotal;

    // Total con embedding no nulo
    const { count: conEmbedding, error: errCon } = await supabase
        .from('fragmentos_legales')
        .select('*', { count: 'exact', head: true })
        .not('embedding', 'is', null);
    if (errCon) throw errCon;

    console.log(`📦 TOTAL DE FRAGMENTOS: ${total}`);
    console.log(`✅ CON EMBEDDING: ${conEmbedding}`);
    console.log(`❌ SIN EMBEDDING: ${total - conEmbedding}`);
    console.log(`📈 PROGRESO: ${((conEmbedding / total) * 100).toFixed(2)}%\n`);

    // Desglose por tipo (ley vs doctrina)
    const { data: tipos, error: errTipos } = await supabase
        .from('fragmentos_legales')
        .select('tipo, embedding')
        .not('tipo', 'is', null);
    if (errTipos) throw errTipos;

    const resumen = {
        ley: { total: 0, conEmbedding: 0 },
        doctrina: { total: 0, conEmbedding: 0 }
    };

    for (const row of tipos) {
        const t = row.tipo;
        if (t === 'ley') {
            resumen.ley.total++;
            if (row.embedding) resumen.ley.conEmbedding++;
        } else if (t === 'doctrina') {
            resumen.doctrina.total++;
            if (row.embedding) resumen.doctrina.conEmbedding++;
        }
    }

    console.log("📚 DESGLOSE POR TIPO:");
    console.log(`   📜 CÓDIGO CIVIL (ley): ${resumen.ley.conEmbedding} / ${resumen.ley.total} embeddings (${((resumen.ley.conEmbedding / resumen.ley.total) * 100).toFixed(2)}%)`);
    console.log(`   📖 DOCTRINA ORREGO: ${resumen.doctrina.conEmbedding} / ${resumen.doctrina.total} embeddings (${((resumen.doctrina.conEmbedding / resumen.doctrina.total) * 100).toFixed(2)}%)`);

    console.log("\n==========================================");
}

diagnosticarEmbeddings();