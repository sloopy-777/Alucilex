// Evaluación rápida de precisión de recuperación (Recall@K)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1'
});

const CASOS = [
    { q: 'tradición en derecho civil', expected: '670' },
    { q: 'qué es la posesión', expected: '700' },
    { q: 'vicios redhibitorios', expected: '1857' },
    { q: 'responsabilidad extracontractual', expected: '2314' },
    { q: 'compraventa definición', expected: '1793' },
    { q: 'nulidad absoluta', expected: '1681' },
    { q: 'hipoteca', expected: '2407' },
    { q: 'prescripcion', expected: '2492' }
];

async function embedding(texto) {
    const res = await openai.embeddings.create({
        model: 'openai/text-embedding-3-small',
        input: texto.substring(0, 8000),
        dimensions: 768
    });
    return res.data[0].embedding;
}

async function recuperarLey(queryEmbedding, k = 5) {
    const { data, error } = await supabase.rpc('buscar_fragmentos', {
        query_embedding: queryEmbedding,
        filtro_tipo: 'ley',
        match_threshold: 0.2,
        match_count: k
    });
    if (error) throw error;
    return data || [];
}

async function main() {
    console.log('\n📊 Evaluación de recuperación legal (Recall@5)\n');
    let hits = 0;

    for (const c of CASOS) {
        const emb = await embedding(c.q);
        const encontrados = await recuperarLey(emb, 5);
        const topArticulos = encontrados.map(x => String(x.articulo_numero || ''));
        const ok = topArticulos.some(a => a.startsWith(c.expected));

        if (ok) hits++;
        console.log(`${ok ? '✅' : '❌'} "${c.q}" -> esperado Art. ${c.expected} | top5: ${topArticulos.join(', ')}`);
    }

    const recall = (hits / CASOS.length) * 100;
    console.log(`\n🏁 Recall@5: ${hits}/${CASOS.length} (${recall.toFixed(2)}%)`);
}

main().catch(err => {
    console.error('❌ Error en evaluación:', err.message);
    process.exit(1);
});

