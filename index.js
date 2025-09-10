// --- Dependencies ---
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore, jidDecode, proto } = require('@whiskeysockets/baileys');
const { MongoClient, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const puppeteer = require('puppeteer-core'); // Using puppeteer-core
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

// --- Helper Functions, API Calls, Web Server Routes ---
// [These sections are completely unchanged]
async function connectToDB() { /* ... */ }
function sendMessageWithDelay(senderId, text) { /* ... */ }
async function uploadLogo(mediaBuffer) { /* ... */ }
function formatPhoneNumberForApi(whatsappId) { /* ... */ }
async function generateVirtualAccount(user) { /* ... */ }
app.get('/', (req, res) => { /* ... */ });
app.post('/webhook', async (req, res) => { /* ... */ });
app.post('/admin-data', async (req, res) => { /* ... */ });
app.get('/verify-receipt', async (req, res) => { /* ... */ });

// --- Baileys Connection Logic ---
async function startSock() {
    // [This section is completely unchanged]
}

// --- Puppeteer & Main Startup ---
async function initializeBrowser() {
    try {
        browser = await puppeteer.launch({
            // ✨ THE FINAL FIX YOU DISCOVERED ✨
            executablePath: '/usr/bin/chromium',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
        });
        console.log('Puppeteer browser initialized successfully.');
    } catch (error) {
        console.error("FATAL: Could not initialize Puppeteer.", error);
        process.exit(1);
    }
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
