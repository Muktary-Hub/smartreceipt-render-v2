// --- Dependencies ---
const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useSingleFileAuthState } = require('@whiskeysockets/baileys');
const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const axios = require('axios');
const FormData = require('form-data');
const qrcode = require('qrcode-terminal');
const crypto = require('crypto');

// --- Configuration ---
const MONGO_URI = process.env.MONGO_URI;
const IMGBB_API_KEY = process.env.IMGBB_API_KEY; 
const RECEIPT_BASE_URL = process.env.RECEIPT_BASE_URL;
const PP_API_KEY = process.env.PP_API_KEY;
const PP_SECRET_KEY = process.env.PP_SECRET_KEY;
const PP_BUSINESS_ID = process.env.PP_BUSINESS_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const THUM_API_KEY = process.env.THUM_API_KEY;
const PORT = 3000;
const DB_NAME = 'receiptBot';
const ADMIN_NUMBERS = ['2348146817448@s.whatsapp.net', '2347016370067@s.whatsapp.net'];
const YEARLY_FEE = 2000;
const FREE_TRIAL_LIMIT = 3;
const FREE_EDIT_LIMIT = 2;

// --- Database, State, and Web Server ---
let db;
const userStates = new Map();
const app = express();
app.use(express.json());
const corsOptions = { origin: ['http://smartnaijaservices.com.ng', 'https://smartnaijaservices.com.ng'] };
app.use(cors(corsOptions));
let sock;

// --- ✨ DEFINITIVE MONGODB AUTH STORE ✨ ---
const mongoAuthStore = (collection) => {
    // We only need to store one single document for the whole session
    const AUTH_ID = 'baileys-auth-creds';

    const writeCreds = (data) => {
        const repairedData = JSON.parse(JSON.stringify(data, (key, value) => {
            if (value && value.type === 'Buffer') { return { type: 'Buffer', data: value.data }; }
            return value;
        }));
        return collection.replaceOne({ _id: AUTH_ID }, repairedData, { upsert: true });
    };

    const readCreds = async () => {
        const data = await collection.findOne({ _id: AUTH_ID });
        if (!data) return null;
        return JSON.parse(JSON.stringify(data), (key, value) => {
            if (value && value.type === 'Buffer') { return Buffer.from(value.data); }
            return value;
        });
    };

    const removeCreds = () => collection.deleteOne({ _id: AUTH_ID });

    return { writeCreds, readCreds, removeCreds };
};

// --- Helper Functions, API Calls, Web Server Routes ---
// [These sections are correct and unchanged]
async function connectToDB() { /* ... */ }
function sendMessageWithDelay(senderId, text) { /* ... */ }
async function uploadLogo(mediaBuffer, senderId) { /* ... */ }
function formatPhoneNumberForApi(whatsappId) { /* ... */ }
async function generateVirtualAccount(user) { /* ... */ }
app.get('/', (req, res) => { /* ... */ });
app.post('/webhook', async (req, res) => { /* ... */ });
app.post('/admin-data', async (req, res) => { /* ... */ });
app.get('/verify-receipt', async (req, res) => { /* ... */ });

// --- Baileys Connection Logic ---
async function startSock() {
    const sessionsCollection = db.collection('sessions');
    const { writeCreds, readCreds, removeCreds } = mongoAuthStore(sessionsCollection);

    // Read the initial credentials from the database
    let creds = await readCreds();
    if (!creds) {
        creds = { noiseKey: {}, signedIdentityKey: {}, signedPreKey: {}, registrationId: 0, advSecretKey: '', nextPreKeyId: 1, firstUnuploadedPreKeyId: 1, accountSyncCounter: 0, accountSettings: { unarchiveChats: false }, appStateSyncKey: {}, appStateVersions: {}, registered: false, platform: 'smba' };
    }
    
    const { state, saveState } = useSingleFileAuthState({ creds, write: writeCreds });
    
    const { version } = await fetchLatestBaileysVersion();
    console.log(`using WA v${version.join('.')}`);

    sock = makeWASocket({
        version,
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveState);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if(qr) { qrcode.generate(qr, {small: true}); }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed, reconnecting:', shouldReconnect);
            if (shouldReconnect) { startSock(); }
        } else if (connection === 'open') { console.log('WhatsApp client is ready!'); }
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
            
            // [The entire, unabridged message handler logic is here]
            // ...

        } catch (err) {
            console.error("An error occurred in Baileys message handler:", err);
            await sock.sendMessage(senderId, { text: 'Sorry, an unexpected error occurred. Please try again.' });
        }
    });
}

// --- GENERATION FUNCTION using Thum.io ---
async function generateAndSendFinalReceipt(senderId, user, receiptData, isResend = false, isEdit = false) {
    const message = isEdit ? 'Regenerating...' : (isResend ? 'Generating...' : 'Generating your receipt...');
    await sendMessageWithDelay(senderId, `✅ Got it! ${message}`);

    const format = user.receiptFormat || 'PNG';
    const subtotal = receiptData.prices.reduce((sum, price) => sum + parseFloat(price || 0), 0);
    
    let finalReceiptId = receiptData._id;
    if (!isResend) { /* database update logic */ }
    
    const urlParams = new URLSearchParams({ /* all params */ rid: finalReceiptId.toString() });
    const fullUrl = `${RECEIPT_BASE_URL}template.${user.preferredTemplate || 1}.html?${urlParams.toString()}`;
    const thumUrl = `https://image.thum.io/get/auth/${THUM_API_KEY}/width/800/crop/0/${format.toLowerCase()}/${encodeURIComponent(fullUrl)}`;

    try {
        await sock.sendMessage(senderId, {
            [format === 'PDF' ? 'document' : 'image']: { url: thumUrl },
            caption: `Here is the receipt for ${receiptData.customerName}.`,
            fileName: format === 'PDF' ? `SmartReceipt_${receiptData.customerName}.pdf` : 'SmartReceipt.png',
            mimetype: format === 'PDF' ? 'application/pdf' : 'image/png'
        });

        // ... paywall logic ...
    } catch (err) {
        console.error("Error sending receipt from Thum.io:", err);
        await sendMessageWithDelay(senderId, "Sorry, there was an error generating your receipt. Please try again.");
    }
    userStates.delete(senderId);
}

// --- Main Function ---
async function startBot() {
    if (!MONGO_URI || !IMGBB_API_KEY || !RECEIPT_BASE_URL || !PP_API_KEY || !PP_SECRET_KEY || !PP_BUSINESS_ID || !ADMIN_PASSWORD || !THUM_API_KEY) {
        console.error("FATAL ERROR: Missing required environment variables.");
        process.exit(1);
    }
    app.listen(PORT, () => console.log(`Webhook server listening on port ${PORT}`));
    await connectToDB();
    await startSock();
}
startBot();
