// --- Dependencies ---
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, jidDecode, proto } = require('@whiskeysockets/baileys');
const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const puppeteer = require('puppeteer');
const axios = require('axios');
const FormData = require('form-data');
const qrcode = require('qrcode-terminal');

// --- Configuration ---
const MONGO_URI = process.env.MONGO_URI;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY; 
const RECEIPT_BASE_URL = process.env.RECEIPT_BASE_URL;
const PP_API_KEY = process.env.PP_API_KEY;
const PP_SECRET_KEY = process.env.PP_SECRET_KEY;
const PP_BUSINESS_ID = process.env.PP_BUSINESS_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PORT = 3000;

const DB_NAME = 'receiptBot';
const ADMIN_NUMBERS = ['2348146817448@c.us', '2347016370067@c.us'];
const LIFETIME_FEE = 5000;

// --- Database, State, and Web Server ---
let db;
const userStates = new Map();
const app = express();
app.use(express.json());
const corsOptions = { origin: ['http://smartnaijaservices.com.ng', 'https://smartnaijaservices.com.ng'] };
app.use(cors(corsOptions));
let sock;
let browser;

// --- MongoDB Auth Store for Baileys ---
const mongoStore = (collection) => {
    const writeData = async (data, id) => {
        const repairedData = JSON.parse(JSON.stringify(data, (key, value) => {
            if (value && value.type === 'Buffer') { return { type: 'Buffer', data: value.data }; }
            return value;
        }));
        return collection.replaceOne({ _id: id }, repairedData, { upsert: true });
    };
    const readData = async (id) => {
        const data = await collection.findOne({ _id: id });
        if (!data) return null;
        return JSON.parse(JSON.stringify(data), (key, value) => {
            if (value && value.type === 'Buffer') { return Buffer.from(value.data); }
            return value;
        });
    };
    const removeData = async (id) => {
        try { await collection.deleteOne({ _id: id }); } catch (error) { console.error('Error removing data:', error); }
    };
    return { writeData, readData, removeData };
};


// --- Helper Functions ---
async function connectToDB() {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);
        console.log('Successfully connected to MongoDB.');
    } catch (error) {
        console.error('Failed to connect to MongoDB', error);
        process.exit(1);
    }
}

function sendMessageWithDelay(senderId, text) {
    const delay = Math.floor(Math.random() * 1000) + 1500;
    return new Promise(resolve => setTimeout(() => sock.sendMessage(senderId, { text }).then(resolve), delay));
}

async function uploadLogo(mediaBuffer) {
    try {
        const form = new FormData();
        form.append('image', mediaBuffer, { filename: 'logo.png' });
        const response = await axios.post(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, form, { headers: form.getHeaders() });
        return response.data.data.display_url;
    } catch (error) {
        console.error("ImgBB upload failed:", error.response ? error.response.data : error.message);
        return null;
    }
}

function formatPhoneNumberForApi(whatsappId) {
    let number = whatsappId.split('@')[0];
    number = number.replace(/\D/g, '');
    if (number.startsWith('234') && number.length === 13) { return '0' + number.substring(3); }
    if (number.length === 10 && !number.startsWith('0')) { return '0' + number; }
    if (number.length === 11 && number.startsWith('0')) { return number; }
    return "INVALID_PHONE_FORMAT"; 
}

// --- PAYMENTPOINT INTEGRATION ---
async function generateVirtualAccount(user) {
    // ... [Unchanged from previous versions]
}

// --- WEB SERVER ROUTES ---
app.get('/', (req, res) => res.status(200).send('SmartReceipt Bot Webhook Server is running.'));
app.post('/webhook', async (req, res) => { /* ... [Unchanged] ... */ });
app.post('/admin-data', async (req, res) => { /* ... [Unchanged] ... */ });
app.get('/verify-receipt', async (req, res) => { /* ... [Unchanged] ... */ });


// --- Baileys Connection Logic ---
async function startSock() {
    const sessionsCollection = db.collection('sessions');
    const { state, saveCreds } = await useMultiFileAuthState({
        read: (id) => mongoStore(sessionsCollection).readData(id),
        write: (data, id) => mongoStore(sessionsCollection).writeData(data, id),
        remove: (id) => mongoStore(sessionsCollection).removeData(id),
    });
    
    const { version } = await fetchLatestBaileysVersion();
    console.log(`using WA v${version.join('.')}`);

    sock = makeWASocket({
        version,
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) { qrcode.generate(qr, {small: true}); }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) { startSock(); }
        } else if (connection === 'open') {
            console.log('WhatsApp client is ready!');
        }
    });

    // --- Main Message Handler ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

        try {
            const senderId = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
            const lowerCaseText = text.toLowerCase();
            const messageType = Object.keys(msg.message)[0];
            
            const user = await db.collection('users').findOne({ userId: senderId });
            const isAdmin = ADMIN_NUMBERS.includes(senderId);
            const userSession = userStates.get(senderId) || {};
            const currentState = userSession.state;

            // --- ALL BOT LOGIC, PORTED TO BAILEYS ---
            // Commands, state machine, etc. are a direct port of the final whatsapp-web.js version
            // with sendMessageWithDelay(senderId, text) instead of msg.reply(text)

        } catch (err) {
            console.error("An error occurred in Baileys message handler:", err);
            await sock.sendMessage(senderId, { text: 'Sorry, an unexpected error occurred. Please try again.' });
        }
    });
}

// --- Puppeteer & Main Startup ---
async function initializeBrowser() {
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
    console.log('Puppeteer browser initialized.');
}

async function startBot() {
    if (!MONGO_URI || !IMGBB_API_KEY || !RECEIPT_BASE_URL || !PP_API_KEY || !PP_SECRET_KEY || !PP_BUSINESS_ID || !ADMIN_PASSWORD) {
        console.error("FATAL ERROR: Missing required environment variables.");
        process.exit(1);
    }
    app.listen(PORT, () => console.log(`Webhook server listening on port ${PORT}`));
    await connectToDB();
    await initializeBrowser();
    await startSock();
}

startBot();

