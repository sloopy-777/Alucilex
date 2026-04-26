// ALUCILEX - Procesador y Fragmentador de PDFs (Motor Nativo pdfreader)
// Ubicación: C:\Alucilex\procesador_pdf.js

const fs = require('fs');
const path = require('path');
const { PdfReader } = require('pdfreader');
const pdf = require('pdf-parse');

const CARPETA_ORIGEN = path.join(__dirname, 'data', 'apuntes_pdf');
const ARCHIVO_DESTINO = path.join(__dirname, 'data', 'apuntes_procesados.json');

function limpiarTexto(texto) {
    if (!texto) return "";
    return texto.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function fragmentarTextoConSolape(texto, maxCaracteres = 1100, solape = 180) {
    const fragmentos = [];
    const parrafos = texto
        .split(/\n{2,}/)
        .map(p => limpiarTexto(p))
        .filter(Boolean);

    const unidades = (parrafos.length ? parrafos.join('\n\n') : texto)
        .split(/(?<=[.!?])\s+/)
        .map(u => u.trim())
        .filter(Boolean);

    if (!unidades.length) return fragmentos;

    let bloqueActual = "";

    for (const unidad of unidades) {
        if ((bloqueActual.length + unidad.length + 1) > maxCaracteres) {
            if (bloqueActual.trim().length > 10) fragmentos.push(bloqueActual.trim());

            const cola = bloqueActual.slice(Math.max(0, bloqueActual.length - solape)).trim();
            bloqueActual = `${cola} ${unidad}`.trim();
        } else {
            bloqueActual = `${bloqueActual} ${unidad}`.trim();
        }
    }
    if (bloqueActual.trim().length > 10) fragmentos.push(bloqueActual.trim());

    return fragmentos;
}

// Función Promisificada para leer el PDF con el motor puro de Node
function extraerTextoPdfReader(rutaArchivo) {
    return new Promise((resolve, reject) => {
        let textoCompleto = "";
        new PdfReader().parseFileItems(rutaArchivo, (err, item) => {
            if (err) {
                reject(err);
            } else if (!item) {
                // Si el item es null, significa que llegamos al final del archivo
                resolve(textoCompleto);
            } else if (item.text) {
                // Acumulamos el texto que va encontrando
                textoCompleto += item.text + " ";
            }
        });
    });
}

async function extraerTextoPdfParse(rutaArchivo) {
    const buffer = fs.readFileSync(rutaArchivo);
    const data = await pdf(buffer);
    return data?.text || "";
}

async function extraerTextoSeguro(rutaArchivo) {
    try {
        const texto = await extraerTextoPdfParse(rutaArchivo);
        if (texto && texto.trim().length > 100) return texto;
    } catch (_) {
        // Fallback silencioso al parser secundario
    }
    return extraerTextoPdfReader(rutaArchivo);
}

async function procesarDocumentos() {
    console.log("⚙️ Iniciando el Destilador Doctrinario (Motor Nativo Node.js)...");

    if (!fs.existsSync(CARPETA_ORIGEN)) {
        console.error("❌ Error: No existe la carpeta 'data/apuntes_pdf'.");
        return;
    }

    const archivos = fs.readdirSync(CARPETA_ORIGEN).filter(file => file.endsWith('.pdf'));
    
    if (archivos.length === 0) {
        console.log("⚠️ No se encontraron PDFs en la carpeta para procesar.");
        return;
    }

    const todosLosFragmentos = [];

    // Procesamos secuencialmente para no saturar la RAM
    for (let i = 0; i < archivos.length; i++) {
        const nombreArchivo = archivos[i];
        const rutaCompleta = path.join(CARPETA_ORIGEN, nombreArchivo);
        
        console.log(`📄 [${i + 1}/${archivos.length}] Escaneando: ${nombreArchivo}...`);

        try {
            const textoCrudo = await extraerTextoSeguro(rutaCompleta);
            const textoLimpio = limpiarTexto(textoCrudo);
            
            // Escudo: Si el PDF son puras imágenes escaneadas, lo saltamos
            if (!textoLimpio || textoLimpio.length < 50) {
                console.log(`   ⚠️ Advertencia: ${nombreArchivo} parece estar vacío o es un escáner de imágenes protegido.`);
                continue; 
            }

            const fragmentosArchivo = fragmentarTextoConSolape(textoCrudo);

            fragmentosArchivo.forEach((frag, index) => {
                todosLosFragmentos.push({
                    titulo: `Apunte: ${nombreArchivo.replace('.pdf', '')} - Parte ${index + 1}`,
                    contenido: frag,
                    autor: "Juan Andrés Orrego"
                });
            });

        } catch (error) {
            console.error(`   ❌ Error al leer ${nombreArchivo}:`, error.message);
        }
    }

    fs.writeFileSync(ARCHIVO_DESTINO, JSON.stringify(todosLosFragmentos, null, 2));
    console.log(`\n==========================================`);
    console.log(`🏆 ¡DESTILACIÓN COMPLETA!`);
    console.log(`Se generaron ${todosLosFragmentos.length} fragmentos inteligentes de doctrina.`);
    console.log(`==========================================\n`);
}

procesarDocumentos();
