import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { connectMultiplayer, disconnectMultiplayer } from './multiplayer.js';

// ---------------------------------------------------------------------------
// Configuração básica de cena, câmera e renderer
// ---------------------------------------------------------------------------

const app = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const speedEl = document.getElementById('speed');
const gearDisplayEl = document.getElementById('gear-display');
const rpmValueEl = document.getElementById('rpm-value');
const rpmBarFillEl = document.getElementById('rpm-bar-fill');
const resetBtn = document.getElementById('reset-btn');
const changeCarBtn = document.getElementById('change-car-btn');
const carSelectEl = document.getElementById('car-select');
const hudEl = document.getElementById('hud');
const controlsHintEl = document.getElementById('controls-hint');
const topBarEl = document.getElementById('top-bar');
const mpStatusEl = document.getElementById('mp-status');
const mpStatusTextEl = document.getElementById('mp-status-text');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3f4);
scene.fog = new THREE.Fog(0x8fd3f4, 60, 220);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 3, -6.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Iluminação básica
// ---------------------------------------------------------------------------

const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

// Luz hemisférica: clareia o lado "de sombra" dos objetos com um tom de céu
// por cima e um tom de grama por baixo, evitando que o carro fique escuro
// demais do lado oposto ao sol.
const hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x4c9a2a, 0.8);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
sunLight.position.set(50, 80, -30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.camera.far = 300;
scene.add(sunLight);

// ---------------------------------------------------------------------------
// Chão
// ---------------------------------------------------------------------------

const GROUND_SIZE = 500;
// Metade do tamanho da área onde o carro pode andar (deixa uma margem até
// a borda real do chão, onde ficam os postes de limite).
const PLAY_BOUND = GROUND_SIZE / 2 - 20;
const ROAD_WIDTH = 10; // avenidas principais (cruz que passa pelo centro)
const SECONDARY_ROAD_WIDTH = 7; // ruas secundárias da malha viária
// Deslocamentos (em unidades do mundo) das ruas secundárias em relação ao
// centro, tanto no eixo X (ruas norte-sul) quanto no eixo Z (ruas leste-
// oeste). Ajuste este array para adicionar/remover ruas ou mudar o
// espaçamento da malha.
const SECONDARY_ROAD_OFFSETS = [-180, -120, -60, 60, 120, 180];
// Raio externo/interno da rotatória central. O anel de asfalto fica entre
// os dois raios; a ilha (grama + decoração) fica dentro do raio interno.
const ROUNDABOUT_OUTER_RADIUS = 19;
const ROUNDABOUT_INNER_RADIUS = 9;
// Ponto de partida/reinício do carro: numa das avenidas, alguns metros ao
// sul da rotatória (que agora ocupa a origem (0,0)), para não nascer em
// cima da ilha/monumento central.
const CAR_SPAWN_Z = -(ROUNDABOUT_OUTER_RADIUS + 20);

const groundGeometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4c9a2a });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Grade simples só para dar noção de movimento/escala
const grid = new THREE.GridHelper(GROUND_SIZE, 100, 0x2f6e1a, 0x2f6e1a);
grid.position.y = 0.01;
scene.add(grid);

// ---------------------------------------------------------------------------
// Cenário: malha de ruas, rotatória, árvores, pedras, prédios e cerca de
// limite
// ---------------------------------------------------------------------------

function createRoad() {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 });
  const laneMat = new THREE.MeshStandardMaterial({ color: 0xf2e9c9 });

  const roadLength = PLAY_BOUND * 2 + 10;
  const dashLength = 3;
  const dashGap = 2.5;
  const dashWidth = 0.22;

  // Desenha uma faixa de asfalto reta, orientada ao longo do eixo Z ou X, e
  // sua linha central tracejada (pulando qualquer trecho que caia dentro da
  // rotatória central ou muito perto dela).
  function buildStraightRoad(axis, offset, width) {
    const geometry =
      axis === 'ns'
        ? new THREE.PlaneGeometry(width, roadLength)
        : new THREE.PlaneGeometry(roadLength, width);
    const road = new THREE.Mesh(geometry, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.015;
    if (axis === 'ns') {
      road.position.x = offset;
    } else {
      road.position.z = offset;
    }
    road.receiveShadow = true;
    scene.add(road);

    for (let pos = -roadLength / 2; pos < roadLength / 2; pos += dashLength + dashGap) {
      // Não desenha tracejado dentro/perto da rotatória central, nem no
      // pequeno trecho onde esta rua cruza a outra avenida principal.
      const distFromCenter = axis === 'ns' ? Math.hypot(offset, pos) : Math.hypot(pos, offset);
      if (distFromCenter < ROUNDABOUT_OUTER_RADIUS + 2) continue;
      if (Math.abs(pos) < width) continue;

      const dash = new THREE.Mesh(
        axis === 'ns'
          ? new THREE.PlaneGeometry(dashWidth, dashLength)
          : new THREE.PlaneGeometry(dashLength, dashWidth),
        laneMat
      );
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(axis === 'ns' ? offset : pos, 0.02, axis === 'ns' ? pos : offset);
      scene.add(dash);
    }
  }

  // Duas avenidas principais em cruz, passando pelo centro (norte-sul e
  // leste-oeste) — a rotatória (createRoundabout) cobre visualmente o
  // cruzamento entre elas.
  buildStraightRoad('ns', 0, ROAD_WIDTH);
  buildStraightRoad('ew', 0, ROAD_WIDTH);

  // Malha adicional de ruas secundárias, paralelas às avenidas principais.
  SECONDARY_ROAD_OFFSETS.forEach((offset) => {
    buildStraightRoad('ns', offset, SECONDARY_ROAD_WIDTH);
    buildStraightRoad('ew', offset, SECONDARY_ROAD_WIDTH);
  });
}

// Rotatória no centro do mapa: anel de asfalto (por onde o carro dá a
// volta), guia de faixa central, meio-fio e uma ilha de grama decorada no
// meio, cobrindo o cruzamento das duas avenidas principais.
function createRoundabout() {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.9 });
  const laneMat = new THREE.MeshStandardMaterial({ color: 0xf2e9c9 });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xe6e2d8 });
  const islandMat = new THREE.MeshStandardMaterial({ color: 0x3f8a24 });

  // Anel de asfalto da rotatória, sobreposto ao cruzamento das avenidas.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(ROUNDABOUT_INNER_RADIUS, ROUNDABOUT_OUTER_RADIUS, 64),
    roadMat
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.017;
  ring.receiveShadow = true;
  scene.add(ring);

  // Guia de faixa: um círculo fino no meio do anel, ajudando o jogador a
  // perceber o raio ideal da curva.
  const midRadius = (ROUNDABOUT_INNER_RADIUS + ROUNDABOUT_OUTER_RADIUS) / 2;
  const laneGuide = new THREE.Mesh(
    new THREE.RingGeometry(midRadius - 0.15, midRadius + 0.15, 64),
    laneMat
  );
  laneGuide.rotation.x = -Math.PI / 2;
  laneGuide.position.y = 0.019;
  scene.add(laneGuide);

  // Meio-fio ao redor da ilha central.
  const curb = new THREE.Mesh(
    new THREE.RingGeometry(ROUNDABOUT_INNER_RADIUS - 0.5, ROUNDABOUT_INNER_RADIUS, 64),
    curbMat
  );
  curb.rotation.x = -Math.PI / 2;
  curb.position.y = 0.02;
  scene.add(curb);

  // Ilha de grama no centro.
  const island = new THREE.Mesh(
    new THREE.CircleGeometry(ROUNDABOUT_INNER_RADIUS - 0.5, 48),
    islandMat
  );
  island.rotation.x = -Math.PI / 2;
  island.position.y = 0.021;
  island.receiveShadow = true;
  scene.add(island);

  // Pequeno "monumento" decorativo (chafariz estilizado) no centro da ilha.
  const monument = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 2.6, 0.6, 16),
    new THREE.MeshStandardMaterial({ color: 0xb9b2a3 })
  );
  base.position.y = 0.3;
  base.castShadow = true;
  base.receiveShadow = true;
  monument.add(base);

  const pillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.45, 2.2, 12),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad })
  );
  pillar.position.y = 1.3;
  pillar.castShadow = true;
  monument.add(pillar);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xf2c245, metalness: 0.2, roughness: 0.4 })
  );
  orb.position.y = 2.75;
  orb.castShadow = true;
  monument.add(orb);

  monument.position.set(0, 0, 0);
  scene.add(monument);

  // Algumas árvores pequenas distribuídas pela ilha, ao redor do monumento.
  const treeCount = 6;
  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2;
    const radius = (ROUNDABOUT_INNER_RADIUS - 0.5) * 0.6;
    createTree(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
}

function isOnRoad(x, z) {
  const mainMargin = ROAD_WIDTH / 2 + 1.5;
  if (Math.abs(x) < mainMargin || Math.abs(z) < mainMargin) return true;

  const secondaryMargin = SECONDARY_ROAD_WIDTH / 2 + 1.5;
  for (const offset of SECONDARY_ROAD_OFFSETS) {
    if (Math.abs(x - offset) < secondaryMargin) return true;
    if (Math.abs(z - offset) < secondaryMargin) return true;
  }

  if (Math.hypot(x, z) < ROUNDABOUT_OUTER_RADIUS + 3) return true;

  return false;
}

function createTree(x, z) {
  const tree = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.22, 1.3, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4423 })
  );
  trunk.position.y = 0.65;
  trunk.castShadow = true;
  tree.add(trunk);

  const foliage = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 2.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d6a1f })
  );
  foliage.position.y = 2.1;
  foliage.castShadow = true;
  tree.add(foliage);

  tree.position.set(x, 0, z);
  tree.scale.setScalar(0.8 + Math.random() * 0.7);
  scene.add(tree);
}

function createRock(x, z) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.4 + Math.random() * 0.35, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, flatShading: true })
  );
  rock.position.set(x, 0.35, z);
  rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}

function createBuilding(x, z) {
  const width = 6 + Math.random() * 4;
  const depth = 6 + Math.random() * 4;
  const height = 5 + Math.random() * 8;
  const colors = [0xb5533c, 0xc9a86a, 0x9db4c0, 0xcbb9a8];

  const building = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color: colors[Math.floor(Math.random() * colors.length)] })
  );
  building.position.set(x, height / 2, z);
  building.castShadow = true;
  building.receiveShadow = true;
  scene.add(building);

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(Math.max(width, depth) * 0.72, 2.4, 4),
    new THREE.MeshStandardMaterial({ color: 0x5b3a29 })
  );
  roof.position.set(x, height + 1.2, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  scene.add(roof);
}

// Postes coloridos ao longo do perímetro da área jogável, indicando o limite
function createBoundaryFence() {
  const spacing = 20;
  const colors = [0xffffff, 0xd63b3b];
  let colorIndex = 0;

  function addPole(x, z) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: colors[colorIndex % 2] })
    );
    colorIndex++;
    pole.position.set(x, 0.7, z);
    pole.castShadow = true;
    scene.add(pole);
  }

  for (let x = -PLAY_BOUND; x <= PLAY_BOUND; x += spacing) {
    addPole(x, -PLAY_BOUND);
    addPole(x, PLAY_BOUND);
  }
  for (let z = -PLAY_BOUND; z <= PLAY_BOUND; z += spacing) {
    addPole(-PLAY_BOUND, z);
    addPole(PLAY_BOUND, z);
  }
}

