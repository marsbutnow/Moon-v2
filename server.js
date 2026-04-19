/**
 * Moon Stash — Chat Server
 * ─────────────────────────
 * Self-hosted WebSocket server. Runs on the same machine/host as moon-stash.html.
 * All chat messages are broadcast only to clients connected to THIS server,
 * so chat is isolated to your domain.
 *
 * SETUP:
 *   1. Install Node.js (https://nodejs.org) if you haven't already
 *   2. In a terminal in this folder, run:
 *        npm install ws
 *   3. Start the server:
 *        node server.js
 *   4. Open moon-stash.html in a browser from the same domain/host
 *
 * The server runs on port 3001 by default.
 * To change it, edit WS_PORT below.
 *
 * HOSTING ON REPLIT / RENDER / RAILWAY etc.:
 *   - Set the PORT environment variable — the server reads it automatically
 *   - Make sure your hosting provider allows WebSocket upgrades
 *   - For wss:// (https domains) most providers handle TLS termination for you
 *
 * MESSAGE FORMAT (JSON):
 *   { t: 'chat',    user, role, text, ts }   — regular chat message
 *   { t: 'ann',     user, role, text, ts }   — admin broadcast (shown as banner)
 *   { t: 'sys',     text, ts }               — system message (join/leave)
 *   { t: 'history', messages: [...] }        — sent to new clients on connect
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const WS_PORT     = process.env.PORT || 3001;
const MAX_HISTORY = 60;   // how many messages to keep in memory
const MAX_MSG_LEN = 400;  // max text length per message

// ── In-memory message history (clears on server restart) ──
const history = [];

function addToHistory(msg) {
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
}

// ── HTTP server (serves moon-stash.html if requested) ──
const httpServer = http.createServer((req, res) => {
  // Serve the HTML file so you can just visit http://yourhost:3001
  const filePath = path.join(__dirname, 'moon-stash.html');
  if (req.url === '/' || req.url === '/index.html') {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404); res.end('moon-stash.html not found next to server.js');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

// ── WebSocket server ──
const wss = new WebSocketServer({ server: httpServer });

const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[+] Client connected  (${clients.size} online)  IP: ${ip}`);

  // Send history to the new client
  if (history.length > 0) {
    try {
      ws.send(JSON.stringify({ t: 'history', messages: history }));
    } catch (e) {}
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return; // ignore malformed messages
    }

    // Validate
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.text && msg.text.length > MAX_MSG_LEN) {
      msg.text = msg.text.slice(0, MAX_MSG_LEN);
    }

    // Sanitize user/text fields — strip HTML tags
    const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').slice(0, 80);
    if (msg.user) msg.user = strip(msg.user);
    if (msg.text) msg.text = strip(msg.text);

    // Stamp server-side timestamp
    msg.ts = Date.now();

    // Store non-history types
    if (msg.t === 'chat' || msg.t === 'ann' || msg.t === 'sys') {
      addToHistory(msg);
    }

    // Broadcast to all connected clients (including sender)
    const payload = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === 1 /* OPEN */) {
        try { client.send(payload); } catch (e) {}
      }
    }

    // Log to console
    const tag = msg.t === 'ann' ? '📣' : msg.t === 'sys' ? '·' : '💬';
    const who = msg.user ? `[${msg.user}]` : '';
    console.log(`${tag} ${who} ${msg.text || ''}`);
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[-] Client disconnected  (${clients.size} online)`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

// ── Start ──
httpServer.listen(WS_PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════╗');
  console.log('  ║       Moon Stash Chat Server     ║');
  console.log('  ╚══════════════════════════════════╝');
  console.log(`  ● Running on port  ${WS_PORT}`);
  console.log(`  ● Open in browser: http://localhost:${WS_PORT}`);
  console.log(`  ● WebSocket:       ws://localhost:${WS_PORT}`);
  console.log('  ● Chat is isolated to this server only');
  console.log('');
});
