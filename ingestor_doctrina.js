// ALUCILEX - Ingestión de Doctrina con columnas separadas
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Error Crítico: Faltan credenciales de Supabase");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const ARCHIVO_ORIGEN = path.join(__dirname, 'data', 'apuntes_procesados.json');

async function subirBaseDeDatos() {
    console.log("🚀 Iniciando ingesta de doctrina...");

    if (!fs.existsSync(ARCHIVO_ORIGEN)) {
        console.error("❌ No se encuentra apuntes_procesados.json. Ejecuta procesador_pdf.js");
        return;
    }

    const rawData = fs.readFileSync(ARCHIVO_ORIGEN, 'utf8');
    const fragmentos = JSON.parse(rawData);
    console.log(`📦 ${fragmentos.length} fragmentos encontrados.`);

    // Eliminar doctrina anterior (opcional, comenta si quieres conservar)
    const { error: deleteError } = await supabase
        .from('fragmentos_legales')
        .delete()
        .eq('tipo', 'doctrina');
    if (deleteError) console.warn("⚠️ No se pudo purgar doctrina anterior:", deleteError.message);
    else console.log("🧹 Doctrina anterior eliminada.");

    const registros = fragmentos.map(frag => ({
        contenido: frag.contenido,
        tipo: 'doctrina',
        libro: null,
        titulo: null,
        articulo_numero: null,
        articulo_titulo_completo: frag.titulo,
        autor: frag.autor || 'Juan Andrés Orrego',
        fuente: 'apuntes_pdf'
    }));

    const TAMAÑO_LOTE = 200;
    let lotesExitosos = 0;
    for (let i = 0; i < registros.length; i += TAMAÑO_LOTE) {
        const lote = registros.slice(i, i + TAMAÑO_LOTE);
        const { error } = await supabase.from('fragmentos_legales').insert(lote);
        if (error) console.error(`❌ Error en lote ${lotesExitosos+1}:`, error.message);
        else lotesExitosos++;
        await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\n🏆 ¡INGESTIÓN COMPLETA! ${registros.length} fragmentos doctrinales insertados.`);
}

subirBaseDeDatos();cls