function scatterScenery() {
  const spread = PLAY_BOUND * 2 - 20;

  // isOnRoad() já cobre avenidas, ruas secundárias e a rotatória central,
  // então basta esse único filtro para manter a vegetação fora de qualquer
  // via. O limite de tentativas foi aumentado porque a malha viária agora
  // ocupa uma fração maior da área jogável.
  let placed = 0;
  let attempts = 0;
  while (placed < 45 && attempts < 900) {
    attempts++;
    const x = THREE.MathUtils.randFloatSpread(spread);
    const z = THREE.MathUtils.randFloatSpread(spread);
    if (isOnRoad(x, z)) continue;
    createTree(x, z);
    placed++;
  }

  placed = 0;
  attempts = 0;
  while (placed < 20 && attempts < 400) {
    attempts++;
    const x = THREE.MathUtils.randFloatSpread(spread);
    const z = THREE.MathUtils.randFloatSpread(spread);
    if (isOnRoad(x, z)) continue;
    createRock(x, z);
    placed++;
  }

  const buildingSpots = [
    [45, 45], [-45, 45], [45, -45], [-45, -45],
    [95, 25], [-95, -25], [25, 95], [-25, -95],
  ];
  buildingSpots.forEach(([x, z]) => {
    if (!isOnRoad(x, z)) createBuilding(x, z);
  });
}

createRoad();
createRoundabout();
createBoundaryFence();
scatterScenery();

// ---------------------------------------------------------------------------
// Catálogo de carros disponíveis
// ---------------------------------------------------------------------------
// Cada carro tem seu próprio ajuste de rotação/escala (targetLength, em
// metros), já que modelos .glb diferentes costumam vir orientados e
// dimensionados de formas diferentes.

const CAR_CATALOG = {
  mustang: {
    modelPath: './assets/mustang.glb',
    rotationX: 0,
    // Ajuste este valor (radianos) se a frente do Mustang não apontar para
    // o sentido de movimento ao acelerar.
    rotationY: Math.PI,
    targetLength: 4.8,
  },
  palio: {
    modelPath: './assets/carro.glb',
    rotationX: 0,
    rotationY: 1.6,
    targetLength: 4.3,
  },
  porsche: {
    modelPath: './assets/porsche.glb',
    rotationX: 0,
    // Ajuste este valor (radianos) se a frente do Porsche não apontar para
    // o sentido de movimento ao acelerar.
    rotationY: Math.PI / 2,
    targetLength: 4.4,

    // ---------------------------------------------------------------------
    // "Passageiro" fixo no banco do motorista (a Mel). Opcional: um carro
    // sem essa chave simplesmente não carrega nenhum bichinho.
    // ---------------------------------------------------------------------
    driverPet: {
      modelPath: './assets/mel.glb',
      // Altura real da Mel sentada (do chão até a ponta da orelha), em
      // metros — usada para normalizar a escala do modelo, do mesmo jeito
      // que targetLength normaliza o comprimento do carro.
      height: 0.28,
      // O modelo da Mel já "olha" para o mesmo eixo que é a frente do
      // carro depois de virar filha do grupo `car` — então rotationY
      // normalmente fica em 0. Se ao testar ela aparecer de lado ou de
      // costas, ajuste este valor (radianos) em passos de Math.PI / 2.
      rotationY: 0,
      // Posição do banco do motorista dentro do habitáculo, em metros,
      // relativa ao centro do grupo `car` (mesmo espaço/escala em que o
      // corpo do carro é desenhado — x/z em metros reais, sem precisar
      // reconverter nada).
      //   x: negativo = lado esquerdo do carro (motorista, volante à
      //      esquerda); positivo = lado direito.
      //   y: altura do banco (onde as patas/traseira da Mel encostam).
      //   z: positivo = mais perto do para-brisa/frente do carro;
      //      negativo = mais perto do banco traseiro/tampa do porta-malas.
      // Estes três números são a ÚNICA coisa que você provavelmente vai
      // precisar ajustar visualmente (veja instruções no chat).
      seat: { x: -0.35, y: 0.42, z: -0.2 },
    },
  },
};

const car = new THREE.Group();
scene.add(car);

// ---------------------------------------------------------------------------
// Câmbio / RPM (marchas)
// ---------------------------------------------------------------------------
// Configuração central do câmbio. Ajuste livremente estes valores para
// deixar o carro mais rápido, mais agressivo, com marchas mais curtas etc.
// Nenhum outro lugar do código precisa mudar.
const GEARBOX = {
  // RPM de marcha lenta (carro parado, ligado) e RPM máximo (linha
  // vermelha / limitador) do motor.
  idleRpm: 900,
  maxRpm: 7000,

  // Referências de RPM "ideais" para trocar de marcha. A troca em si é
  // sempre manual (E/Q) — estes valores só são usados para colorir o
  // conta-giros do HUD (dica visual de quando trocar).
  shiftUpRpm: 6500,
  shiftDownRpm: 2500,

  // Marcha ré: mesma lógica das marchas para frente (RPM sobe com a
  // velocidade), só que numa faixa de velocidade e RPM bem mais curta.
  reverse: {
    maxSpeed: 10, // km/h
    minRpm: 900,
    maxRpm: 4500,
  },

  // Cada marcha define até que velocidade (km/h) ela "aguenta" e a faixa de
  // RPM correspondente: minRpm = RPM logo ao entrar na marcha (velocidade
  // baixa dentro dela), maxRpm = RPM ao chegar na velocidade máxima daquela
  // marcha (ponto em que o limitador passa a agir). "power" é um
  // multiplicador opcional de força de aceleração por marcha (1 = padrão);
  // marchas mais altas puxam um pouco mais fraco, como um motor real com
  // menos torque disponível nas relações mais longas.
  gears: [
    { gear: 1, maxSpeed: 45, minRpm: 1000, maxRpm: 7000, power: 1.25 },
    { gear: 2, maxSpeed: 75, minRpm: 1800, maxRpm: 7000, power: 1.1 },
    { gear: 3, maxSpeed: 110, minRpm: 2200, maxRpm: 7000, power: 0.95 },
    { gear: 4, maxSpeed: 145, minRpm: 2500, maxRpm: 7000, power: 0.85 },
    { gear: 5, maxSpeed: 190, minRpm: 2800, maxRpm: 7000, power: 0.7 },
  ],

  // --- Limitador de RPM ("corte de giro") ---
  // Quando o motor bate no limite, o RPM exibido oscila entre maxRpm e
  // (maxRpm - limiterDrop), numa frequência de limiterFrequency oscilações
  // por segundo — simulando o corte de combustível/ignição em vez de
  // simplesmente travar em 7000.
  limiterDrop: 550,
  limiterFrequency: 9,

  // Tolerância de RPM permitida acima do "limite natural" da marcha antes do
  // limitador entrar com tudo — dá uma pequena folga para reduções
  // agressivas de marcha sem que o motor "exploda" instantaneamente.
  overRevTolerance: 0.12, // 12% acima da velocidade máxima da marcha

  // Se uma redução de marcha deixar o carro "acima" da velocidade máxima da
  // marcha atual, esta força (em unid/s por unid/s de excesso) puxa a
  // velocidade de volta ao limite da marcha de forma suave (arrasto do
  // motor), em vez de travar/teleportar a velocidade instantaneamente.
  overshootDrag: 3.5,
};

// Índice especial de marcha usado para representar a ré no carState.gear.
const REVERSE_GEAR = 0;

function kmhToUnid(kmh) {
  return kmh / 3.6;
}

function getForwardGearConfig(gear) {
  return GEARBOX.gears[gear - 1];
}

// Calcula o RPM "bruto" (antes do limitador) para a marcha e velocidade
// atuais. A fração de velocidade pode passar de 1 quando o carro está
// momentaneamente acima da velocidade máxima daquela marcha (por exemplo,
// logo após reduzir uma marcha em alta velocidade) — é isso que permite o
// limitador entrar em ação nessas situações também.
function computeRawRpm(gear, speedKmh) {
  const cfg = gear === REVERSE_GEAR ? GEARBOX.reverse : getForwardGearConfig(gear);
  const fraction = THREE.MathUtils.clamp(
    speedKmh / cfg.maxSpeed,
    0,
    1 + GEARBOX.overRevTolerance
  );
  return THREE.MathUtils.lerp(cfg.minRpm, cfg.maxRpm, fraction);
}

function shiftUp() {
  if (!isGameStarted || carState.gear === REVERSE_GEAR) return;
  carState.gear = Math.min(carState.gear + 1, GEARBOX.gears.length);
}

function shiftDown() {
  if (!isGameStarted || carState.gear === REVERSE_GEAR) return;
  // Não permite reduzir abaixo da 1ª enquanto andando para frente; a ré é
  // acessada separadamente (S com o carro quase parado), não pelo Q.
  carState.gear = Math.max(carState.gear - 1, 1);
}

// Estrutura preparada para o som do motor depender do RPM no futuro. Por
// enquanto é um no-op: não há sistema de áudio no jogo ainda. Quando houver
// (ex.: um <audio>/AudioBufferSourceNode em loop para o motor), basta setar
// algo como:
//   let engineSound; // referência ao elemento/nó de áudio do motor
//   function updateEngineAudio(rpmFraction) {
//     if (!engineSound) return;
//     engineSound.playbackRate = 0.5 + rpmFraction * 1.5;
//   }
function updateEngineAudio(_rpmFraction) {
  // Intencionalmente vazio por enquanto — ver comentário acima.
}

// Atualiza o indicador de marcha e o conta-giros do HUD a partir do
// carState atual (chamado uma vez por quadro, depois da física).
function updateGearHud() {
  gearDisplayEl.textContent = carState.gear === REVERSE_GEAR ? 'R' : String(carState.gear);
  rpmValueEl.textContent = Math.round(carState.rpm);

  const rpmFraction = THREE.MathUtils.clamp(carState.rpm / GEARBOX.maxRpm, 0, 1);
  rpmBarFillEl.style.width = `${rpmFraction * 100}%`;

  gearDisplayEl.classList.toggle('limiter', carState.rpmLimiterActive);
  rpmBarFillEl.classList.toggle('limiter', carState.rpmLimiterActive);
}

