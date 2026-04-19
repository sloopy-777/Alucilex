// ALUCILEX - Procesador y Fragmentador de PDFs (Motor Nativo pdfreader)
// Ubicación: C:\Alucilex\procesador_pdf.js

const fs = require('fs');
const path = require('path');
const { PdfReader } = require('pdfreader');

const CARPETA_ORIGEN = path.join(__dirname, 'data', 'apuntes_pdf');
const ARCHIVO_DESTINO = path.join(__dirname, 'data', 'apuntes_procesados.json');

function limpiarTexto(texto) {
    if (!texto) return "";
    return texto.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function fragmentarTexto(texto, maxCaracteres = 1500) {
    const fragmentos = [];
    const oraciones = texto.match(/[^.!?]+[.!?]+/g) || [texto];
    let bloqueActual = "";

    for (let oracion of oraciones) {
        if ((bloqueActual.length + oracion.length) > maxCaracteres) {
            if (bloqueActual.trim().length > 10) fragmentos.push(bloqueActual.trim());
            bloqueActual = oracion;
        } else {
            bloqueActual += " " + oracion;
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
            const textoCrudo = await extraerTextoPdfReader(rutaCompleta);
            const textoLimpio = limpiarTexto(textoCrudo);
            
            // Escudo: Si el PDF son puras imágenes escaneadas, lo saltamos
            if (!textoLimpio || textoLimpio.length < 50) {
                console.log(`   ⚠️ Advertencia: ${nombreArchivo} parece estar vacío o es un escáner de imágenes protegido.`);
                continue; 
            }

            const fragmentosArchivo = fragmentarTexto(textoLimpio);

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