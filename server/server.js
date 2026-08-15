// ---------------------------------------------------------------------------
// Servidor do jogo de carro 3D (HTTP estático + WebSocket, na mesma porta)
// ---------------------------------------------------------------------------
// Este processo cuida de duas coisas ao mesmo tempo:
//   1) Servir os arquivos do jogo (index.html, src/, assets/) por HTTP —
//      basta abrir http://localhost:8080 no navegador.
//   2) Repassar (relay) a posição/estado de cada carro para todos os outros
//      jogadores conectados via WebSocket. Não há física nem validação de
//      jogo no servidor — cada cliente continua simulando o próprio carro
//      localmente (modelo "client-authoritative", o mais simples para um
//      protótipo).
//
// Como rodar:
//   cd server
//   npm install
//   npm start
//   -> abrir http://localhost:8080
//
// Porta configurável via variável de ambiente PORT (padrão 8080). Como o
// HTTP e o WebSocket compartilham a mesma porta, o cliente não precisa de
// nenhuma configuração extra: ele sempre se conecta ao mesmo host:porta de
// onde a página foi carregada.
// ---------------------------------------------------------------------------

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// Raiz dos arquivos do jogo = pasta do projeto, um nível acima de server/
// (onde ficam index.html, src/ e assets/).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// Servidor HTTP: arquivos estáticos do jogo
// ---------------------------------------------------------------------------

function resolveSafePath(urlPath) {
  // Remove querystring/hash e normaliza; "/" vira index.html.
  const cleanPath = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_ROOT, relativePath);

  // Protege contra path traversal (ex.: "/../../etc/passwd").
  if (!resolved.startsWith(PUBLIC_ROOT)) return null;
  return resolved;
}

async function serveStatic(req, res) {
  let filePath = resolveSafePath(req.url);
  if (!filePath) {
    res.writeHead(400);
    res.end('Requisição inválida.');
    return;
  }

  // Se for uma pasta, tenta servir o index.html dela.
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Arquivo não encontrado.');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  createReadStream(filePath).pipe(res);
}

const httpServer = createServer((req, res) => {
  serveStatic(req, res).catch((err) => {
    console.error('Erro ao servir arquivo estático:', err);
    res.writeHead(500);
    res.end('Erro interno do servidor.');
  });
});

// ---------------------------------------------------------------------------
// Servidor WebSocket: multiplayer (anexado ao MESMO servidor HTTP/porta)
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ server: httpServer });

// id -> { id, car, ws, position, heading, speed, gear, isDrifting }
const players = new Map();

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// Envia para todos os jogadores conectados, exceto (opcionalmente) um.
function broadcast(payload, exceptId) {
  const data = JSON.stringify(payload);
  players.forEach((player) => {
    if (player.id === exceptId) return;
    if (player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(data);
    }
  });
}

wss.on('connection', (ws) => {
  // Cada conexão só vira um "jogador" de fato quando manda 'join' (isto é,
  // quando o jogador seleciona um carro no menu) — antes disso, guardamos
  // apenas o socket cru.
  ws.playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // mensagem inválida, ignora
    }

    if (msg.type === 'join') {
      // Um mesmo socket só pode entrar uma vez.
      if (ws.playerId) return;

      const id = randomUUID();
      ws.playerId = id;

      const player = {
        id,
        car: typeof msg.car === 'string' ? msg.car : 'mustang',
        ws,
        position: { x: 0, y: 0, z: 0 },
        heading: 0,
        speed: 0,
        gear: 1,
        isDrifting: false,
      };
      players.set(id, player);

      // Avisa o próprio jogador quem é ele e quem já está na sala.
      send(ws, {
        type: 'welcome',
        id,
        players: Array.from(players.values())
          .filter((p) => p.id !== id)
          .map((p) => ({
            id: p.id,
            car: p.car,
            position: p.position,
            heading: p.heading,
          })),
      });

      // Avisa todo mundo que um novo jogador entrou.
      broadcast({ type: 'player-joined', id, car: player.car }, id);

      console.log(`[+] ${id} entrou (carro: ${player.car}). Total: ${players.size}`);
      return;
    }

    if (msg.type === 'state') {
      const player = players.get(ws.playerId);
      if (!player) return; // ainda não fez 'join'

      player.position = msg.position ?? player.position;
      player.heading = typeof msg.heading === 'number' ? msg.heading : player.heading;
      player.speed = typeof msg.speed === 'number' ? msg.speed : player.speed;
      player.gear = msg.gear ?? player.gear;
      player.isDrifting = !!msg.isDrifting;

      // Repassa direto para os outros — sem guardar fila nem esperar tick,
      // já que cada cliente já manda no seu próprio intervalo controlado.
      broadcast(
        {
          type: 'state',
          id: player.id,
          position: player.position,
          heading: player.heading,
          speed: player.speed,
          gear: player.gear,
          isDrifting: player.isDrifting,
        },
        player.id
      );
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.playerId) return;
    players.delete(ws.playerId);
    broadcast({ type: 'player-left', id: ws.playerId });
    console.log(`[-] ${ws.playerId} saiu. Total: ${players.size}`);
  });

  ws.on('error', (err) => {
    console.warn('Erro de conexão WebSocket:', err.message);
  });
});

console.log(`Arquivos do jogo servidos a partir de: ${PUBLIC_ROOT}`);
httpServer.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}  (WebSocket na mesma porta)`);
});