function updateAutomaticTransmission(speedKmh, rpmValue) {
  if (!isTouchDevice || !isGameStarted || carState.gear === REVERSE_GEAR) return;

  const now = performance.now();
  const currentGearCfg = getForwardGearConfig(carState.gear);
  const shouldShiftUp =
    carState.gear < GEARBOX.gears.length &&
    rpmValue >= GEARBOX.shiftUpRpm * 0.92 &&
    speedKmh > 18 &&
    now - lastAutoShiftAt >= AUTO_SHIFT_COOLDOWN_MS;

  const shouldShiftDown =
    carState.gear > 1 &&
    rpmValue <= GEARBOX.shiftDownRpm * 1.15 &&
    speedKmh < currentGearCfg.maxSpeed * 0.55 &&
    now - lastAutoShiftAt >= AUTO_SHIFT_COOLDOWN_MS;

  if (shouldShiftUp) {
    carState.gear = Math.min(carState.gear + 1, GEARBOX.gears.length);
    lastAutoShiftAt = now;
    return;
  }

  if (shouldShiftDown) {
    carState.gear = Math.max(carState.gear - 1, 1);
    lastAutoShiftAt = now;
  }
}

const carState = {
  position: new THREE.Vector3(0, 0, CAR_SPAWN_Z),
  heading: 0, // ângulo em radianos (yaw) — para onde o carro está apontando
  // Velocidade real do veículo no espaço do mundo (não apenas um escalar).
  // A cada frame ela é decomposta em componente longitudinal (na direção
  // em que o carro aponta) e lateral (perpendicular a essa direção). É essa
  // separação que permite o carro "apontar" para um lado enquanto ainda se
  // desloca fisicamente para outro — a essência do drift.
  velocity: new THREE.Vector3(0, 0, 0),
  // Guardados só para o HUD / efeitos visuais (recalculados todo frame):
  longitudinalSpeed: 0,
  lateralSpeed: 0,
  isDrifting: false,
  // --- Câmbio / motor ---
  gear: 1, // 1..5 para frente, REVERSE_GEAR (0) para ré
  rpm: GEARBOX.gears[0].minRpm,
  rpmLimiterActive: false,
  limiterPhase: 0, // fase acumulada da oscilação do limitador de giro
};

// ---------------------------------------------------------------------------
// Parâmetros de física do carro (arcade drift)
// ---------------------------------------------------------------------------
// Ajuste estes valores livremente para deixar o drift mais fácil/difícil,
// o carro mais ágil/pesado etc. Nenhum outro lugar do código precisa mudar.
const CAR_PHYSICS = {
  // --- Aceleração / freio / ré ---
  // Ganho base de velocidade longitudinal (unid/s²) ao segurar W. O valor
  // real usado a cada frame é multiplicado pelo "power" da marcha atual
  // (ver GEARBOX) e tende a 0 conforme o carro se aproxima da velocidade
  // máxima daquela marcha (ver taper em updateCar) — por isso não é mais um
  // "muro invisível", e sim uma queda natural de potência.
  acceleration: 16,
  brakeStrength: 26,       // desaceleração ao segurar S enquanto o carro ainda anda para frente
  // Ganho base de velocidade em ré ao segurar S com o carro já parado/
  // recuando. Sofre o mesmo taper de aproximação do limite (GEARBOX.reverse).
  reverseAcceleration: 9,

  // Velocidade máxima absoluta (unid/s), só como rede de segurança contra
  // bugs/valores estranhos — na prática, quem limita a velocidade é sempre
  // a marcha atual (GEARBOX.gears[].maxSpeed / GEARBOX.reverse.maxSpeed).
  // Definida acima do topo da 5ª marcha (190 km/h ≈ 52.8 unid/s).
  absoluteSafetySpeed: 60,
  absoluteSafetyReverseSpeed: -kmhToUnid(GEARBOX.reverse.maxSpeed) * 1.5,

  // Referência de velocidade usada apenas para a "sensação" de direção
  // (quanto a direção fica mais dura em alta velocidade). Mantida fixa e
  // independente da marcha atual para não alterar a física de direção já
  // existente ao trocar de marcha.
  steeringReferenceSpeed: 26,

  // --- Direção ---
  // Velocidade de giro do heading (rad/s) quando o carro está na velocidade
  // máxima. Em baixa velocidade a direção é sempre mais responsiva (ver
  // speedFactor dentro de updateCar); em alta velocidade ela se aproxima
  // deste valor, tornando curvas fechadas mais difíceis.
  steeringStrength: 3.6,

  // --- Aderência (grip) ---
  // Taxa (1/s) com que a velocidade LATERAL é "puxada" de volta a zero em
  // condução normal (sem freio de mão). Valores altos = pneus grudam rápido
  // no chão = pouca derrapagem. Valores baixos = carro escorrega mais.
  lateralGrip: 9,
  // Alias de lateralGrip usado como referência geral de aderência das rodas
  // dianteiras/condução normal (mantido separado para facilitar tuning fino
  // caso queira, no futuro, diferenciar grip dianteiro de traseiro).
  grip: 9,

  // --- Freio de mão (handbrake) ---
  // Com SPACE pressionado, a aderência lateral cai para este valor (bem
  // menor que lateralGrip): a traseira "solta" e o carro passa a escorregar
  // de lado, controlável com A/D. Baixe este valor para derrapagens mais
  // longas e fáceis de segurar; suba para drifts mais curtos e nervosos.
  handbrakeGrip: 1.6,
  // Desaceleração longitudinal extra aplicada enquanto o freio de mão está
  // pressionado (o carro perde velocidade gradualmente durante o drift).
  handbrakeBrake: 10,

  // Multiplicador extra de velocidade de giro aplicado ao heading enquanto
  // o freio de mão está pressionado. É o que dá ao jogador controle sobre o
  // ÂNGULO do drift (incluindo contra-esterço) em vez de o carro girar de
  // forma passiva. Suba para um drift mais "manobrável", desça para um
  // drift mais preguiçoso/pesado.
  driftControl: 1.9,

  // Desaceleração natural da velocidade longitudinal quando nem W nem S
  // estão pressionados (equivalente ao antigo "friction").
  rollingResistance: 6,

  // --- Marcas de pneu no esterço máximo ---
  // Quando o volante (ou A/D no teclado) está girado no limite E o carro
  // está em movimento, os pneus deixam marca mesmo sem o freio de mão —
  // simula o pneu "raspando" no esterço máximo.
  maxSteerSkidThreshold: 0.92, // fração (0..1) do esterço máximo a partir da qual já deixa marca
  maxSteerSkidMinSpeed: 3, // unid/s mínimos para considerar que há marca (evita marca parado)
};

const loader = new GLTFLoader();
let carModel = null;
// Modelo do "passageiro" fixo no banco do motorista (ex.: a Mel), quando o
// carro atual tiver um `driverPet` configurado no CAR_CATALOG.
let petModel = null;
let isGameStarted = false;
const AUTO_SHIFT_COOLDOWN_MS = 500;
let lastAutoShiftAt = 0;
// Guarda o config do carro atual (usado só para aproximar a posição das
// rodas traseiras nos efeitos visuais de drift).
let currentCarConfig = CAR_CATALOG.mustang;

function loadCar(carKey) {
  const config = CAR_CATALOG[carKey];
  if (!config) {
    console.error('Carro desconhecido:', carKey);
    return;
  }
  currentCarConfig = config;

  loadingEl.style.display = 'flex';
  loadingEl.textContent = 'Carregando modelo do carro...';

  loader.load(
    config.modelPath,
    (gltf) => {
      // Remove o modelo anterior, caso o jogador tenha trocado de carro
      if (carModel) {
        car.remove(carModel);
      }

      carModel = gltf.scene;

      // 1) Corrige a orientação (eixo "para cima" e frente do carro)
      carModel.rotation.x = config.rotationX;
      carModel.rotation.y = config.rotationY;

      carModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      // 2) Normaliza a escala com base no tamanho real do modelo já rotacionado
      const box = new THREE.Box3().setFromObject(carModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const horizontalSize = Math.max(size.x, size.z);
      if (horizontalSize > 0) {
        const scale = config.targetLength / horizontalSize;
        carModel.scale.setScalar(scale);
      }

      // 3) Reposiciona verticalmente para que a base do carro encoste no chão
      //    (compensa pivôs de modelo que não ficam nas rodas)
      const groundedBox = new THREE.Box3().setFromObject(carModel);
      carModel.position.y -= groundedBox.min.y;

      car.add(carModel);
      loadingEl.style.display = 'none';

      // Carrega (ou remove, se o novo carro não tiver um) o passageiro fixo
      // no banco do motorista. Feito depois do carModel para a Mel ficar
      // desenhada por cima/à frente dele na hierarquia da cena.
      loadDriverPet(config);

      resetCar();
      startGame();
    },
    undefined,
    (error) => {
      console.error(`Erro ao carregar ${config.modelPath}:`, error);
      loadingEl.textContent =
        'Erro ao carregar o modelo do carro. Verifique se o arquivo está na pasta assets/.';
    }
  );
}

// -----------------------------------------------------------------------
// Passageiro fixo no banco do motorista (ex.: a Mel)
// -----------------------------------------------------------------------
// Usa exatamente a mesma técnica de normalização do loadCar(): rotaciona
// primeiro, mede a caixa (Box3) do modelo já rotacionado para descobrir o
// tamanho real dele, escala para bater com a altura desejada e só então
// posiciona — assim o resultado não depende de como o .glb original foi
// modelado/orientado.
//
// A Mel é adicionada como FILHA do grupo `car` (o mesmo grupo que já
// recebe toda a física/movimento em updateCar()/no game loop, via
// `car.position.copy(...)` e `car.rotation.y = ...`). Isso é o que faz ela
// se mover, virar, acelerar e derrapar exatamente junto com o carro sem
// precisar tocar em nenhuma linha da física, dos controles ou da câmera.
function loadDriverPet(config) {
  // Remove o passageiro anterior (troca de carro, ex. Porsche -> Mustang).
  if (petModel) {
    car.remove(petModel);
    petModel = null;
  }

  const petConfig = config.driverPet;
  if (!petConfig) return; // este carro não tem passageiro configurado

  loader.load(
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

      // Normaliza a escala com base na altura real desejada (ver comentário
      // de `height` no CAR_CATALOG).
      const box = new THREE.Box3().setFromObject(pet);
      const size = new THREE.Vector3();
      box.getSize(size);
      if (size.y > 0) {
        const scale = petConfig.height / size.y;
        pet.scale.setScalar(scale);
      }

      // Alinha a base (patas/traseira) exatamente com a altura do banco:
      // mede o Y mínimo já escalado e desloca para que ele encoste em
      // petConfig.seat.y, do mesmo jeito que o carro "gruda" no chão.
      const groundedBox = new THREE.Box3().setFromObject(pet);
      const seat = petConfig.seat;
      pet.position.set(seat.x, seat.y - groundedBox.min.y, seat.z);

      car.add(pet);
      petModel = pet;
    },
    undefined,
    (error) => {
      console.error(`Erro ao carregar o passageiro (${petConfig.modelPath}):`, error);
    }
  );
}

function startGame() {
  isGameStarted = true;
  carSelectEl.style.display = 'none';
  hudEl.style.display = 'block';
  controlsHintEl.style.display = isTouchDevice ? 'none' : 'block';
  topBarEl.style.display = 'flex';
  updateTouchControlsVisibility();
}

