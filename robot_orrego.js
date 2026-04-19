// ALUCILEX - Robot Recolector de Apuntes (Juan Andrés Orrego)
// Ubicación: C:\Alucilex\robot_orrego.js

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');

// URL pública de donde extraeremos la doctrina
const URL_ORREGO = 'https://www.juanandresorrego.cl/apuntes_all.html';
const BASE_URL = 'https://www.juanandresorrego.cl/';
const CARPETA_DESTINO = path.join(__dirname, 'data', 'apuntes_pdf');

async function ejecutarDescarga() {
    console.log("🤖 Iniciando Robot Orrego: Escaneando la web en busca de doctrina...");

    try {
        // Crear carpeta si no existe
        if (!fs.existsSync(CARPETA_DESTINO)) {
            fs.mkdirSync(CARPETA_DESTINO, { recursive: true });
            console.log("📁 Carpeta 'data/apuntes_pdf' creada para recibir los archivos.");
        }

        const { data: html } = await axios.get(URL_ORREGO);
        const $ = cheerio.load(html);
        const enlacesPdf = [];

        // Buscamos todos los enlaces .pdf en la página
        $('a').each((i, el) => {
            let href = $(el).attr('href');
            if (href && href.toLowerCase().includes('.pdf')) {
                if (!href.startsWith('http')) {
                    href = href.startsWith('/') ? BASE_URL + href.substring(1) : BASE_URL + href;
                }
                const nombre = path.basename(decodeURIComponent(href));
                if (!enlacesPdf.find(e => e.url === href)) {
                    enlacesPdf.push({ url: href, nombre });
                }
            }
        });

        console.log(`\n📚 Se detectaron ${enlacesPdf.length} documentos. Iniciando descarga...`);

        for (let i = 0; i < enlacesPdf.length; i++) {
            const pdf = enlacesPdf[i];
            const ruta = path.join(CARPETA_DESTINO, pdf.nombre);

            if (fs.existsSync(ruta)) {
                console.log(`⏩ [${i+1}/${enlacesPdf.length}] Ya descargado: ${pdf.nombre}`);
                continue;
            }

            console.log(`⬇️ [${i+1}/${enlacesPdf.length}] Bajando: ${pdf.nombre}`);
            
            try {
                const agent = new https.Agent({ rejectUnauthorized: false });
                const res = await axios({ method: 'GET', url: pdf.url, responseType: 'stream', httpsAgent: agent });
                const writer = fs.createWriteStream(ruta);
                res.data.pipe(writer);
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
            } catch (e) {
                console.error(`❌ Error en ${pdf.nombre}:`, e.message);
            }
        }

        console.log("\n🏆 ¡Misión cumplida! Los archivos están en tu carpeta local.");

    } catch (error) {
        console.error("❌ El robot falló al conectar:", error.message);
    }
}

ejecutarDescarga();