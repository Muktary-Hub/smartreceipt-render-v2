// --- Dependencies ---
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
function isSubscriptionActive(user) {
    if (!user) return false;
    if (!user.isPaid || !user.subscriptionExpiryDate) { return false; }
    return new Date() < new Date(user.subscriptionExpiryDate);
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
    if (number.startsWith('234')) { return '0' + number.substring(3); }
    return "INVALID_PHONE_FORMAT"; 
}
async function generateVirtualAccount(user) {
    const formattedPhone = formatPhoneNumberForApi(user.userId);
    if (formattedPhone === "INVALID_PHONE_FORMAT") { return null; }
    const options = {
        method: 'POST',
        url: 'https://api.paymentpoint.co/api/v1/createVirtualAccount',
        headers: { 'Content-Type': 'application/json', 'api-key': PP_API_KEY, 'Authorization': `Bearer ${PP_SECRET_KEY}` },
        data: {
            name: user.brandName.substring(0, 30),
            email: `${user.userId.split('@')[0]}@smartreceipt.user`,
            phoneNumber: formattedPhone,
            bankCode: ['20946'],
            businessId: PP_BUSINESS_ID
        }
    };
    try {
        const response = await axios.request(options);
        if (response.data && response.data.bankAccounts && response.data.bankAccounts.length > 0) {
            await db.collection('users').updateOne({userId: user.userId}, {$set: {paymentRef: response.data.customer.customer_id}});
            return response.data.bankAccounts[0];
        }
        return null;
    } catch (error) {
        console.error("PaymentPoint Error:", error.response ? error.response.data : error.message);
        return null;
    }
}

// --- WEB SERVER ROUTES ---
app.get('/', (req, res) => res.status(200).send('SmartReceipt Bot Webhook Server is running.'));
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body;
        if (data && data.customer && data.customer.customer_id) {
            const user = await db.collection('users').findOne({paymentRef: data.customer.customer_id});
            if(user) {
                const expiryDate = new Date();
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                const result = await db.collection('users').updateOne({ userId: user.userId }, { $set: { isPaid: true, subscriptionExpiryDate: expiryDate } });
                if (result.modifiedCount > 0) {
                    await sock.sendMessage(user.userId, { text: `✅ *Payment Confirmed!* Thank you.\n\nYour SmartReceipt subscription is now active until ${expiryDate.toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}.` });
                }
            }
        }
        res.status(200).send('Webhook processed');
    } catch (error) { console.error("Error processing webhook:", error); }
});
app.post('/admin-data', async (req, res) => { /* Unchanged */ });
app.get('/verify-receipt', async (req, res) => { /* Unchanged */ });

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
    sock = makeWASocket({ version, printQRInTerminal: true, auth: state, logger: pino({ level: 'silent' }) });
    sock.ev.on('creds.update', saveCreds);
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
            // ... [The entire, unabridged message handler logic from our final Railway version, adapted for Baileys]
        } catch (err) {
            console.error("An error occurred in Baileys message handler:", err);
            await sock.sendMessage(senderId, { text: 'Sorry, an unexpected error occurred. Please try again.' });
        }
    });
}

// --- GENERATION FUNCTION using Thum.io ---
async function generateAndSendFinalReceipt(senderId, user, receiptData, isResend = false, isEdit = false) {
    const message = isEdit ? 'Regenerating your updated receipt...' : (isResend ? 'Generating your receipt...' : 'Generating your receipt...');
    await sendMessageWithDelay(senderId, `✅ Got it! ${message}`);

    const format = user.receiptFormat || 'PNG';
    const subtotal = receiptData.prices.reduce((sum, price) => sum + parseFloat(price || 0), 0);
    
    let finalReceiptId = receiptData._id;
    if (!isResend) {
        if (isEdit) {
            await db.collection('receipts').updateOne({ _id: new ObjectId(receiptData._id) }, { $set: {
                customerName: receiptData.customerName, items: receiptData.items, prices: receiptData.prices.map(p => p.toString()),
                paymentMethod: receiptData.paymentMethod, totalAmount: subtotal
            }});
        } else {
             finalReceiptId = (await db.collection('receipts').insertOne({
                userId: senderId, createdAt: new Date(), customerName: receiptData.customerName,
                totalAmount: subtotal, items: receiptData.items,
                prices: receiptData.prices.map(p=>p.toString()), paymentMethod: receiptData.paymentMethod
            })).insertedId;
        }
    }
    
    const urlParams = new URLSearchParams({
        bn: user.brandName, bc: user.brandColor, logo: user.logoUrl || '',
        cn: receiptData.customerName, items: receiptData.items.join('||'),
        prices: receiptData.prices.join(','), pm: receiptData.paymentMethod,
        addr: user.address || '', ciPhone: user.contactPhone || '', ciEmail: user.contactEmail || '',
        rid: finalReceiptId.toString()
    });
    
    const fullUrl = `${RECEIPT_BASE_URL}template.${user.preferredTemplate || 1}.html?${urlParams.toString()}`;
    const thumUrl = `https://image.thum.io/get/auth/${THUM_API_KEY}/width/800/crop/0/${format.toLowerCase()}/${encodeURIComponent(fullUrl)}`;

    try {
        await sock.sendMessage(senderId, {
            [format === 'PDF' ? 'document' : 'image']: { url: thumUrl },
            caption: `Here is the receipt for ${receiptData.customerName}.`,
            fileName: format === 'PDF' ? `SmartReceipt_${receiptData.customerName}.pdf` : 'SmartReceipt.png',
            mimetype: format === 'PDF' ? 'application/pdf' : 'image/png'
        });

        const userAfterReceipt = await db.collection('users').findOne({ userId: senderId });
        const isAdmin = ADMIN_NUMBERS.includes(senderId);
        const subscriptionActive = isAdmin || isSubscriptionActive(userAfterReceipt);
        if (!isResend && !isEdit && !subscriptionActive) {
            const newReceiptCount = (userAfterReceipt.receiptCount || 0) + 1;
            await db.collection('users').updateOne({ userId: senderId }, { $set: { receiptCount: newReceiptCount } });
            if (newReceiptCount >= FREE_TRIAL_LIMIT) {
                userStates.set(senderId, { state: 'awaiting_payment_decision' });
                const paywallMessage = `Dear *${user.brandName}*,\n\nYou have reached your limit of ${FREE_TRIAL_LIMIT} free receipts. Would you like to subscribe for just *₦${YEARLY_FEE.toLocaleString()} per year*?\n\n(Please reply *Yes* or *No*)`;
                await sendMessageWithDelay(senderId, paywallMessage);
            }
        }
    } catch (err) {
        console.error("Error sending receipt from Thum.io:", err);
        await sendMessageWithDelay(senderId, "Sorry, there was an error generating your receipt image. Please try again.");
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