function returnToCarSelect() {
  isGameStarted = false;
  carSelectEl.style.display = 'flex';
  hudEl.style.display = 'none';
  controlsHintEl.style.display = 'none';
  topBarEl.style.display = 'none';
  disconnectMultiplayer();
  mpStatusEl.style.display = 'none';
  multiplayerTick = null;
  updateTouchControlsVisibility();
}

// ---------------------------------------------------------------------------
// Multiplayer
// ---------------------------------------------------------------------------
// Guarda a função de tick retornada por connectMultiplayer() — chamada a
// cada frame do loop principal enquanto o jogo estiver rodando. Fica null
// quando não há conexão ativa (ex.: antes de selecionar um carro).
let multiplayerTick = null;

const MP_STATUS_LABELS = {
  connecting: 'Conectando...',
  connected: 'Conectado',
  disconnected: 'Modo local (sem servidor)',
};

function updateMpStatus(status) {
  mpStatusEl.style.display = 'flex';
  mpStatusEl.classList.remove('connected', 'connecting', 'disconnected');
  mpStatusEl.classList.add(status);
  const count = mpPlayerCount;
  const label = MP_STATUS_LABELS[status] ?? status;
  mpStatusTextEl.textContent =
    status === 'connected' ? `${label} · ${count} outro(s) jogador(es)` : label;
}

let mpPlayerCount = 0;

// Estado enviado ao servidor a cada intervalo (ver STATE_SEND_INTERVAL_MS em
// multiplayer.js). Mantém somente o essencial para os outros clientes
// desenharem/interpolarem nosso carro.
function getLocalMultiplayerState() {
  return {
    position: { x: carState.position.x, y: carState.position.y, z: carState.position.z },
    heading: carState.heading,
    speed: carState.velocity.length() * 3.6,
    gear: carState.gear,
    isDrifting: carState.isDrifting,
  };
}

document.querySelectorAll('.car-card').forEach((card) => {
  const carKey = card.dataset.car;

  const select = () => {
    // Conecta ao servidor multiplayer assim que o carro é selecionado —
    // não espera o modelo 3D terminar de carregar, para os outros
    // jogadores já saberem que alguém entrou o quanto antes.
    multiplayerTick = connectMultiplayer({
      scene,
      carKey,
      carCatalog: CAR_CATALOG,
      getLocalState: getLocalMultiplayerState,
      onCountChange: (count) => {
        mpPlayerCount = count;
        updateMpStatus(mpStatusEl.classList.contains('connecting') ? 'connecting' : 'connected');
      },
      onStatusChange: updateMpStatus,
    });

    loadCar(carKey);
  };
  card.querySelector('.select-btn').addEventListener('click', select);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select();
    }
  });
});

changeCarBtn.addEventListener('click', returnToCarSelect);

// ---------------------------------------------------------------------------
// Controles de teclado
// ---------------------------------------------------------------------------

const keys = { w: false, a: false, s: false, d: false, space: false };
const touchControlsEl = document.getElementById('touch-controls');
const touchButtonEls = Array.from(document.querySelectorAll('[data-key]'));
const controlsBtn = document.getElementById('controls-btn');
const controlsPanelEl = document.getElementById('controls-panel');
const gamepadDeviceNameEl = document.getElementById('gamepad-device-name');
const gamepadWheelLabelEl = document.getElementById('gamepad-wheel-label');
const gamepadThrottleLabelEl = document.getElementById('gamepad-throttle-label');
const gamepadBrakeLabelEl = document.getElementById('gamepad-brake-label');
const gamepadShiftUpLabelEl = document.getElementById('gamepad-shiftup-label');
const gamepadShiftDownLabelEl = document.getElementById('gamepad-shiftdown-label');
const wheelMeterEl = document.getElementById('wheel-meter');
const throttleMeterEl = document.getElementById('throttle-meter');
const brakeMeterEl = document.getElementById('brake-meter');
const wheelMeterValueEl = document.getElementById('wheel-meter-value');
const throttleMeterValueEl = document.getElementById('throttle-meter-value');
const brakeMeterValueEl = document.getElementById('brake-meter-value');
const gamepadDebugPanelEl = document.getElementById('gamepad-debug-panel');
const gamepadDebugGridEl = document.getElementById('gamepad-debug-grid');
const toggleGamepadDebugBtn = document.getElementById('toggle-gamepad-debug-btn');

const GAMEPAD_STORAGE_KEY = 'car-game-gamepad-config-v1';
const GAMEPAD_DEBUG = false;
const DEFAULT_GAMEPAD_CONFIG = {
  deadzone: 0.05,
  steeringSensitivity: 1.8,
  steeringAxis: null,
  throttleAxis: null,
  brakeAxis: null,
  shiftUpButton: null,
  shiftDownButton: null,
};

const controls = {
  steering: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  shiftUp: false,
  shiftDown: false,
  gamepadActive: false,
};

let gamepadConfig = { ...DEFAULT_GAMEPAD_CONFIG };
let calibrationTarget = null;
let calibrationSnapshot = null;
let previousGamepadShiftUp = false;
let previousGamepadShiftDown = false;
const gamepadAxisRange = {};

// Cache da inferência automática de eixos/botões (usada como fallback antes
// de o jogador calibrar manualmente). É recalculada só quando o gamepad
// conectado muda — nunca a cada frame — porque antes disso o "botão padrão"
// de troca de marcha ficava mudando conforme o que estivesse sendo
// pressionado naquele instante, causando trocas de marcha erráticas.
let cachedInferredDefaults = null;
let cachedInferredPadId = null;

function logRawGamepadState(label = 'GAMEPAD_RAW') {
  if (!GAMEPAD_DEBUG) return;

  const pad = getConnectedGamepad();
  if (!pad) {
    console.log(label, 'nenhum gamepad conectado');
    return;
  }

  const axes = Array.from(pad.axes ?? []).map((value) => Number(value.toFixed(3)));
  const buttons = Array.from(pad.buttons ?? []).map((button, index) => ({
    index,
    pressed: !!button?.pressed,
    value: Number((button?.value ?? 0).toFixed(3)),
  }));

  console.log(label, { id: pad.id, axes, buttons });
}

function normalizeAxisToUnit(index, value, deadzone) {
  if (index === null || index === undefined) return 0;

  const range = gamepadAxisRange[index] ?? (gamepadAxisRange[index] = { min: value, max: value });
  if (value < range.min) range.min = value;
  if (value > range.max) range.max = value;

  const span = range.max - range.min;
  if (span < 0.05) return 0;

  const normalized = (value - range.min) / span;
  if (normalized < deadzone) return 0;
  return clamp(normalized, 0, 1);
}

function sanitizeGamepadConfig(config) {
  const next = { ...DEFAULT_GAMEPAD_CONFIG, ...config };
  const usedAxisIndexes = new Set();

  ['steeringAxis', 'throttleAxis', 'brakeAxis'].forEach((key) => {
    const value = next[key];
    if (value === null || value === undefined) return;
    if (usedAxisIndexes.has(value)) {
      next[key] = null;
      return;
    }
    usedAxisIndexes.add(value);
  });

  const usedButtonIndexes = new Set();
  ['shiftUpButton', 'shiftDownButton'].forEach((key) => {
    const value = next[key];
    if (value === null || value === undefined) return;
    if (usedButtonIndexes.has(value)) {
      next[key] = null;
      return;
    }
    usedButtonIndexes.add(value);
  });

  return next;
}

function applyUniqueButtonAssignment(targetKey, value) {
  const next = { ...gamepadConfig };
  if (targetKey === 'shiftUpButton') {
    if (value === next.shiftDownButton) {
      next.shiftDownButton = null;
    }
    next.shiftUpButton = value;
  }

  if (targetKey === 'shiftDownButton') {
    if (value === next.shiftUpButton) {
      next.shiftUpButton = null;
    }
    next.shiftDownButton = value;
  }

  gamepadConfig = sanitizeGamepadConfig(next);
}

function readGamepadConfig() {
  try {
    const raw = localStorage.getItem(GAMEPAD_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GAMEPAD_CONFIG };

    const parsed = JSON.parse(raw);
    const cleaned = sanitizeGamepadConfig(parsed);
    if (JSON.stringify(cleaned) !== JSON.stringify({ ...DEFAULT_GAMEPAD_CONFIG, ...parsed })) {
      localStorage.removeItem(GAMEPAD_STORAGE_KEY);
    }
    return cleaned;
  } catch {
    return { ...DEFAULT_GAMEPAD_CONFIG };
  }
}

function saveGamepadConfig() {
  gamepadConfig = sanitizeGamepadConfig(gamepadConfig);
  localStorage.setItem(GAMEPAD_STORAGE_KEY, JSON.stringify(gamepadConfig));
}

gamepadConfig = sanitizeGamepadConfig(readGamepadConfig());

const isTouchDevice = (() => {
  if (navigator.maxTouchPoints > 0) return true;
  if ('ontouchstart' in window) return true;
  return window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches;
})();

function shouldIgnoreCameraPointer(target) {
  if (!target || !(target instanceof Element)) return false;
  return target.closest('#touch-controls, .touch-btn') !== null;
}

function setKeyState(key, pressed) {
  if (!(key in keys)) return;
  keys[key] = pressed;
}

function setTouchButtonState(button, pressed) {
  if (!button) return;
  button.classList.toggle('active', pressed);
}

function setupTouchControl(button) {
  const key = button.dataset.key;
  if (!key) return;

  const press = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setKeyState(key, true);
    setTouchButtonState(button, true);
  };

  const release = (event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setKeyState(key, false);
    setTouchButtonState(button, false);
  };

  button.addEventListener('touchstart', press, { passive: false });
  button.addEventListener('touchend', release, { passive: false });
  button.addEventListener('touchcancel', release, { passive: false });
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      press(event);
    }
    button.setPointerCapture?.(event.pointerId);
  });
  button.addEventListener('pointerup', (event) => {
    release(event);
    button.releasePointerCapture?.(event.pointerId);
  });
  button.addEventListener('pointerleave', release);
  button.addEventListener('pointercancel', (event) => {
    release(event);
    button.releasePointerCapture?.(event.pointerId);
  });
}

if (touchControlsEl) {
  touchButtonEls.forEach(setupTouchControl);
}

function updateTouchControlsVisibility() {
  if (!touchControlsEl) return;
  touchControlsEl.classList.toggle('visible', isTouchDevice && isGameStarted);
}

