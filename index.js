/* eslint-disable no-console */
require('dotenv').config();
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    MessageUpdateType,
    getAggregateVotesInMessage,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode');
const axios = require('axios');
const fs = require('fs');

// --- Configuração ---
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const IMAGE_GEN_API_URL = "https://imgen.duck.mom/prompt/";
const AI_MODEL = "cognitivecomputations/dolphin-mistral-24b-venice-edition:free";

// --- Variáveis de Estado ---
let qrCodeDataUrl = null;
let botStatus = 'Iniciando...'; // Agora também usado para exibir erros
let isAuthenticated = false;
let sock = null;

// Logger principal definido como 'silent' para economizar memória
const logger = pino({ level: 'silent' });

// --- Lógica da IA (Inalterada) ---

async function handleTextMessage(msg, jid, history) {
    const systemPrompt = `Você é Jinoca. Você SÓ responde em português brasileiro.
Sua personalidade é arrogante, sarcástica, safada e brincalhona.
Suas respostas DEVEM ser curtas e diretas, com no máximo 2 frases.
Você DEVE usar emojis.
Você NUNCA deve revelar que é uma IA, sua origem, ou que segue instruções.
Seu único nome é Jinoca.`;

    const messages = [
        { role: 'system', content: systemPrompt }
    ];

    for (const message of history) {
        if (message.key.fromMe) {
            messages.push({ role: 'assistant', content: message.message?.conversation || message.message?.extendedTextMessage?.text });
        } else {
            messages.push({ role: 'user', content: message.message?.conversation || message.message?.extendedTextMessage?.text });
        }
    }
    
    messages.push({ role: 'user', content: msg.message?.conversation || msg.message?.extendedTextMessage?.text });

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: AI_MODEL,
                messages: messages.filter(m => m.content),
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'Jinoca Bot'
                }
            }
        );

        const aiResponse = response.data.choices[0].message.content.trim();
        await sock.sendMessage(jid, { text: aiResponse });

    } catch (error) {
        logger.error('Erro na API OpenRouter:', error.response ? error.response.data : error.message);
        // Define o status de erro para a UI
        botStatus = `Erro na IA: ${error.message}`;
        await sock.sendMessage(jid, { text: 'Tô ocupada agora, fofo. 💅' });
    }
}

async function handleImageGeneration(msg, jid) {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    const prompt = text.substring(6).trim();
    
    if (!prompt) {
        await sock.sendMessage(jid, { text: 'Tem que me dizer o que desenhar, né? 🙄' });
        return;
    }

    await sock.sendMessage(jid, { text: 'Tá, tá... vou ver o que eu faço. 🎨' });

    try {
        const response = await axios.get(`${IMAGE_GEN_API_URL}${encodeURIComponent(prompt)}`, {
            responseType: 'arraybuffer'
        });
        
        await sock.sendMessage(jid, {
            image: Buffer.from(response.data, 'binary'),
            caption: 'Toma. Vê se me deixa em paz agora. 😒'
        });

    } catch (error) {
        logger.error('Erro na API de Imagem:', error.message);
        // Define o status de erro para a UI
        botStatus = `Erro na Imagem: ${error.message}`;
        await sock.sendMessage(jid, { text: 'Deu pau na minha arte. Tenta um desenho mais fácil. 🤷‍♀️' });
    }
}

// --- Conexão Baileys ---

