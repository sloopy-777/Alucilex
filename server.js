require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY, 
    baseURL: 'https://openrouter.ai/api/v1' 
});

const cacheRespuestas = new Map();
const cacheEmbeddings = new Map();
const conversaciones = new Map();
const TTL_RESPUESTA = 3600000;
const MAX_HISTORIAL = 10;

// ========== DICCIONARIO DE ORO (ESTRATEGIA 1) ==========
const diccionarioOro = {
    "ley": 1,
    "costumbre": 2,
    // ... (TU DICCIONARIO ORIGINAL COMPLETO, NO LO REPITO POR ESPACIO)
};
// =======================================================

function calcularSimilitud(s1, s2) { /* ... igual que antes */ }
function buscarEnDiccionario(texto) { /* ... igual que antes */ }
function hashTexto(texto) { return crypto.createHash('sha256').update(texto).digest('hex'); }
function limpiarCaches() { /* ... igual que antes */ }
setInterval(limpiarCaches, 600000);

function validarFormatoRespuesta(respuesta, contextoLey) { /* ... igual que antes */ }

app.post('/api/consultar', async (req, res) => {
    // ... (MANTIENE TODO EL CHAT ORIGINAL, SIN CAMBIOS)
    // Asegúrate de que esté aquí completo, con su triaje, búsqueda, etc.
    // No lo pego para no alargar, pero es idéntico al que tenías.
});

// ========== NUEVAS ADICIONES PARA EL QUIZ INSTANTÁNEO ==========

// Mapeo de temas a artículos del Código Civil (puedes ampliarlo)
const mapeoTemas = {
  "bienes": [
    { campo: "articulo_numero", operador: "gte", valor: 565 },
    { campo: "articulo_numero", operador: "lte", valor: 595 }
  ],
  "dominio": [
    { campo: "articulo_numero", operador: "gte", valor: 582 },
    { campo: "articulo_numero", operador: "lte", valor: 605 }
  ],
  "tradicion": [
    { campo: "articulo_numero", operador: "gte", valor: 670 },
    { campo: "articulo_numero", operador: "lte", valor: 699 }
  ],
  "posesion": [
    { campo: "articulo_numero", operador: "gte", valor: 700 },
    { campo: "articulo_numero", operador: "lte", valor: 729 }
  ],
  "filiacion": [
    { campo: "articulo_numero", operador: "gte", valor: 179 },
    { campo: "articulo_numero", operador: "lte", valor: 242 }
  ],
  "sucesion": [
    { campo: "articulo_numero", operador: "gte", valor: 951 },
    { campo: "articulo_numero", operador: "lte", valor: 1067 }
  ],
  "obligaciones": [
    { campo: "articulo_numero", operador: "gte", valor: 1437 },
    { campo: "articulo_numero", operador: "lte", valor: 1566 }
  ],
  "contratos": [
    { campo: "articulo_numero", operador: "gte", valor: 1438 },
    { campo: "articulo_numero", operador: "lte", valor: 2456 }
  ],
  "sociedad_conyugal": [
    { campo: "articulo_numero", operador: "gte", valor: 135 },
    { campo: "articulo_numero", operador: "lte", valor: 185 }
  ]
};

// Cache de preguntas generadas por IA
const cachePreguntasQuiz = new Map(); // clave: `${tema}_${indice}`