function getConnectedGamepad() {
  if (!navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  for (const pad of pads) {
    if (pad) return pad;
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatAxisValue(value) {
  return Number(Math.abs(value)).toFixed(2);
}

function setControlButtonState() {
  if (!controlsBtn) return;
  const pad = getConnectedGamepad();
  controlsBtn.textContent = pad ? 'CONTROLES ✓' : 'CONTROLES';
}

function getButtonActivity(button) {
  if (!button) return 0;
  const value = Number(button.value ?? 0);
  const pressed = !!button.pressed;
  return Math.max(value, pressed ? 1 : 0);
}

function toggleGamepadDebugPanel(forceState) {
  if (!gamepadDebugPanelEl) return;

  const shouldOpen = typeof forceState === 'boolean' ? forceState : !gamepadDebugPanelEl.classList.contains('visible');
  gamepadDebugPanelEl.classList.toggle('visible', shouldOpen);
  if (shouldOpen) {
    updateGamepadDebugPanel();
  }
}

function updateGamepadDebugPanel() {
  const pad = getConnectedGamepad();
  if (!gamepadDebugPanelEl || !gamepadDebugGridEl) return;

  if (!gamepadDebugPanelEl.classList.contains('visible')) {
    if (!pad) {
      gamepadDebugGridEl.innerHTML = '';
    }
    return;
  }

  if (!pad) {
    gamepadDebugGridEl.innerHTML = '<div class="debug-item"><span>status</span><strong>sem pad</strong></div>';
    return;
  }

  const axisItems = (pad.axes ?? []).map((value, index) => {
    const displayValue = Number((value ?? 0).toFixed(3));
    const status = Math.abs(displayValue) < 0.1 ? 'center' : displayValue >= 0 ? 'pos' : 'neg';
    return `<div class="debug-item"><span>A${index}</span><strong>${displayValue}</strong><small style="opacity:0.7;">${status}</small></div>`;
  });

  const buttonItems = (pad.buttons ?? []).slice(0, 8).map((button, index) => {
    const value = getButtonActivity(button);
    const state = value > 0.1 ? 'on' : 'off';
    return `<div class="debug-item"><span>B${index}</span><strong>${Number(value.toFixed(3))}</strong><small style="opacity:0.7;">${state}</small></div>`;
  });

  gamepadDebugGridEl.innerHTML = [...axisItems, ...buttonItems].join('');
}

function inferGamepadDefaults(pad) {
  const defaultConfig = { ...DEFAULT_GAMEPAD_CONFIG };
  if (!pad) return defaultConfig;

  const axes = (pad.axes ?? []).map((value, index) => ({ index, value, abs: Math.abs(value) }));
  const centeredAxes = axes.filter((axis) => axis.abs < 0.2).sort((a, b) => a.abs - b.abs);
  if (centeredAxes[0]) defaultConfig.steeringAxis = centeredAxes[0].index;

  const extremes = axes
    .filter((axis) => axis.abs >= 0.2 && axis.index !== defaultConfig.steeringAxis)
    .sort((a, b) => b.abs - a.abs);

  if (extremes[0]) defaultConfig.throttleAxis = extremes[0].index;
  if (extremes[1]) defaultConfig.brakeAxis = extremes[1].index;

  const buttons = pad.buttons ?? [];
  const activeButtons = buttons
    .map((button, index) => ({ index, value: Number(button?.value ?? 0), pressed: !!button?.pressed }))
    .filter((button) => button.value > 0.2 || button.pressed)
    .sort((a, b) => b.value - a.value);

  if (activeButtons[0]) defaultConfig.shiftUpButton = activeButtons[0].index;
  if (activeButtons[1]) defaultConfig.shiftDownButton = activeButtons[1].index;

  return defaultConfig;
}

function getActiveGamepadConfig(pad) {
  if (!pad) return { ...DEFAULT_GAMEPAD_CONFIG };

  // Só recalcula a inferência automática quando o gamepad conectado muda
  // (id diferente) ou ainda não foi inferida — nunca a cada frame. Antes
  // disso, "qual botão está mais pressionado agora" era reavaliado 60x por
  // segundo, então o botão "padrão" de troca de marcha mudava conforme
  // qualquer botão que estivesse sendo segurado naquele instante, causando
  // trocas de marcha erráticas antes da calibração manual.
  if (cachedInferredPadId !== pad.id || !cachedInferredDefaults) {
    cachedInferredDefaults = inferGamepadDefaults(pad);
    cachedInferredPadId = pad.id;
  }

  const fallback = cachedInferredDefaults;
  const merged = {
    ...DEFAULT_GAMEPAD_CONFIG,
    ...fallback,
    ...gamepadConfig,
    steeringAxis: gamepadConfig.steeringAxis ?? fallback.steeringAxis,
    throttleAxis: gamepadConfig.throttleAxis ?? fallback.throttleAxis,
    brakeAxis: gamepadConfig.brakeAxis ?? fallback.brakeAxis,
    shiftUpButton: gamepadConfig.shiftUpButton ?? fallback.shiftUpButton,
    shiftDownButton: gamepadConfig.shiftDownButton ?? fallback.shiftDownButton,
  };
  return sanitizeGamepadConfig(merged);
}

function updateControlsPanelUi() {
  const pad = getConnectedGamepad();
  const activeConfig = getActiveGamepadConfig(pad);
  const name = pad ? pad.id : 'Nenhum volante detectado';
  gamepadDeviceNameEl.textContent = name;

  gamepadWheelLabelEl.textContent =
    activeConfig.steeringAxis !== null ? `Axis ${activeConfig.steeringAxis}` : 'Aguardando movimento...';
  gamepadThrottleLabelEl.textContent =
    activeConfig.throttleAxis !== null ? `Axis ${activeConfig.throttleAxis}` : 'Aguardando movimento...';
  gamepadBrakeLabelEl.textContent =
    activeConfig.brakeAxis !== null ? `Axis ${activeConfig.brakeAxis}` : 'Aguardando movimento...';
  gamepadShiftUpLabelEl.textContent =
    activeConfig.shiftUpButton !== null ? `Botão ${activeConfig.shiftUpButton}` : 'Aguardando botão...';
  gamepadShiftDownLabelEl.textContent =
    activeConfig.shiftDownButton !== null ? `Botão ${activeConfig.shiftDownButton}` : 'Aguardando botão...';

  if (!pad) {
    wheelMeterEl.style.width = '0%';
    throttleMeterEl.style.width = '0%';
    brakeMeterEl.style.width = '0%';
    wheelMeterValueEl.textContent = '0.00';
    throttleMeterValueEl.textContent = '0.00';
    brakeMeterValueEl.textContent = '0.00';
    return;
  }

  const wheelValue = activeConfig.steeringAxis !== null ? pad.axes[activeConfig.steeringAxis] ?? 0 : 0;
  const throttleValue = activeConfig.throttleAxis !== null
    ? normalizeAxisToUnit(activeConfig.throttleAxis, pad.axes[activeConfig.throttleAxis] ?? 0, gamepadConfig.deadzone ?? DEFAULT_GAMEPAD_CONFIG.deadzone)
    : 0;
  const brakeValue = activeConfig.brakeAxis !== null
    ? normalizeAxisToUnit(activeConfig.brakeAxis, pad.axes[activeConfig.brakeAxis] ?? 0, gamepadConfig.deadzone ?? DEFAULT_GAMEPAD_CONFIG.deadzone)
    : 0;

  const wheelNorm = Math.abs(wheelValue) < (gamepadConfig.deadzone ?? DEFAULT_GAMEPAD_CONFIG.deadzone) ? 0 : wheelValue;
  wheelMeterEl.style.width = `${clamp(Math.abs(wheelNorm) * 100, 0, 100)}%`;
  wheelMeterValueEl.textContent = Number(Math.abs(wheelNorm)).toFixed(2);

  throttleMeterEl.style.width = `${clamp(throttleValue * 100, 0, 100)}%`;
  throttleMeterValueEl.textContent = Number(throttleValue).toFixed(2);

  brakeMeterEl.style.width = `${clamp(brakeValue * 100, 0, 100)}%`;
  brakeMeterValueEl.textContent = Number(brakeValue).toFixed(2);
}

function updateGamepadInput() {
  const pad = getConnectedGamepad();
  if (!pad || !gamepadConfig) {
    controls.gamepadActive = false;
    controls.steering = 0;
    controls.throttle = 0;
    controls.brake = 0;
    controls.handbrake = false;
    controls.shiftUp = false;
    controls.shiftDown = false;
    previousGamepadShiftUp = false;
    previousGamepadShiftDown = false;
    setControlButtonState();
    if (controlsPanelEl?.classList.contains('visible')) {
      updateControlsPanelUi();
    }
    return;
  }

  const activeConfig = getActiveGamepadConfig(pad);
  controls.gamepadActive = true;

  const wheelAxis = activeConfig.steeringAxis !== null ? (pad.axes[activeConfig.steeringAxis] ?? 0) : 0;
  const throttleAxis = activeConfig.throttleAxis !== null ? (pad.axes[activeConfig.throttleAxis] ?? 0) : 0;
  const brakeAxis = activeConfig.brakeAxis !== null ? (pad.axes[activeConfig.brakeAxis] ?? 0) : 0;

  const deadzone = gamepadConfig.deadzone ?? DEFAULT_GAMEPAD_CONFIG.deadzone;
  const normalizedWheel = Math.abs(wheelAxis) < deadzone ? 0 : wheelAxis * (gamepadConfig.steeringSensitivity ?? DEFAULT_GAMEPAD_CONFIG.steeringSensitivity);
  const normalizedThrottle = activeConfig.throttleAxis !== null
    ? normalizeAxisToUnit(activeConfig.throttleAxis, throttleAxis, deadzone)
    : 0;
  const normalizedBrake = activeConfig.brakeAxis !== null
    ? normalizeAxisToUnit(activeConfig.brakeAxis, brakeAxis, deadzone)
    : 0;

  controls.steering = clamp(normalizedWheel, -1, 1);
  controls.throttle = normalizedThrottle;
  controls.brake = normalizedBrake;
  controls.handbrake = keys.space;

  const shiftUpButton = activeConfig.shiftUpButton !== null ? pad.buttons[activeConfig.shiftUpButton] : null;
  const shiftDownButton = activeConfig.shiftDownButton !== null ? pad.buttons[activeConfig.shiftDownButton] : null;
  const shiftUpValue = shiftUpButton ? getButtonActivity(shiftUpButton) : 0;
  const shiftDownValue = shiftDownButton ? getButtonActivity(shiftDownButton) : 0;

  controls.shiftUp = shiftUpValue > 0.05;
  controls.shiftDown = shiftDownValue > 0.05;

  if (GAMEPAD_DEBUG && (Math.abs(wheelAxis) > 0.05 || Math.abs(throttleAxis) > 0.05 || Math.abs(brakeAxis) > 0.05 || controls.shiftUp || controls.shiftDown)) {
    console.log('GAMEPAD', {
      id: pad.id,
      steeringAxis: activeConfig.steeringAxis,
      steeringValue: wheelAxis,
      throttleAxis: activeConfig.throttleAxis,
      throttleValue: throttleAxis,
      brakeAxis: activeConfig.brakeAxis,
      brakeValue: brakeAxis,
      shiftUp: controls.shiftUp,
      shiftDown: controls.shiftDown,
      axes: Array.from(pad.axes ?? []).map((value) => Number(value.toFixed(3))),
      buttons: Array.from(pad.buttons ?? []).map((button, index) => ({ index, value: Number((button?.value ?? 0).toFixed(3)), pressed: !!button?.pressed }))
    });
  }

  updateGamepadDebugPanel();
  setControlButtonState();
  if (controlsPanelEl?.classList.contains('visible')) {
    updateControlsPanelUi();
  }
}

function findSignificantAxis(pad, target = 'steering') {
  const axes = pad.axes ?? [];
  const snapshot = calibrationSnapshot?.axes ?? [];
  let bestIndex = null;
  let bestDelta = 0;

  for (let i = 0; i < axes.length; i++) {
    const current = Number(axes[i] ?? 0);
    const initial = Number(snapshot[i] ?? 0);
    const delta = Math.abs(current - initial);

    if (target === 'steering') {
      if (delta > 0.03 && Math.abs(current) > 0.05 && delta > bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
      continue;
    }

    if (target === 'throttle') {
      if (current > 0.05 && (current - initial) > bestDelta) {
        bestDelta = current - initial;
        bestIndex = i;
      }
      continue;
    }

    if (target === 'brake') {
      const magnitude = Math.abs(current);
      if (magnitude > 0.05 && delta > bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
    }
  }

  return bestIndex;
}

function findPressedButton(pad) {
  const buttons = pad.buttons ?? [];
  const snapshot = calibrationSnapshot?.buttons ?? [];
  let bestIndex = null;
  let bestValue = 0;

  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i] ?? {};
    const value = Math.max(Number(btn.value ?? 0), btn.pressed ? 1 : 0);
    const initial = Number(snapshot[i] ?? 0);
    // Ignora botões que já estavam ativos no momento em que a calibração
    // começou — evita capturar por engano um botão "grudado"/já pressionado
    // em vez do que o jogador realmente apertou agora.
    if (initial > 0.5) continue;
    if (value > bestValue) {
      bestValue = value;
      bestIndex = i;
    }
  }

  return bestValue > 0.05 ? bestIndex : null;
}

function beginCalibration(target) {
  calibrationTarget = target;
  const pad = getConnectedGamepad();
  calibrationSnapshot = pad ? {
    axes: Array.from(pad.axes ?? []),
    buttons: Array.from(pad.buttons ?? []).map((button) => Number(button?.value ?? 0) || (button?.pressed ? 1 : 0))
  } : null;

  if (GAMEPAD_DEBUG) {
    console.log('CALIBRANDO', { target, pad: pad ? pad.id : 'nenhum', snapshot: calibrationSnapshot });
    logRawGamepadState('GAMEPAD_CALIBRATION_START');
  }

  if (target === 'steering') {
    gamepadWheelLabelEl.textContent = 'Aguardando movimento...';
  } else if (target === 'throttle') {
    gamepadThrottleLabelEl.textContent = 'Aguardando movimento...';
  } else if (target === 'brake') {
    gamepadBrakeLabelEl.textContent = 'Aguardando movimento...';
  } else if (target === 'shiftUp') {
    gamepadShiftUpLabelEl.textContent = 'Aguardando botão...';
  } else if (target === 'shiftDown') {
    gamepadShiftDownLabelEl.textContent = 'Aguardando botão...';
  }
}

function applyCalibrationValue(target, value) {
  if (target === 'steering') gamepadConfig.steeringAxis = value;
  if (target === 'throttle') gamepadConfig.throttleAxis = value;
  if (target === 'brake') gamepadConfig.brakeAxis = value;
  if (target === 'shiftUp') applyUniqueButtonAssignment('shiftUpButton', value);
  if (target === 'shiftDown') applyUniqueButtonAssignment('shiftDownButton', value);

  const axisUsed = new Set();
  ['steeringAxis', 'throttleAxis', 'brakeAxis'].forEach((key) => {
    const currentValue = gamepadConfig[key];
    if (currentValue === null || currentValue === undefined) return;
    if (axisUsed.has(currentValue)) {
      gamepadConfig[key] = null;
      return;
    }
    axisUsed.add(currentValue);
  });

  const buttonUsed = new Set();
  ['shiftUpButton', 'shiftDownButton'].forEach((key) => {
    const currentValue = gamepadConfig[key];
    if (currentValue === null || currentValue === undefined) return;
    if (buttonUsed.has(currentValue)) {
      gamepadConfig[key] = null;
      return;
    }
    buttonUsed.add(currentValue);
  });

  calibrationTarget = null;
  saveGamepadConfig();
  updateControlsPanelUi();
}

function updateCalibration() {
  if (!calibrationTarget) return;
  const pad = getConnectedGamepad();
  if (!pad) return;

  if (GAMEPAD_DEBUG) {
    console.log('CALIBRATION_LIVE', {
      target: calibrationTarget,
      axes: Array.from(pad.axes ?? []).map((value) => Number(value.toFixed(3))),
      buttons: Array.from(pad.buttons ?? []).map((button, index) => ({
        index,
        pressed: !!button?.pressed,
        value: Number((button?.value ?? 0).toFixed(3)),
      })),
    });
  }

  if (calibrationTarget === 'steering' || calibrationTarget === 'throttle' || calibrationTarget === 'brake') {
    const axisIdx = findSignificantAxis(pad, calibrationTarget);
    if (axisIdx !== null) {
      if (GAMEPAD_DEBUG) {
        console.log('CALIBRACAO_AXIS', {
          target: calibrationTarget,
          axisIndex: axisIdx,
          value: pad.axes[axisIdx],
          allAxes: Array.from(pad.axes ?? []).map((value) => Number(value.toFixed(3))),
        });
      }
      applyCalibrationValue(calibrationTarget, axisIdx);
    }
    return;
  }

  const buttonIdx = findPressedButton(pad);
  if (buttonIdx !== null) {
    if (GAMEPAD_DEBUG) {
      console.log('CALIBRACAO_BUTTON', {
        target: calibrationTarget,
        buttonIndex: buttonIdx,
        value: pad.buttons[buttonIdx]?.value,
        pressed: pad.buttons[buttonIdx]?.pressed,
        allButtons: Array.from(pad.buttons ?? []).map((button, index) => ({
          index,
          pressed: !!button?.pressed,
          value: Number((button?.value ?? 0).toFixed(3)),
        })),
      });
    }
    applyCalibrationValue(calibrationTarget, buttonIdx);
  }
}

if (controlsBtn) {
  controlsBtn.addEventListener('click', () => {
    controlsPanelEl.classList.toggle('visible');
    updateControlsPanelUi();
  });
}

if (controlsPanelEl) {
  controlsPanelEl.addEventListener('click', (event) => {
    if (event.target === controlsPanelEl) {
      controlsPanelEl.classList.remove('visible');
    }
  });
}

document.getElementById('configure-wheel-btn')?.addEventListener('click', () => beginCalibration('steering'));
document.getElementById('configure-throttle-btn')?.addEventListener('click', () => beginCalibration('throttle'));
document.getElementById('configure-brake-btn')?.addEventListener('click', () => beginCalibration('brake'));
document.getElementById('configure-shiftup-btn')?.addEventListener('click', () => beginCalibration('shiftUp'));
document.getElementById('configure-shiftdown-btn')?.addEventListener('click', () => beginCalibration('shiftDown'));
document.getElementById('save-gamepad-btn')?.addEventListener('click', () => {
  saveGamepadConfig();
  controlsPanelEl.classList.remove('visible');
});

toggleGamepadDebugBtn?.addEventListener('click', () => {
  toggleGamepadDebugPanel();
});

window.addEventListener('gamepadconnected', () => {
  setControlButtonState();
  updateControlsPanelUi();
  updateGamepadDebugPanel();
});

window.addEventListener('gamepaddisconnected', () => {
  // Limpa o cache de inferência automática: quando outro (ou o mesmo)
  // gamepad reconectar, os eixos/botões precisam ser reinferidos do zero.
  cachedInferredDefaults = null;
  cachedInferredPadId = null;
  setControlButtonState();
  updateControlsPanelUi();
  updateGamepadDebugPanel();
});

window.addEventListener('keydown', (e) => {
  // SPACE é tratado separadamente (e.code, não e.key) para não depender de
  // layout de teclado, e com preventDefault para a página não rolar.
  if (e.code === 'Space') {
    e.preventDefault();
    keys.space = true;
    return;
  }
  const key = e.key.toLowerCase();
  // Troca de marcha: evento único por pressionar (e.repeat ignora o
  // auto-repeat do SO quando a tecla fica segurada), não um estado contínuo.
  if (key === 'e') {
    if (!e.repeat) shiftUp();
    return;
  }
  if (key === 'q') {
    if (!e.repeat) shiftDown();
    return;
  }
  if (key in keys) keys[key] = true;
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    keys.space = false;
    return;
  }
  const key = e.key.toLowerCase();
  if (key in keys) keys[key] = false;
});

// ---------------------------------------------------------------------------
// Reiniciar posição
// ---------------------------------------------------------------------------

function resetCar() {
  carState.position.set(0, 0, CAR_SPAWN_Z);
  carState.heading = 0;
  carState.velocity.set(0, 0, 0);
  carState.longitudinalSpeed = 0;
  carState.lateralSpeed = 0;
  carState.isDrifting = false;
  carState.gear = 1;
  carState.rpm = GEARBOX.gears[0].minRpm;
  carState.rpmLimiterActive = false;
  carState.limiterPhase = 0;
  car.position.set(0, 0, CAR_SPAWN_Z);
  car.rotation.y = 0;
  resetDriftEffects();
}

resetBtn.addEventListener('click', resetCar);

// ---------------------------------------------------------------------------
// Efeitos visuais de drift (marcas de pneu + fumaça) — secundários.
// Usam pools de objetos fixos, reaproveitados em ring buffer, para não gerar
// lixo de memória nem custo de performance durante o drift.
// ---------------------------------------------------------------------------

const SKID_MARK_POOL_SIZE = 160;
const SMOKE_POOL_SIZE = 40;

const skidMarkGeometry = new THREE.PlaneGeometry(0.24, 0.9);
const skidMarkMaterial = new THREE.MeshBasicMaterial({
  color: 0x151515,
  transparent: true,
  opacity: 0.45,
  depthWrite: false,
});

// Quaternion fixo que deita o plano no chão (mesma rotação usada no chão da
// cena). A orientação (yaw) de cada marca é aplicada por cima dele via
// quaternion também, o que é mais confiável do que combinar rotation.x e
// rotation.z manualmente (evita depender da ordem de composição dos Euler).
const _flatQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _yawQuat = new THREE.Quaternion();
const _yawAxis = new THREE.Vector3(0, 1, 0);

const skidMarks = [];
const skidMarkGroup = new THREE.Group();
scene.add(skidMarkGroup);

for (let i = 0; i < SKID_MARK_POOL_SIZE; i++) {
  const mark = new THREE.Mesh(skidMarkGeometry, skidMarkMaterial);
  mark.quaternion.copy(_flatQuat);
  mark.visible = false;
  skidMarkGroup.add(mark);
  skidMarks.push(mark);
}
let nextSkidMarkIndex = 0;

// Textura simples de fumaça (gradiente radial), gerada uma única vez.
function createSmokeTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const smokeTexture = createSmokeTexture();
const smokeMaterial = new THREE.SpriteMaterial({
  map: smokeTexture,
  transparent: true,
  depthWrite: false,
  opacity: 0,
});

const smokeParticles = [];
for (let i = 0; i < SMOKE_POOL_SIZE; i++) {
  const sprite = new THREE.Sprite(smokeMaterial.clone());
  sprite.visible = false;
  sprite.scale.setScalar(0.6);
  scene.add(sprite);
  smokeParticles.push({ sprite, life: 0, maxLife: 0.6 });
}
let nextSmokeIndex = 0;
let smokeSpawnCooldown = 0;

// Posição aproximada de cada roda traseira no mundo, estimada a partir do
// comprimento do modelo atualmente selecionado. É só uma aproximação para
// fins visuais (marcas de pneu / fumaça).
const _rearWheelWorld = new THREE.Vector3();

function spawnDriftEffects(dt) {
  const halfLength = (currentCarConfig?.targetLength ?? 4.5) / 2;
  const rearOffset = halfLength * 0.85;
  const trackHalfWidth = 0.75;

  _forward.set(Math.sin(carState.heading), 0, Math.cos(carState.heading));
  _right.set(_forward.z, 0, -_forward.x);

  [-1, 1].forEach((side) => {
    _rearWheelWorld
      .copy(carState.position)
      .addScaledVector(_forward, -rearOffset)
      .addScaledVector(_right, side * trackHalfWidth);

    // Marca de pneu (decal fixo no chão), orientada com o heading do carro.
    const mark = skidMarks[nextSkidMarkIndex];
    nextSkidMarkIndex = (nextSkidMarkIndex + 1) % SKID_MARK_POOL_SIZE;
    mark.position.set(_rearWheelWorld.x, 0.02, _rearWheelWorld.z);
    _yawQuat.setFromAxisAngle(_yawAxis, carState.heading);
    mark.quaternion.copy(_yawQuat).multiply(_flatQuat);
    mark.visible = true;

    // Fumaça, com uma taxa de spawn limitada para não sobrecarregar
    if (smokeSpawnCooldown <= 0) {
      const particle = smokeParticles[nextSmokeIndex];
      nextSmokeIndex = (nextSmokeIndex + 1) % SMOKE_POOL_SIZE;
      particle.sprite.position.set(
        _rearWheelWorld.x + (Math.random() - 0.5) * 0.3,
        0.3,
        _rearWheelWorld.z + (Math.random() - 0.5) * 0.3
      );
      particle.sprite.scale.setScalar(0.6 + Math.random() * 0.35);
      particle.sprite.material.opacity = 0.6;
      particle.life = particle.maxLife;
      particle.sprite.visible = true;
    }
  });

  smokeSpawnCooldown -= dt;
  if (smokeSpawnCooldown <= 0) smokeSpawnCooldown = 0.04;
}

function updateDriftEffects(dt) {
  if (carState.isDrifting) {
    spawnDriftEffects(dt);
  }

  // Atualiza fumaça ativa: sobe levemente e desaparece com o tempo.
  for (const particle of smokeParticles) {
    if (!particle.sprite.visible) continue;
    particle.life -= dt;
    if (particle.life <= 0) {
      particle.sprite.visible = false;
      continue;
    }
    const t = particle.life / particle.maxLife;
    particle.sprite.material.opacity = 0.6 * t;
    particle.sprite.scale.addScalar(dt * 0.5);
    particle.sprite.position.y += dt * 0.35;
  }
}

function resetDriftEffects() {
  skidMarks.forEach((mark) => {
    mark.visible = false;
  });
  smokeParticles.forEach((particle) => {
    particle.sprite.visible = false;
    particle.life = 0;
  });
  nextSkidMarkIndex = 0;
  nextSmokeIndex = 0;
  smokeSpawnCooldown = 0;
}

// ---------------------------------------------------------------------------
// Loop de física / atualização do carro
// ---------------------------------------------------------------------------

// Vetores reutilizados a cada frame para não alocar lixo desnecessário.
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

function updateCar(dt) {
  const {
    acceleration,
    brakeStrength,
    reverseAcceleration,
    absoluteSafetySpeed,
    absoluteSafetyReverseSpeed,
    steeringReferenceSpeed,
    steeringStrength,
    lateralGrip,
    handbrakeGrip,
    handbrakeBrake,
    driftControl,
    rollingResistance,
  } = CAR_PHYSICS;

  updateGamepadInput();
  updateCalibration();

  const useGamepadForSteering = controls.gamepadActive && gamepadConfig.steeringAxis !== null;
  const useGamepadForThrottle = controls.gamepadActive && gamepadConfig.throttleAxis !== null;
  const useGamepadForBrake = controls.gamepadActive && gamepadConfig.brakeAxis !== null;

  const steeringInput = useGamepadForSteering ? controls.steering : (keys.a ? -1 : 0) + (keys.d ? 1 : 0);
  const throttleInput = useGamepadForThrottle ? controls.throttle : (keys.w ? 1 : 0);
  const brakeInput = useGamepadForBrake ? controls.brake : (keys.s ? 1 : 0);
  const handbrakePressed = keys.space || (useGamepadForSteering && controls.handbrake);

  if (controls.gamepadActive && controls.shiftUp && !previousGamepadShiftUp) {
    shiftUp();
  }
  if (controls.gamepadActive && controls.shiftDown && !previousGamepadShiftDown) {
    shiftDown();
  }
  previousGamepadShiftUp = controls.gamepadActive && controls.shiftUp;
  previousGamepadShiftDown = controls.gamepadActive && controls.shiftDown;

  const NEAR_STOP_SPEED = 1.0; // unid/s (~3.6 km/h) — "praticamente parado"

  // -------------------------------------------------------------------
  // 1) Decompõe a velocidade atual (vetor no espaço do mundo) em
  //    componente longitudinal (na direção que o carro aponta) e lateral
  //    (perpendicular a ela), usando o heading ATUAL.
  // -------------------------------------------------------------------
  _forward.set(Math.sin(carState.heading), 0, Math.cos(carState.heading));
  _right.set(_forward.z, 0, -_forward.x);

  let longitudinal = carState.velocity.dot(_forward);
  let lateral = carState.velocity.dot(_right);

  // -------------------------------------------------------------------
  // 2) Aceleração / freio / ré agem apenas sobre a componente longitudinal.
  //    Agora tudo passa pela marcha atual (carState.gear): a velocidade
  //    máxima e a força de aceleração dependem da marcha (GEARBOX), e a
  //    troca entre ré e 1ª só acontece quando o carro está quase parado.
  // -------------------------------------------------------------------
  const gearCfg =
    carState.gear === REVERSE_GEAR ? GEARBOX.reverse : getForwardGearConfig(carState.gear);
  const gearMaxSpeedUnid = kmhToUnid(gearCfg.maxSpeed);
  const gearPower = carState.gear === REVERSE_GEAR ? 1 : gearCfg.power ?? 1;

  if (throttleInput > 0.02 || keys.w) {
    const effectiveThrottle = throttleInput > 0.02 ? throttleInput : 1;
    if (carState.gear === REVERSE_GEAR) {
      if (Math.abs(longitudinal) < NEAR_STOP_SPEED) {
        // Praticamente parado: volta para a 1ª marcha em vez de continuar
        // tentando acelerar em ré.
        carState.gear = 1;
      } else {
        // Ainda recuando: W funciona como o freio da ré.
        longitudinal = Math.min(0, longitudinal + brakeStrength * effectiveThrottle * dt);
      }
    } else {
      // Acelerando para frente na marcha atual. A força cai suavemente
      // conforme a velocidade se aproxima do topo da marcha (taper), em vez
      // de um clamp abrupto tipo "parede invisível" — dá a sensação de o
      // motor realmente "acabando o fôlego" no fim daquela relação.
      const speedFraction = THREE.MathUtils.clamp(longitudinal / gearMaxSpeedUnid, 0, 1);
      const taper = carState.rpmLimiterActive ? 0 : Math.pow(1 - speedFraction, 1.6);
      longitudinal += acceleration * gearPower * taper * effectiveThrottle * dt;
    }
  } else if (brakeInput > 0.02 || keys.s) {
    const effectiveBrake = brakeInput > 0.02 ? brakeInput : 1;
    if (carState.gear !== REVERSE_GEAR && longitudinal > 0.05) {
      longitudinal -= brakeStrength * effectiveBrake * dt; // freando enquanto anda para frente
    } else {
      if (carState.gear !== REVERSE_GEAR && Math.abs(longitudinal) < NEAR_STOP_SPEED) {
        // Praticamente parado: entra em ré.
        carState.gear = REVERSE_GEAR;
      }
      if (carState.gear === REVERSE_GEAR) {
        const reverseFraction = THREE.MathUtils.clamp(
          Math.abs(longitudinal) / gearMaxSpeedUnid,
          0,
          1
        );
        const reverseTaper = carState.rpmLimiterActive ? 0 : Math.pow(1 - reverseFraction, 1.6);
        longitudinal -= reverseAcceleration * effectiveBrake * reverseTaper * dt; // dando ré
      }
    }
  } else {
    // resistência de rolamento: velocidade longitudinal tende a zero
    if (longitudinal > 0) {
      longitudinal = Math.max(0, longitudinal - rollingResistance * dt);
    } else if (longitudinal < 0) {
      longitudinal = Math.min(0, longitudinal + rollingResistance * dt);
    }
  }

  // Freio de mão: além de soltar a aderência lateral (abaixo), também reduz
  // a velocidade longitudinal gradualmente.
  if (handbrakePressed) {
    if (longitudinal > 0) {
      longitudinal = Math.max(0, longitudinal - handbrakeBrake * dt);
    } else if (longitudinal < 0) {
      longitudinal = Math.min(0, longitudinal + handbrakeBrake * dt);
    }
  }

  // Proteção contra troca de marcha "impossível": se uma redução de marcha
  // deixou o carro acima da velocidade máxima da marcha atual (ex.: reduziu
  // da 5ª para a 1ª em alta velocidade), não travamos a velocidade
  // instantaneamente — em vez disso, aplicamos um arrasto suave que puxa a
  // velocidade de volta para o limite da marcha ao longo de alguns quadros.
  // O RPM (calculado abaixo) vai mostrar o motor "estourado" nesse meio
  // tempo, entrando no limitador, mas a posição/velocidade do carro nunca
  // dá um salto brusco.
  if (carState.gear !== REVERSE_GEAR && longitudinal > gearMaxSpeedUnid) {
    const overshoot = longitudinal - gearMaxSpeedUnid;
    longitudinal -= GEARBOX.overshootDrag * overshoot * dt;
  } else if (carState.gear === REVERSE_GEAR && longitudinal < -gearMaxSpeedUnid) {
    const overshoot = -gearMaxSpeedUnid - longitudinal;
    longitudinal += GEARBOX.overshootDrag * overshoot * dt;
  }

  // Rede de segurança final (bem acima de qualquer marcha), só para evitar
  // valores absurdos em caso de bug — não deve ser alcançada em uso normal.
  longitudinal = THREE.MathUtils.clamp(
    longitudinal,
    absoluteSafetyReverseSpeed,
    absoluteSafetySpeed
  );

  // -------------------------------------------------------------------
  // 2b) RPM do motor: calculado a partir da marcha atual e da velocidade
  //    longitudinal (não da velocidade total, que inclui o drift lateral —
  //    o motor "sente" a rotação das rodas motrizes, não o deslizamento).
  //    Quando o RPM bruto atinge o limite, entra o limitador ("corte de
  //    giro"): em vez de travar reto em 7000, o RPM oscila logo abaixo do
  //    limite numa frequência alta, e a aceleração é cortada (taper acima).
  // -------------------------------------------------------------------
  const speedKmhForRpm = Math.abs(longitudinal) * 3.6;
  if (isTouchDevice && carState.gear !== REVERSE_GEAR) {
    updateAutomaticTransmission(speedKmhForRpm, computeRawRpm(carState.gear, speedKmhForRpm));
  }

  const rawRpm = computeRawRpm(carState.gear, speedKmhForRpm);

  if (rawRpm >= GEARBOX.maxRpm) {
    carState.rpmLimiterActive = true;
    carState.limiterPhase += dt * GEARBOX.limiterFrequency * Math.PI * 2;
    const osc = (Math.sin(carState.limiterPhase) + 1) / 2; // 0..1
    carState.rpm = GEARBOX.maxRpm - GEARBOX.limiterDrop * osc;
  } else {
    carState.rpmLimiterActive = false;
    carState.limiterPhase = 0;
    carState.rpm = THREE.MathUtils.clamp(rawRpm, GEARBOX.idleRpm, GEARBOX.maxRpm);
  }

  // Estrutura preparada para o som do motor futuramente depender do RPM,
  // por exemplo: engineSound.playbackRate = 0.5 + (carState.rpm / GEARBOX.maxRpm) * 1.5;
  // Nenhum áudio é tocado por enquanto — apenas o "gancho" fica pronto.
  updateEngineAudio(carState.rpm / GEARBOX.maxRpm);

  // -------------------------------------------------------------------
  // 3) Aderência lateral: sem freio de mão, os pneus "grudam" rápido e a
  //    velocidade lateral é puxada de volta a zero (pouca derrapagem, mais
  //    difícil em curvas fechadas em alta velocidade). Com o freio de mão,
  //    a aderência cai bastante e a traseira escorrega, criando o drift.
  // -------------------------------------------------------------------
  const gripCoefficient = handbrakePressed ? handbrakeGrip : lateralGrip;
  const gripFactor = 1 - Math.exp(-gripCoefficient * dt); // independente de FPS
  lateral -= lateral * gripFactor;

  // -------------------------------------------------------------------
  // 4) Direção: A/D giram o heading do carro. Em baixa velocidade a direção
  //    é mais responsiva; em alta velocidade se aproxima de steeringStrength
  //    (curvas fechadas ficam mais difíceis). Com o freio de mão pressionado,
  //    driftControl dá ao jogador controle extra sobre o ângulo do drift
  //    (incluindo contra-esterço) em vez do carro apenas girar sozinho.
  // -------------------------------------------------------------------
  const speedFactor = THREE.MathUtils.clamp(
    Math.abs(longitudinal) / steeringReferenceSpeed,
    0.2,
    1
  );
  const turnDirection = longitudinal >= 0 ? 1 : -1; // inverte esterço na ré
  let turnRate = steeringStrength * speedFactor;
  if (handbrakePressed) turnRate *= driftControl;

  if (useGamepadForSteering) {
    const steeringMagnitude = Math.abs(steeringInput);
    if (steeringMagnitude > 0.01) {
      const steeringDirection = steeringInput > 0 ? -1 : 1;
      carState.heading += turnRate * steeringMagnitude * steeringDirection * turnDirection * dt;
    }
  } else {
    if (keys.a) {
      carState.heading += turnRate * turnDirection * dt;
    }
    if (keys.d) {
      carState.heading -= turnRate * turnDirection * dt;
    }
  }

  // -------------------------------------------------------------------
  // 5) Recombina a velocidade no espaço do mundo usando o heading ANTIGO
  //    (o mesmo _forward/_right calculados no passo 1, antes da direção
  //    girar o carro neste frame). Isto é essencial: o carro já gira
  //    visualmente para o heading novo (linha abaixo), mas a velocidade
  //    real continua majoritariamente alinhada com a direção antiga. É
  //    exatamente essa defasagem — carro apontando para um lado, mas se
  //    deslocando por outro, com momentum preservado — que no próximo
  //    frame aparece como velocidade lateral ao decompor contra o heading
  //    novo, e que a aderência (grip) então corrige aos poucos. Se
  //    reconstruíssemos aqui já com o heading novo, essa defasagem seria
  //    anulada a cada frame e o carro nunca derraparia de verdade.
  // -------------------------------------------------------------------
  carState.velocity
    .copy(_forward)
    .multiplyScalar(longitudinal)
    .addScaledVector(_right, lateral);

  carState.longitudinalSpeed = longitudinal;
  carState.lateralSpeed = lateral;

  // Marca de pneu no esterço máximo: mesmo sem o freio de mão, se o volante
  // (ou A/D) estiver girado no limite e o carro estiver em movimento, os
  // pneus deixam marca — como se estivessem raspando no esterço máximo.
  const steeringMagnitudeForSkid = Math.min(Math.abs(steeringInput), 1);
  const isMaxSteerSkid =
    steeringMagnitudeForSkid >= CAR_PHYSICS.maxSteerSkidThreshold &&
    Math.abs(longitudinal) > CAR_PHYSICS.maxSteerSkidMinSpeed;

  carState.isDrifting = (handbrakePressed && Math.abs(lateral) > 1.2) || isMaxSteerSkid;

  // -------------------------------------------------------------------
  // 6) Atualiza posição com o vetor de velocidade real (não apenas um
  //    escalar), independente de FPS via dt.
  // -------------------------------------------------------------------
  const nextX = carState.position.x + carState.velocity.x * dt;
  const nextZ = carState.position.z + carState.velocity.z * dt;

  // Impede o carro de sair da área jogável (mureta invisível): a posição é
  // limitada ao quadrado de PLAY_BOUND, e bater na borda reduz a velocidade
  // como se fosse uma leve colisão.
  const clampedX = THREE.MathUtils.clamp(nextX, -PLAY_BOUND, PLAY_BOUND);
  const clampedZ = THREE.MathUtils.clamp(nextZ, -PLAY_BOUND, PLAY_BOUND);
  if (clampedX !== nextX || clampedZ !== nextZ) {
    carState.velocity.multiplyScalar(0.3);
  }

  carState.position.x = clampedX;
  carState.position.z = clampedZ;

  car.position.copy(carState.position);
  car.rotation.y = carState.heading;

  // Atualiza HUD (km/h) com a velocidade REAL do veículo (magnitude do
  // vetor de velocidade), não apenas a componente longitudinal — assim o
  // HUD reflete corretamente a velocidade também durante um drift.
  const kmh = carState.velocity.length() * 3.6;
  speedEl.textContent = kmh.toFixed(0);

  updateGearHud();
  updateDriftEffects(dt);
}

// ---------------------------------------------------------------------------
// Câmera em terceira pessoa, seguindo suavemente o carro
// ---------------------------------------------------------------------------

const cameraOffset = new THREE.Vector3(0, 3, -6.5);
const cameraLookOffset = new THREE.Vector3(0, 1.2, 3);
const desiredCameraPos = new THREE.Vector3();
const desiredLookAt = new THREE.Vector3();

// Órbita adicional controlada pelo usuário com o mouse. Quando o botão é
// solto, esses valores voltam suavemente para 0 (posição original atrás do
// carro).
const cameraOrbit = { yaw: 0, pitch: 0 };
const ORBIT_PITCH_MIN = -0.45;
const ORBIT_PITCH_MAX = 0.95;
const ORBIT_SENSITIVITY = 0.006;

let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;

renderer.domElement.style.cursor = 'grab';

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (shouldIgnoreCameraPointer(e.target)) return;
  isDragging = true;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  renderer.domElement.style.cursor = 'grabbing';
});

