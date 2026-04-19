// verificar_embeddings.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verificar() {
    const { count: total, error: err1 } = await supabase
        .from('fragmentos_legales')
        .select('*', { count: 'exact', head: true });
    if (err1) throw err1;

    const { count: conEmbedding, error: err2 } = await supabase
        .from('fragmentos_legales')
        .select('*', { count: 'exact', head: true })
        .not('embedding', 'is', null);
    if (err2) throw err2;

    console.log(`Total fragmentos: ${total}`);
    console.log(`Con embedding: ${conEmbedding}`);
    console.log(`Sin embedding: ${total - conEmbedding}`);

    if (total === conEmbedding) {
        console.log('✅ Todos los fragmentos tienen embedding. El sistema está listo.');
    } else {
        console.log('⚠️ Aún faltan embeddings por generar.');
    }
}

verificar();