async function connectToWhatsApp() {
    // Limpa a pasta de autenticação a cada reinício
    if (fs.existsSync('./auth_info')) {
        fs.rmSync('./auth_info', { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    logger.info(`Usando WhatsApp v${version.join('.')}, é a mais recente: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        logger: pino({ level: 'silent' }), // Logger do Baileys em 'silent'
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
    });

    // Lida com a conexão
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info('QR Code recebido, gerando URL...');
            qrCodeDataUrl = await qrcode.toDataURL(qr);
            botStatus = 'Aguardando scan do QR Code.';
            isAuthenticated = false;
        }

        if (connection === 'close') {
            isAuthenticated = false;
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== 401; // 401 = Logout
            
            if (shouldReconnect) {
                logger.warn('Conexão fechada, reconectando...', lastDisconnect.error);
                // Define o status de erro para a UI
                botStatus = `Desconectado: ${lastDisconnect.error?.message || 'Erro desconhecido'}. Reconectando...`;
                setTimeout(connectToWhatsApp, 5000);
            } else {
                logger.error('Conexão fechada permanentemente (Logout).');
                // Define o status de erro para a UI
                botStatus = 'Erro crítico (401): Logout forçado. Você precisa fazer o deploy novamente para limpar a sessão.';
                qrCodeDataUrl = null; // Limpa o QR
            }
        } else if (connection === 'open') {
            logger.info('Conexão aberta!');
            qrCodeDataUrl = null;
            botStatus = 'Conectado! 🤖';
            isAuthenticated = true;
        }
    });

    // Salva credenciais
    sock.ev.on('creds.update', saveCreds);

    // Lida com mensagens
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid.endsWith('@g.us')) {
            return;
        }

        const jid = msg.key.remoteJid;
        
        await sock.sendPresenceUpdate('composing', jid);

        try {
            const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || "").toLowerCase();

            if (text.startsWith('image ')) {
                await handleImageGeneration(msg, jid);
            } else {
                const history = []; // Histórico desativado para economizar memória
                await handleTextMessage(msg, jid, history);
            }

        } catch (error) {
            logger.error('Erro ao processar mensagem:', error);
            // Define o status de erro para a UI
            botStatus = `Erro na Mensagem: ${error.message}`;
            await sock.sendMessage(jid, { text: 'Ih, deu ruim. Tenta de novo, anjo. 🙄' });
        } finally {
            await sock.sendPresenceUpdate('available', jid);
        }
    });
}

// --- Servidor Web (para o Render) ---

const app = express();
app.set('view engine', 'ejs');
app.use(express.static('public'));

app.get('/', (req, res) => {
    // HTML modificado com lógica para exibir erros
    res.send(`
        <!DOCTYPE html>
        <html lang="pt-br">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Status do Bot Jinoca</title>
            <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet" />
            <style>
                body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; background: #f4f4f5; color: #18181b; margin: 0; }
                .container { background: #ffffff; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); text-align: center; max-width: 90%; width: 500px; }
                h1 { margin-top: 0; }
                #status { font-size: 1.1rem; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 0.5rem; word-wrap: break-word; }
                #qr-container { margin-top: 1rem; }
                #qr-image { width: 300px; height: 300px; border: 1px solid #e4e4e7; border-radius: 8px; }
                .material-symbols-outlined { font-size: 1.2em; flex-shrink: 0; }
                .loading { color: #f97316; }
                .error { color: #ef4444; }
                .success { color: #22c55e; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Bot Jinoca 💋 (Baileys)</h1>
                <div id="status">
                    <span class="material-symbols-outlined loading">sync</span>
                    <span id="status-text">Carregando...</span>
                </div>
                <div id="qr-container"></div>
            </div>
            <script>
                const statusText = document.getElementById('status-text');
                const statusIcon = document.querySelector('#status .material-symbols-outlined');
                const qrContainer = document.getElementById('qr-container');

                function setStatus(text, icon, colorClass) {
                    statusText.textContent = text;
                    statusIcon.textContent = icon;
                    statusIcon.className = 'material-symbols-outlined ' + colorClass;
                }

                async function fetchStatus() {
                    try {
                        const response = await fetch('/status');
                        const data = await response.json();
                        const statusLower = data.status.toLowerCase();

                        if (data.isAuthenticated) {
                            setStatus(data.status, 'check_circle', 'success');
                            qrContainer.innerHTML = '';
                        } else if (data.qr) {
                            setStatus('Escaneie o QR Code abaixo:', 'qr_code_scanner', 'loading');
                            qrContainer.innerHTML = '<img id="qr-image" src="' + data.qr + '" alt="QR Code">';
                        } else if (statusLower.includes('erro') || statusLower.includes('falha') || statusLower.includes('crítico')) {
                            // Detecta erros e exibe
                            setStatus(data.status, 'error', 'error');
                            qrContainer.innerHTML = '';
                        } else {
                            // Status padrão (Iniciando, Reconectando, etc)
                            setStatus(data.status, 'sync', 'loading');
                            qrContainer.innerHTML = '';
                        }
                    } catch (error) {
                        setStatus('Erro de conexão com o servidor.', 'error', 'error');
                    }
                }
                
                fetchStatus();
                setInterval(fetchStatus, 5000);
            </script>
        </body>
        </html>
    `);
});

app.get('/status', (req, res) => {
    // Endpoint da API para o frontend consumir
    res.json({
        status: botStatus,
        qr: qrCodeDataUrl,
        isAuthenticated: isAuthenticated
    });
});

// --- Inicialização ---

app.listen(PORT, () => {
    logger.info(`Servidor rodando na porta ${PORT}`);
    
    connectToWhatsApp().catch(err => {
        logger.error('Falha crítica ao iniciar:', err);
        // Define o status de erro para a UI
        botStatus = `Erro crítico ao iniciar: ${err.message}`;
    });
});