// Banco de preguntas estáticas pre‑hechas (5 como pediste) que sirven de fallback inmediato
const fallbackEstaticoGlobal = [
  {
    tema: "bienes",
    pregunta: "¿Qué son los bienes muebles por anticipación?",
    opciones: [
      "A. Cosas que se mueven por sí mismas.",
      "B. Inmuebles por destinación que se consideran muebles antes de su separación.",
      "C. Bienes incorporales como los derechos.",
      "D. Cosas que están destinadas a ser trasladadas de un lugar a otro."
    ],
    correcta: 1
  },
  {
    tema: "dominio",
    pregunta: "El dominio o propiedad, según el artículo 582, es el derecho real que...",
    opciones: [
      "A. Permite usar, gozar y disponer de una cosa, sin más limitaciones que las legales.",
      "B. Solo permite usar la cosa ajena.",
      "C. Otorga únicamente el goce de la cosa.",
      "D. Es exclusivo de las personas jurídicas."
    ],
    correcta: 0
  },
  {
    tema: "tradicion",
    pregunta: "¿Cuál de los siguientes modos de adquirir el dominio se denomina 'tradición'?",
    opciones: [
      "A. La ocupación.",
      "B. La accesión.",
      "C. La entrega que el dueño hace a otro de la cosa, con ánimo de transferir el dominio.",
      "D. La sucesión por causa de muerte."
    ],
    correcta: 2
  },
  {
    tema: "obligaciones",
    pregunta: "¿Qué caracteriza a las obligaciones solidarias?",
    opciones: [
      "A. El deudor puede pagar por partes.",
      "B. Cualquier codeudor puede ser compelido al pago total de la deuda.",
      "C. Cada deudor paga solo su cuota.",
      "D. La solidaridad se presume, no necesita pacto expreso."
    ],
    correcta: 1
  },
  {
    tema: "contratos",
    pregunta: "¿Qué es la lesión enorme en la compraventa?",
    opciones: [
      "A. Un vicio del consentimiento.",
      "B. Un perjuicio económico que permite anular el contrato.",
      "C. El incumplimiento de una obligación.",
      "D. Una sanción penal para el vendedor."
    ],
    correcta: 1
  }
];

async function obtenerArticulosPorTema(tema) {
  const filtros = mapeoTemas[tema];
  if (!filtros) return null;

  let query = supabase
    .from('fragmentos_legales')
    .select('articulo_numero, contenido, titulo, libro')
    .eq('tipo', 'ley');

  filtros.forEach(f => {
    if (f.operador === 'gte') query = query.gte(f.campo, f.valor);
    else if (f.operador === 'lte') query = query.lte(f.campo, f.valor);
  });

  const { data, error } = await query.order('articulo_numero', { ascending: true });
  if (error) {
    console.error('Error al obtener artículos del tema:', error);
    return [];
  }
  return data;
}

function obtenerFallbackEstatico(tema) {
  const disponibles = fallbackEstaticoGlobal.filter(p => p.tema === tema);
  if (disponibles.length === 0) return null;
  return disponibles[Math.floor(Math.random() * disponibles.length)];
}

function validarFormatoQuiz(jsonString) {
  try {
    const obj = JSON.parse(jsonString);
    return obj.pregunta && Array.isArray(obj.opciones) && obj.opciones.length === 4 &&
           typeof obj.correcta === 'number' && obj.correcta >= 0 && obj.correcta <= 3 &&
           obj.explicacion;
  } catch (e) { return false; }
}