window.addEventListener('pointermove', (e) => {
  if (!isDragging || shouldIgnoreCameraPointer(e.target)) return;
  const deltaX = e.clientX - lastPointerX;
  const deltaY = e.clientY - lastPointerY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;

  cameraOrbit.yaw -= deltaX * ORBIT_SENSITIVITY;
  cameraOrbit.pitch = THREE.MathUtils.clamp(
    cameraOrbit.pitch + deltaY * ORBIT_SENSITIVITY,
    ORBIT_PITCH_MIN,
    ORBIT_PITCH_MAX
  );
});

function stopDragging() {
  isDragging = false;
  renderer.domElement.style.cursor = 'grab';
}

window.addEventListener('pointerup', stopDragging);
window.addEventListener('pointerleave', stopDragging);
window.addEventListener('blur', stopDragging);

function updateCamera(dt) {
  // Enquanto o usuário não estiver arrastando, a órbita relaxa de volta a 0
  if (!isDragging) {
    const returnSmoothing = 1 - Math.pow(0.0005, dt);
    cameraOrbit.yaw = THREE.MathUtils.lerp(cameraOrbit.yaw, 0, returnSmoothing);
    cameraOrbit.pitch = THREE.MathUtils.lerp(cameraOrbit.pitch, 0, returnSmoothing);
  }

  const totalYaw = carState.heading + cameraOrbit.yaw;

  // Aplica primeiro a inclinação (pitch) no eixo local X do offset e depois
  // o giro (yaw) no eixo Y, para orbitar ao redor do carro.
  const rotatedOffset = cameraOffset
    .clone()
    .applyAxisAngle(new THREE.Vector3(1, 0, 0), cameraOrbit.pitch)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), totalYaw);
  desiredCameraPos.copy(carState.position).add(rotatedOffset);

  const rotatedLook = cameraLookOffset.clone().applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    carState.heading
  );
  desiredLookAt.copy(carState.position).add(rotatedLook);

  const smoothing = 1 - Math.pow(0.001, dt); // suavização independente de FPS
  camera.position.lerp(desiredCameraPos, smoothing);
  camera.lookAt(desiredLookAt);
}

// ---------------------------------------------------------------------------
// Loop principal
// ---------------------------------------------------------------------------

// Câmera "ambiente" que orbita lentamente a origem enquanto o menu de
// seleção de carro está visível, dando vida ao fundo da tela.
let menuCameraAngle = 0;

function updateMenuCamera(dt) {
  menuCameraAngle += dt * 0.1;
  const radius = 13;
  camera.position.set(
    Math.sin(menuCameraAngle) * radius,
    5.5,
    Math.cos(menuCameraAngle) * radius
  );
  camera.lookAt(0, 1, 0);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); // evita saltos grandes se a aba perder foco

  if (isGameStarted) {
    updateCar(dt);
    updateCamera(dt);
  } else {
    updateMenuCamera(dt);
  }

  // Roda mesmo antes do jogo "começar" de fato (carro ainda carregando),
  // pois a conexão já foi aberta no momento da seleção do carro — assim os
  // outros jogadores já enxergam os carros remotos se moverem o quanto
  // antes, e nós já vemos os deles também.
  if (multiplayerTick) {
    multiplayerTick(dt);
  }

  renderer.render(scene, camera);
}

animate();