const fs = require('fs');
const path = require('path');

const directorio = './';
const archivoSalida = 'sistema_completo.txt';
let contenidoTotal = '--- AUDITORÍA DE SISTEMA ALUCILEX ---\n\n';

fs.readdirSync(directorio).forEach(archivo => {
    // Solo leemos archivos .js y evitamos el empaquetador mismo
    if (archivo.endsWith('.js') && archivo !== 'empaquetar.js') {
        contenidoTotal += `\n// ==========================================\n`;
        contenidoTotal += `// 📁 ARCHIVO: ${archivo}\n`;
        contenidoTotal += `// ==========================================\n\n`;
        contenidoTotal += fs.readFileSync(path.join(directorio, archivo), 'utf-8');
        contenidoTotal += `\n\n`;
    }
});

fs.writeFileSync(archivoSalida, contenidoTotal);
console.log(`✅ Sistema empaquetado con éxito en: ${archivoSalida}`);