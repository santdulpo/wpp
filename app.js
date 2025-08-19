
// =================== IMPORTS Y CONFIGURACIÓN ===================
require('dotenv').config();
const { createBot, createProvider, createFlow, addKeyword } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const supabase = require('./supabase');
const JsonFileAdapter = require('@bot-whatsapp/database/json');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Aquí puedes agregar tus nuevas funciones y flujos desde cero


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

// Configura Gemini
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

// Flujo de bienvenida
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

// Flujo para manejar opciones 1, 2, 3
const opcionesFlow = addKeyword(['1', '2', '3'])
    .addAction(async (ctx, { flowDynamic }) => {
        const opcion = ctx.body.trim();
        if (opcion === '1') {
            await flowDynamic('El valor es 80.000 pesos colombianos.');
            return;
        }
        if (opcion === '2') {
            // Consultar todos los servicios (nombre y descripcion)
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
            // Consultar precios de todos los servicios y disponibilidad
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

// Flujo para cualquier otra pregunta → Gemini
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
    const adapterDB = new JsonFileAdapter(); // Para historial de chats

    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB, // Necesario para historial
    });

    QRPortalWeb();
};



const qrcode = require('qrcode-terminal');

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true }); // Muestra el QR en la consola
});


main();
