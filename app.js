// =================== IMPORTS Y CONFIGURACIÓN ===================
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const { createBot, createProvider, createFlow, addKeyword } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const supabase = require('./supabase');
const JsonFileAdapter = require('@bot-whatsapp/database/json');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcodeTerminal = require('qrcode-terminal'); // Para imprimir en consola y generar ASCII

// Server HTTP para Seenode
const app = express();
const PORT = process.env.PORT || 80;

// =================== UTIL: CAPTURA/LECTURA DE QR ===================
let lastQrString = ""; // si el provider emite el string del QR lo guardamos aquí

// Busca el PNG de QR que genera el portal (mensajes de log indican *.qr.png)
function findLatestQrPng() {
    try {
        const files = fs.readdirSync(process.cwd())
            .filter(f => f.toLowerCase().endsWith('qr.png'))
            .map(f => {
                const full = path.join(process.cwd(), f);
                return { full, mtime: fs.statSync(full).mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime);
        return files.length ? files[0].full : null;
    } catch (e) {
        return null;
    }
}

// =================== FUNCIONES SUPABASE ===================
async function obtenerServicioPorOpcion(opcion) {
    const { data, error } = await supabase
        .from('servicios')
        .select('*')
        .eq('id', opcion)
        .single();
    if (error) {
        console.error("Error consultando servicio:", error);
        return null;
    }
    return data;
}

// =================== GEMINI ===================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function preguntarGemini(mensaje) {
    try {
        const result = await model.generateContent(mensaje);
        return result.response.text();
    } catch (error) {
        console.error("Error con Gemini:", error);
        return "Lo siento, hubo un problema al consultar la IA.";
    }
}

// =================== FLUJOS ===================
const welcomeFlow = addKeyword(['hola', 'buenas', 'saludos'])
    .addAnswer('👋 Hola dime qué necesitas para hoy.')
    .addAnswer(
        'Estos son nuestros servicios:',
        null,
        async (ctx, { flowDynamic }) => {
            await flowDynamic([
                '1️⃣ confeccion de pantalón a medida',
                '2️⃣ Toda clase de arreglos de sastrería',
                '3️⃣ Consultas de precios y disponibilidad'
            ]);
        }
    );

const opcionesFlow = addKeyword(['1', '2', '3'])
    .addAction(async (ctx, { flowDynamic }) => {
        const opcion = ctx.body.trim();
        if (opcion === '1') {
            await flowDynamic('El valor es 80.000 pesos colombianos.');
            return;
        }
        if (opcion === '2') {
            const { data: servicios, error } = await supabase
                .from('servicios')
                .select('nombre, descripcion');
            if (error || !servicios) {
                await flowDynamic('No se pudieron obtener los servicios en este momento.');
                return;
            }
            const lista = servicios.map(s => `• ${s.nombre}: ${s.descripcion}`).join('\n');
            await flowDynamic(`Estos son nuestros servicios:\n${lista}`);
            return;
        }
        if (opcion === '3') {
            const { data: servicios, error: errorServicios } = await supabase
                .from('servicios')
                .select('nombre, precio');
            const { data: disponibilidad, error: errorDisp } = await supabase
                .from('disponibilidad')
                .select('dia, hora_inicio, hora_fin');
            if (errorServicios || !servicios) {
                await flowDynamic('No se pudieron obtener los precios en este momento.');
                return;
            }
            let precios = servicios.map(s => `• ${s.nombre}: $${s.precio}`).join('\n');
            let disp = '';
            if (disponibilidad && disponibilidad.length) {
                disp = '\n\n*Disponibilidad:*\n' + disponibilidad.map(d =>
                    `• ${d.dia}: ${d.hora_inicio} a ${d.hora_fin}`
                ).join('\n');
            }
            await flowDynamic(`Precios de nuestros servicios:\n${precios}${disp}`);
            return;
        }
    });

const preguntaLibreFlow = addKeyword([/.*/])
    .addAction(async (ctx, { flowDynamic }) => {
        if (!['1', '2', '3'].includes(ctx.body.trim())) {
            const respuestaGemini = await preguntarGemini(ctx.body);
            await flowDynamic(respuestaGemini);
        }
    });

// =================== FUNCIÓN PRINCIPAL ===================
const main = async () => {
    const adapterFlow = createFlow([
        welcomeFlow,
        opcionesFlow,
        preguntaLibreFlow
    ]);

    const adapterProvider = createProvider(BaileysProvider);
    const adapterDB = new JsonFileAdapter();

    // 👉 Si el provider emite el QR en texto, lo imprimimos y guardamos
    try {
        adapterProvider.on?.('qr', (qr) => {
            lastQrString = qr || '';
            console.log('⚡ Escanea este QR (también disponible en /qr y /qr-text):');
            try {
                qrcodeTerminal.generate(qr, { small: true });
            } catch (e) {
                console.log(qr);
            }
        });
    } catch (_) {
        // Si la versión del provider no emite el evento, simplemente seguimos;
        // el Portal generará el PNG y lo servimos por /qr.
    }

    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB, // Necesario para historial
    });

    // Mantiene compatibilidad con tu flujo actual + genera archivo *.qr.png
    QRPortalWeb();
};

// =================== ENDPOINTS HTTP ===================

// Ping
app.get('/', (_req, res) => {
    res.send(`
        <h2>✅ Bot WhatsApp corriendo</h2>
        <ul>
          <li><a href="/qr">/qr</a> — QR como imagen (PNG generado por el portal)</li>
          <li><a href="/qr-text">/qr-text</a> — QR en ASCII (si el provider lo emite)</li>
          <li><a href="/download-bot">/download-bot</a> — Descargar este app.js</li>
        </ul>
    `);
});

// QR como imagen (sirve el último *.qr.png generado)
app.get('/qr', (req, res) => {
    const file = findLatestQrPng();
    if (file && fs.existsSync(file)) {
        return res.sendFile(file);
    }
    if (lastQrString) {
        // fallback: mostramos el ASCII si tenemos el string pero aún no hay PNG
        return res.send(`<pre>${qrcodeToAscii(lastQrString)}</pre>`);
    }
    res.status(503).send('⚠️ Aún no hay QR generado. Espera unos segundos y recarga.');
});

// QR en ASCII (si el provider nos dio el string)
app.get('/qr-text', (req, res) => {
    if (!lastQrString) {
        return res.status(503).send('⚠️ Aún no hay QR en memoria.');
    }
    res.type('text/plain').send(qrcodeToAscii(lastQrString));
});

// Descargar el propio archivo del bot
app.get('/download-bot', (req, res) => {
    res.download(__filename, 'bot.js');
});

// Util: genera ASCII (string) con qrcode-terminal
function qrcodeToAscii(qr) {
    try {
        let ascii = '';
        qrcodeTerminal.generate(qr, { small: true }, (q) => { ascii = q; });
        return ascii || qr;
    } catch {
        return qr;
    }
}

// Iniciar servidor HTTP en 0.0.0.0:80 (requisito de Seenode)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor HTTP escuchando en http://0.0.0.0:${PORT}`);
});

// Levantar el bot
main();
