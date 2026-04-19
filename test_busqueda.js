// test_busqueda.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' });

async function test(consulta) {
    console.log(`\n🔍 Consulta: "${consulta}"`);
    const embeddingResp = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: consulta,
        dimensions: 768
    });
    const embedding = embeddingResp.data[0].embedding;
    
    const { data, error } = await supabase.rpc('match_fragmentos', {
        query_embedding: embedding,
        match_threshold: 0.2,
        match_count: 10
    });
    if (error) throw error;
    
    console.log(`\nResultados (umbral 0.2):`);
    if (!data || data.length === 0) {
        console.log("   No se encontraron resultados.");
    } else {
        data.forEach((f, i) => {
            console.log(`\n${i+1}. ${f.tipo} - ${f.articulo_titulo_completo || f.articulo_numero || 'sin título'}`);
            console.log(`   Similitud: ${f.similarity}`);
            console.log(`   Preview: ${f.contenido.substring(0, 120)}...`);
        });
    }
}

test("que es la tradicion");