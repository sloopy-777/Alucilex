// ALUCILEX - Motor de Ingestión Legal Jerárquica (con columnas separadas)
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Error Crítico: Faltan credenciales de Supabase en el archivo .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function ejecutarIngestion() {
    console.log(`\n==========================================`);
    console.log(`🚀 INICIANDO INGESTIÓN DE CÓDIGO CIVIL`);
    console.log(`==========================================`);

    try {
        // Purga solo los registros de tipo 'ley'
        console.log(`\n🧹 Purgando artículos anteriores...`);
        const { error: deleteError } = await supabase
            .from('fragmentos_legales')
            .delete()
            .eq('tipo', 'ley');
        if (deleteError) throw new Error(`Fallo en la purga: ${deleteError.message}`);
        console.log(`✅ Purga completada.`);

        // Lectura del JSON
        if (!fs.existsSync('./data/leyes.json')) {
            throw new Error("No se encuentra el archivo ./data/leyes.json. Ejecuta primero robot_bcn.js");
        }
        const rawData = fs.readFileSync('./data/leyes.json', 'utf8');
        const articulos = JSON.parse(rawData);
        console.log(`✅ Se encontraron ${articulos.length} artículos.`);

        // Mapeo a nuevas columnas
        const registros = articulos.map(art => {
            let libro = null;
            let titulo = null;
            let articulo_numero = null;
            let articulo_titulo_completo = art.titulo;

            // Extraer libro: [Libro IV] o [Libro I]
            const libroMatch = art.titulo.match(/\[Libro\s+([^\]]+)\]/i);
            if (libroMatch) libro = libroMatch[1].trim();

            // Extraer título: [Título XXIX - Del Comodato]
            const tituloMatch = art.titulo.match(/\[Título\s+([^\]]+)\]/i);
            if (tituloMatch) titulo = tituloMatch[1].trim();

            // Extraer número de artículo: Art. 2174 o Artículo 1º
            const artNumMatch = art.titulo.match(/Art\.?\s*(\d+[a-zA-Zº°]*)/i);
            if (artNumMatch) articulo_numero = artNumMatch[1].trim();

            return {
                contenido: art.contenido,
                tipo: 'ley',
                libro: libro,
                titulo: titulo,
                articulo_numero: articulo_numero,
                articulo_titulo_completo: articulo_titulo_completo,
                autor: null,
                fuente: 'BCN'
            };
        });

        // Inserción por lotes
        const TAMAÑO_LOTE = 200;
        let lotesExitosos = 0;
        for (let i = 0; i < registros.length; i += TAMAÑO_LOTE) {
            const lote = registros.slice(i, i + TAMAÑO_LOTE);
            const { error: insertError } = await supabase
                .from('fragmentos_legales')
                .insert(lote);
            if (insertError) throw new Error(`Fallo en lote: ${insertError.message}`);
            lotesExitosos++;
            console.log(`   ✅ Lote ${lotesExitosos} (${Math.min(i+TAMAÑO_LOTE, registros.length)} artículos)`);
        }

        console.log(`\n🏆 ¡INGESTIÓN COMPLETA! ${registros.length} artículos insertados.`);
    } catch (error) {
        console.error("\n❌ ERROR CRÍTICO:", error.message);
    }
}

ejecutarIngestion();