async function generarPreguntaConIA(articulo, tema) {
  const prompt = [
    {
      role: "system",
      content: `Eres un experto en Derecho Civil chileno. Devuelve ÚNICAMENTE un JSON con este formato exacto (sin Markdown, sin comentarios):
{
  "pregunta": "...",
  "opciones": ["A. ...","B. ...","C. ...","D. ..."],
  "correcta": 0,
  "explicacion": "..."
}
La pregunta debe ser de opción múltiple, basada en el artículo proporcionado.`
    },
    {
      role: "user",
      content: `Artículo ${articulo.articulo_numero}:\n${articulo.contenido}\n\nGenera el JSON del quiz.`
    }
  ];

  let quizData = null;
  const MAX_INTENTOS = 2;
  let intento = 0;

  while (intento < MAX_INTENTOS && !quizData) {
    try {
      const completion = await openai.chat.completions.create({
        model: "deepseek/deepseek-chat",
        messages: prompt,
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: "json_object" }
      });
      const respuesta = completion.choices[0]?.message?.content?.trim();
      if (respuesta && validarFormatoQuiz(respuesta)) {
        quizData = JSON.parse(respuesta);
      } else {
        intento++;
        prompt[0].content += `\n\nIntento ${intento+1}: Asegúrate de devolver el JSON con los campos exactos.`;
      }
    } catch (err) {
      intento++;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (!quizData) {
    // Fallback interno si la IA no coopera
    quizData = {
      pregunta: `¿Qué establece el artículo ${articulo.articulo_numero} del Código Civil?`,
      opciones: [
        "A. Correcta según el artículo.",
        "B. Incorrecta.",
        "C. Incorrecta.",
        "D. Incorrecta."
      ],
      correcta: 0,
      explicacion: `El artículo ${articulo.articulo_numero} dispone: ${articulo.contenido.substring(0, 200)}...`
    };
  }
  return quizData;
}

// Endpoint del quiz (responde instantáneamente)
app.post('/api/quiz/generar', async (req, res) => {
  const { tema, indice = 0 } = req.body;
  if (!tema || !mapeoTemas[tema]) {
    return res.status(400).json({ error: 'Tema no soportado.' });
  }

  try {
    const articulos = await obtenerArticulosPorTema(tema);
    if (!articulos || articulos.length === 0) {
      return res.status(404).json({ error: 'No hay artículos para este tema.' });
    }

    const total = articulos.length;
    const idx = ((indice % total) + total) % total;
    const articulo = articulos[idx];
    const claveCache = `${tema}_${idx}`;

    // 1. Si ya está en caché, devolvemos inmediatamente
    if (cachePreguntasQuiz.has(claveCache)) {
      const cached = cachePreguntasQuiz.get(claveCache);
      return res.json({
        articulo: { numero: articulo.articulo_numero, texto: articulo.contenido, titulo: articulo.titulo || '' },
        pregunta: cached.pregunta,
        opciones: cached.opciones,
        correcta: cached.correcta,
        explicacion: cached.explicacion,
        indice: idx,
        total,
        origen: 'cache'
      });
    }

    // 2. Respondemos inmediatamente con el fallback estático (o uno genérico)
    const fallback = obtenerFallbackEstatico(tema) || {
      pregunta: `¿Qué establece el artículo ${articulo.articulo_numero}?`,
      opciones: ["A. Incorrecta.", "B. Incorrecta.", "C. Incorrecta.", "D. Correcta según el artículo."],
      correcta: 3
    };
    const explicacionFallback = `El artículo ${articulo.articulo_numero} dispone: ${articulo.contenido.substring(0, 200)}...`;

    // Enviamos la respuesta de inmediato (no esperamos a la IA)
    res.json({
      articulo: { numero: articulo.articulo_numero, texto: articulo.contenido, titulo: articulo.titulo || '' },
      pregunta: fallback.pregunta,
      opciones: fallback.opciones,
      correcta: fallback.correcta,
      explicacion: explicacionFallback,
      indice: idx,
      total,
      origen: 'fallback'
    });

    // 3. En segundo plano, generamos la pregunta con IA y la cacheamos para futuras consultas
    (async () => {
      try {
        const quizIA = await generarPreguntaConIA(articulo, tema);
        if (quizIA) {
          cachePreguntasQuiz.set(claveCache, {
            pregunta: quizIA.pregunta,
            opciones: quizIA.opciones,
            correcta: quizIA.correcta,
            explicacion: quizIA.explicacion
          });
        }
      } catch (e) {
        console.error('Error generando pregunta IA en segundo plano:', e);
      }
    })();

  } catch (error) {
    console.error('Error en /api/quiz/generar:', error);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ========== RUTAS ANTIGUAS ==========
app.get('/ping', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.send('API de Alucilex funcionando.'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor ALUCILEX en puerto ${PORT}`));