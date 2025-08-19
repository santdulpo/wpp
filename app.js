const { createBot, createProvider, createFlow, addKeyword } = require('@bot-whatsapp/bot')

const QRCode = require('qrcode-terminal')
const BaileysProvider = require('@bot-whatsapp/provider/baileys')
const MockAdapter = require('@bot-whatsapp/database/mock')
const express = require('express')
const fs = require('fs')
const path = require('path')

// 📌 Flujo de ejemplo
const flowPrincipal = addKeyword(['hola', 'buenas', 'saludos'])
    .addAnswer('👋 Hola soy Santiago, dime qué necesitas para hoy.')
    .addAnswer('👉 Estos son nuestros servicios:\n1️⃣ Arreglo de pantalón a medida\n2️⃣ Toda clase de arreglos de sastrería\n3️⃣ Consultas de precios y disponibilidad\n💬 Puedes preguntarme lo que quieras')

// 📌 Inicialización
const main = async () => {
    const adapterDB = new MockAdapter()
    const adapterFlow = createFlow([flowPrincipal])
    const provider = createProvider(BaileysProvider)

    // ⚡ Corrección: escuchar QR en provider
    provider.on('qr', (qr) => {
        console.log('⚡ Escanea este QR para vincular tu WhatsApp ⚡')
        QRCode.generate(qr, { small: true })
    })

    createBot({
        flow: adapterFlow,
        provider,
        database: adapterDB,
    })

    // 🚀 Servidor Express para ver/descargar app.js
    const app = express()

    // Ruta para ver el archivo en navegador
    app.get('/ver-bot', (req, res) => {
        res.sendFile(path.join(__dirname, 'app.js'))
    })

    // Ruta para descargar el archivo
    app.get('/descargar-bot', (req, res) => {
        res.download(path.join(__dirname, 'app.js'), 'bot-sastreria.js')
    })

    app.listen(3000, () => {
        console.log('🌐 Servidor web corriendo en http://localhost:3000')
        console.log('📄 Ver bot en navegador: http://localhost:3000/ver-bot')
        console.log('⬇️ Descargar bot: http://localhost:3000/descargar-bot')
    })
}

main()

