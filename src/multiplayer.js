import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------------------------------------------------------------------------
// Cliente de multiplayer
// ---------------------------------------------------------------------------
// Conecta ao servidor WebSocket (server/server.js) assim que o jogador
// seleciona um carro, e cuida de:
//   - Mandar o próprio estado (posição/heading/marcha/etc) periodicamente.
//   - Criar/remover/mover os carros dos outros jogadores conectados.
// Os carros remotos NÃO rodam a física local — eles só interpolam
// suavemente entre as últimas posições recebidas do servidor, então o
// movimento fica fluido mesmo com poucos pacotes por segundo.
// ---------------------------------------------------------------------------

// Endereço do servidor WebSocket. Como o servidor Node (server/server.js)
// agora serve o próprio jogo por HTTP e o WebSocket na MESMA porta, o
// cliente simplesmente se conecta ao mesmo host:porta de onde a página foi
// carregada (location.host já inclui a porta) — nenhuma configuração extra
// é necessária, mesmo se você mudar a porta via variável de ambiente PORT
// no servidor.
const WS_PROTOCOL = location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${location.host}`;

// Quantas vezes por segundo mandamos nosso próprio estado para o servidor.
const STATE_SEND_INTERVAL_MS = 50; // ~20x/s

// Velocidade de interpolação dos carros remotos (1/s). Quanto maior, mais
// "colado" nos dados recebidos (menos suave); quanto menor, mais atraso
// visual mas movimento mais fluido entre dois pacotes.
const INTERP_SPEED = 10;

const gltfLoader = new GLTFLoader();

// id (string) -> { group, targetPos, targetHeading, currentHeading, nameTag }
const remotePlayers = new Map();

let socket = null;
let localId = null;
let sceneRef = null;
let carCatalogRef = null;
let getLocalStateFn = null;
let onCountChangeFn = null;
let lastSendTime = 0;
let connectionStatus = 'disconnected'; // 'connecting' | 'connected' | 'disconnected'
let onStatusChangeFn = null;

function setStatus(status) {
  connectionStatus = status;
  if (onStatusChangeFn) onStatusChangeFn(status);
}

function notifyCount() {
  if (onCountChangeFn) onCountChangeFn(remotePlayers.size);
}

// Monta o modelo 3D de um carro remoto, reaproveitando o mesmo catálogo
// (CAR_CATALOG) e a mesma lógica de normalização de escala/pivô usada para
// o carro do próprio jogador em main.js.
function buildCarModel(carKey, group) {
  const config = carCatalogRef[carKey] || carCatalogRef[Object.keys(carCatalogRef)[0]];
  if (!config) return;

  gltfLoader.load(
    config.modelPath,
    (gltf) => {
      const model = gltf.scene;
      model.rotation.x = config.rotationX;
      model.rotation.y = config.rotationY;

      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const horizontalSize = Math.max(size.x, size.z);
      if (horizontalSize > 0) {
        model.scale.setScalar(config.targetLength / horizontalSize);
      }

      const groundedBox = new THREE.Box3().setFromObject(model);
      model.position.y -= groundedBox.min.y;

      group.add(model);

      // Mesma lógica do carro local (ver loadDriverPet em main.js): se
      // este carro tiver um passageiro fixo configurado (ex.: a Mel no
      // Porsche), carrega e prende ele no grupo do carro remoto, que já é
      // interpolado/movido pelo tick() abaixo — sem lógica extra.
      buildDriverPet(config, group);
    },
    undefined,
    (error) => {
      console.error(`Erro ao carregar carro remoto (${carKey}):`, error);
    }
  );
}

function buildDriverPet(config, group) {
  const petConfig = config.driverPet;
  if (!petConfig) return;

  gltfLoader.load(
    petConfig.modelPath,
    (gltf) => {
      const pet = gltf.scene;
      pet.rotation.y = petConfig.rotationY ?? 0;

      pet.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      const box = new THREE.Box3().setFromObject(pet);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.y > 0) {
        pet.scale.setScalar(petConfig.height / size.y);
      }

      const groundedBox = new THREE.Box3().setFromObject(pet);
      const seat = petConfig.seat;
      pet.position.set(seat.x, seat.y - groundedBox.min.y, seat.z);

      group.add(pet);
    },
    undefined,
    (error) => {
      console.error(`Erro ao carregar passageiro remoto (${petConfig.modelPath}):`, error);
    }
  );
}

function addRemotePlayer(id, carKey, position, heading) {
  if (id === localId || remotePlayers.has(id)) return;

  const group = new THREE.Group();
  group.position.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
  group.rotation.y = heading ?? 0;
  sceneRef.add(group);
  buildCarModel(carKey, group);

  remotePlayers.set(id, {
    group,
    targetPos: new THREE.Vector3(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0),
    targetHeading: heading ?? 0,
    currentHeading: heading ?? 0,
  });

  notifyCount();
}

function updateRemotePlayer(msg) {
  const player = remotePlayers.get(msg.id);
  if (!player) return; // pode chegar um 'state' de alguém que ainda não processamos o 'player-joined'
  if (msg.position) player.targetPos.set(msg.position.x, msg.position.y, msg.position.z);
  if (typeof msg.heading === 'number') player.targetHeading = msg.heading;
}

function removeRemotePlayer(id) {
  const player = remotePlayers.get(id);
  if (!player) return;
  sceneRef.remove(player.group);
  remotePlayers.delete(id);
  notifyCount();
}

function clearAllRemotePlayers() {
  remotePlayers.forEach((player) => sceneRef.remove(player.group));
  remotePlayers.clear();
  notifyCount();
}

// Interpola ângulos pelo caminho mais curto (evita o carro "girar a volta
// toda" ao cruzar de -PI para +PI, por exemplo).
function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

/**
 * Conecta ao servidor multiplayer. Deve ser chamada assim que o jogador
 * seleciona um carro no menu.
 *
 * @param {object} opts
 * @param {THREE.Scene} opts.scene - cena onde os carros remotos serão adicionados
 * @param {string} opts.carKey - chave do carro escolhido (ex.: 'mustang')
 * @param {object} opts.carCatalog - o mesmo CAR_CATALOG usado para o carro local
 * @param {() => object} opts.getLocalState - função que retorna o estado atual do carro local
 * @param {(count: number) => void} [opts.onCountChange] - chamado quando o nº de outros jogadores muda
 * @param {(status: string) => void} [opts.onStatusChange] - chamado quando o status da conexão muda
 * @returns {(dt: number) => void} função de tick, para chamar a cada frame do loop de animação
 */
export function connectMultiplayer({
  scene,
  carKey,
  carCatalog,
  getLocalState,
  onCountChange,
  onStatusChange,
}) {
  sceneRef = scene;
  carCatalogRef = carCatalog;
  getLocalStateFn = getLocalState;
  onCountChangeFn = onCountChange;
  onStatusChangeFn = onStatusChange;

  // Se já havia uma conexão anterior (ex.: jogador trocou de carro e voltou
  // a jogar), fecha antes de abrir uma nova.
  if (socket) {
    socket.close();
    socket = null;
  }
  clearAllRemotePlayers();
  localId = null;
  lastSendTime = 0;

  setStatus('connecting');

  try {
    socket = new WebSocket(WS_URL);
  } catch (err) {
    console.warn('Não foi possível abrir o WebSocket do multiplayer:', err);
    setStatus('disconnected');
    return () => {};
  }

  socket.addEventListener('open', () => {
    setStatus('connected');
    socket.send(JSON.stringify({ type: 'join', car: carKey }));
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'welcome':
        localId = msg.id;
        (msg.players || []).forEach((p) => addRemotePlayer(p.id, p.car, p.position, p.heading));
        break;
      case 'player-joined':
        addRemotePlayer(msg.id, msg.car);
        break;
      case 'state':
        updateRemotePlayer(msg);
        break;
      case 'player-left':
        removeRemotePlayer(msg.id);
        break;
      default:
        break;
    }
  });

  socket.addEventListener('close', () => {
    setStatus('disconnected');
    clearAllRemotePlayers();
  });

  socket.addEventListener('error', () => {
    // 'close' é disparado logo em seguida, então só logamos aqui.
    console.warn('Erro na conexão com o servidor multiplayer. O jogo continua em modo local.');
  });

  // Função de tick: chame a cada frame (dentro do requestAnimationFrame),
  // passando o dt do frame. Ela cuida de interpolar os carros remotos e de
  // mandar nosso próprio estado no intervalo configurado.
  return function tick(dt) {
    const t = 1 - Math.exp(-INTERP_SPEED * dt);
    remotePlayers.forEach((player) => {
      player.group.position.lerp(player.targetPos, t);
      player.currentHeading = lerpAngle(player.currentHeading, player.targetHeading, t);
      player.group.rotation.y = player.currentHeading;
    });

    if (!socket || socket.readyState !== WebSocket.OPEN || !getLocalStateFn) return;

    lastSendTime += dt * 1000;
    if (lastSendTime < STATE_SEND_INTERVAL_MS) return;
    lastSendTime = 0;

    socket.send(JSON.stringify({ type: 'state', ...getLocalStateFn() }));
  };
}

/** Fecha a conexão multiplayer e remove todos os carros remotos da cena. */
export function disconnectMultiplayer() {
  if (socket) {
    socket.close();
    socket = null;
  }
  clearAllRemotePlayers();
  setStatus('disconnected');
}

export function getConnectionStatus() {
  return connectionStatus;
}

export function getRemotePlayerCount() {
  return remotePlayers.size;
}