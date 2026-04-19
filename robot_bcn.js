// ALUCILEX - Robot de Extracción BCN Definitivo (v4 - Jerárquico)
// Ubicación: C:\Alucilex\robot_bcn.js

const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs');

// ID CORRECTO del Código Civil en la BCN: 172986
const ID_NORMA = '172986'; 
const URL_BCN = `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=${ID_NORMA}`;

/**
 * Función para limpiar caracteres corruptos y basura HTML de la BCN
 */
function decodificarTexto(texto) {
    if (!texto) return "";
    let limpio = texto.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
    limpio = limpio.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
    limpio = limpio.replace(/<\/?[^>]+(>|$)/g, "");
    return limpio.replace(/\s+/g, ' ').trim();
}

async function ejecutarRobot() {
    console.log("🤖 Alucilex Robot v4: Descargando Código Civil Oficial con Jerarquía...");

    try {
        const response = await axios.get(URL_BCN);
        const parser = new xml2js.Parser();
        
        parser.parseString(response.data, (err, result) => {
            if (err) throw err;

            if (!result || !result.Norma) {
                throw new Error("El XML se descargó, pero la BCN no entregó el formato esperado (<Norma>).");
            }

            const leyesParaJson = [];
            console.log("📝 Ejecutando Radar Jerárquico: Escaneando Libros, Títulos y Artículos...");

            // El Radar Recursivo Modificado (Ahora con Memoria de Contexto)
            function extraerArticulosRecursivo(obj, contextoActual) {
                if (!obj) return;

                // 1. Heredamos la memoria de la capa superior para esta rama del árbol
                let contextoLocal = {
                    libro: contextoActual.libro,
                    tituloJerarquico: contextoActual.tituloJerarquico
                };

                // 2. Detección de Jerarquía (Libros y Títulos)
                if (obj.$) {
                    const tipoParte = obj.$.tipoParte ? obj.$.tipoParte.toLowerCase() : "";
                    const designacion = obj.$.designacion ? decodificarTexto(obj.$.designacion) : "";

                    let nombreSeccion = "";
                    // A veces el título real de la materia está en la etiqueta Texto
                    if (obj.Texto && obj.Texto[0]) {
                        const textoNodo = typeof obj.Texto[0] === 'string' ? obj.Texto[0] : (obj.Texto[0]._ || "");
                        nombreSeccion = decodificarTexto(textoNodo);
                    }

                    // Actualizamos la memoria si encontramos un Libro o un Título
                    if (tipoParte === 'libro' || tipoParte === 'titulo preliminar') {
                        contextoLocal.libro = designacion + (nombreSeccion.length < 100 && nombreSeccion ? " - " + nombreSeccion : "");
                    } else if (tipoParte === 'título' || tipoParte === 'titulo') {
                        contextoLocal.tituloJerarquico = designacion + (nombreSeccion.length < 100 && nombreSeccion ? " - " + nombreSeccion : "");
                    }
                }

                // 3. Detección de Artículos
                let esArticulo = false;
                let tituloOficial = "Sin Título";

                if (obj.$ && obj.Texto) {
                    const designacion = obj.$.designacion ? obj.$.designacion.toLowerCase() : "";
                    const tipoParte = obj.$.tipoParte ? obj.$.tipoParte.toLowerCase() : "";
                    const idParte = obj.$.idParte ? obj.$.idParte.toLowerCase() : "";

                    if (designacion.includes("art") || tipoParte.includes("art") || idParte.includes("art")) {
                        esArticulo = true;
                        tituloOficial = obj.$.designacion || obj.$.tipoParte || obj.$.idParte;
                    }
                }

                // 4. Inyección de Contexto al Artículo
                if (esArticulo && obj.Texto) {
                    let contenidoPrincipal = "";
                    if (typeof obj.Texto[0] === 'string') {
                        contenidoPrincipal = obj.Texto[0];
                    } else if (obj.Texto[0] && obj.Texto[0]._) {
                        contenidoPrincipal = obj.Texto[0]._;
                    } else {
                        contenidoPrincipal = JSON.stringify(obj.Texto[0]);
                    }
                    
                    let notasAdicionales = "";
                    if (obj.Notas && obj.Notas[0]) {
                        let textoNota = typeof obj.Notas[0] === 'string' ? obj.Notas[0] : JSON.stringify(obj.Notas[0]);
                        notasAdicionales = `\n\n[NOTA BCN]: ${textoNota}`;
                    }

                    let contenidoFinal = decodificarTexto(contenidoPrincipal + notasAdicionales);

                    if (contenidoFinal.length > 5) {
                        let tituloReal = decodificarTexto(tituloOficial);
                        
                        // Extraemos el número exacto
                        const matchNumero = contenidoFinal.match(/^(?:Art[íi]culo|Art\.)\s*\d+[a-zA-Zº°]*/i);
                        if (matchNumero) {
                            tituloReal = matchNumero[0];
                        }

                        // LA MAGIA: Construimos la genealogía completa para el metadato
                        let genealogia = "";
                        if (contextoLocal.libro) genealogia += `[${contextoLocal.libro}] `;
                        if (contextoLocal.tituloJerarquico) genealogia += `[${contextoLocal.tituloJerarquico}] `;

                        leyesParaJson.push({
                            // El título ahora será: "[Libro IV] [Título XXIX - Del Comodato] Art. 2174"
                            titulo: `${genealogia}${tituloReal}`.trim(),
                            contenido: contenidoFinal
                        });
                    }
                }

                // Recursividad: transmitiendo la memoria local a los hijos
                if (Array.isArray(obj)) {
                    for (let item of obj) {
                        extraerArticulosRecursivo(item, contextoLocal);
                    }
                } else if (typeof obj === 'object') {
                    for (let key in obj) {
                        extraerArticulosRecursivo(obj[key], contextoLocal);
                    }
                }
            }

            // Encendemos el radar desde la raíz, con la memoria en blanco inicial
            extraerArticulosRecursivo(result.Norma, { libro: "", tituloJerarquico: "" });

            if (leyesParaJson.length === 0) {
                throw new Error("No se encontró ningún artículo. La estructura de la BCN es ilegible.");
            }

            // Guardamos el JSON enriquecido
            fs.writeFileSync('./data/leyes.json', JSON.stringify(leyesParaJson, null, 2));
            console.log(`\n==========================================`);
            console.log(`🏆 ¡EXTRACCIÓN JERÁRQUICA COMPLETA!`);
            console.log(`Se extrajeron y mapearon ${leyesParaJson.length} artículos con su genealogía.`);
            console.log(`📁 Revisa el archivo data/leyes.json para confirmar los títulos.`);
            console.log(`==========================================\n`);
        });

    } catch (error) {
        console.error("❌ El Robot falló:", error.message);
    }
}

ejecutarRobot();