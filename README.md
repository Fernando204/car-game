# 🏎️ Jogo de Carro 3D

Um jogo de arcade de direção em 3D, feito com [Three.js](https://threejs.org/), com
física de carro simples (câmbio manual, RPM, derrapagem/drift), cenário com
rotatória e agora **multiplayer** via WebSocket.

## Índice

- [Como jogar](#como-jogar)
- [Controles](#controles)
- [Carros disponíveis](#carros-dispon%C3%ADveis)
- [Multiplayer](#multiplayer)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Requisitos](#requisitos)
- [Detalhes técnicos](#detalhes-t%C3%A9cnicos)
- [Próximos passos](#pr%C3%B3ximos-passos)

## Como jogar

```bash
cd server
npm install
npm start
```

Depois abra **`http://localhost:8080`** no navegador.

> ⚠️ Não abra o `index.html` direto pelo `file://` — o jogo precisa ser servido
> pelo servidor Node (ele serve os arquivos **e** cuida do multiplayer ao mesmo
> tempo). Veja a seção [Multiplayer](#multiplayer) para mais detalhes e para
> jogar com outra pessoa.

Ao abrir, escolha um carro na tela inicial e clique em **Selecionar** para
entrar na pista.

## Controles

| Tecla         | Ação                     |
|---------------|--------------------------|
| `W`           | Acelerar                 |
| `S`           | Ré / Frear               |
| `A`           | Virar à esquerda         |
| `D`           | Virar à direita          |
| `Espaço`      | Freio de mão (drift)     |
| `E`           | Subir marcha             |
| `Q`           | Reduzir marcha           |

Na tela do jogo também há botões para **trocar de carro** (volta ao menu de
seleção) e **reiniciar posição** (recoloca o carro no ponto de partida).

## Carros disponíveis

- **Mustang** — modelo mais longo, câmbio de 5 marchas.
- **Palio** — modelo mais compacto.

Cada carro tem seu próprio ajuste de escala/rotação (`CAR_CATALOG` em
`src/main.js`) para compensar diferenças de orientação e tamanho entre os
modelos `.glb`.

### Câmbio e RPM

O carro tem câmbio manual de 5 marchas + ré, cada uma com sua faixa de RPM e
velocidade máxima — suba (`E`) e reduza (`Q`) as marchas para acelerar mais
rápido ou ganhar torque nas curvas. O RPM e a marcha atual aparecem no HUD.

### Drift

Segurando o freio de mão (`Espaço`) enquanto vira, o carro perde grip
traseiro e derrapa — útil para fazer curvas fechadas na rotatória do mapa.

## Multiplayer

O jogo tem multiplayer básico: assim que você seleciona um carro, o jogo se
conecta automaticamente ao servidor e você passa a ver (e ser visto pelos)
outros jogadores conectados, em tempo real.

- **Um único servidor Node** (`server/server.js`) cuida de tudo — serve os
  arquivos do jogo por HTTP e roda o WebSocket na mesma porta. Não precisa
  configurar endereço nem porta no código do cliente.
- **Client-authoritative**: cada jogador roda a física do próprio carro
  localmente; o servidor só repassa (`relay`) a posição/direção de cada um
  para os demais, ~20 vezes por segundo.
- Os carros dos outros jogadores se movem por **interpolação suave** entre as
  posições recebidas.
- Se o servidor cair ou não estiver rodando, o jogo continua funcionando
  normalmente em modo local (single-player) — só não aparecem outros carros.
  Um indicador no canto superior esquerdo mostra o status da conexão e quantos
  outros jogadores estão online.

### Jogando com outra pessoa

**Na mesma máquina:** abra `http://localhost:8080` em duas abas/janelas.

**Na mesma rede:**
1. Descubra o IP local de quem vai hospedar (ex.: `192.168.0.10`).
2. Rode `npm start` nessa máquina, dentro de `server/`.
3. Nos outros computadores, acesse `http://192.168.0.10:8080` no navegador.

**Porta customizada**, se precisar:
```bash
PORT=9000 npm start   # aí acesse http://localhost:9000
```

Para jogar pela internet (fora da rede local), seria preciso hospedar esse
mesmo servidor num provedor (Render, Fly.io, um VPS, etc.) — o código já está
pronto para isso, já que HTTP e WebSocket saem da mesma porta.

<details>
<summary>Protocolo de mensagens (JSON via WebSocket)</summary>

**Cliente → servidor**
- `{ type: 'join', car: 'mustang' }` — enviado uma vez, ao conectar.
- `{ type: 'state', position: {x,y,z}, heading, speed, gear, isDrifting }` —
  enviado periodicamente (~20x/s) enquanto joga.

**Servidor → cliente**
- `{ type: 'welcome', id, players: [...] }` — resposta ao `join`, com seu
  próprio id e a lista de quem já está na sala.
- `{ type: 'player-joined', id, car }` — um novo jogador entrou.
- `{ type: 'state', id, position, heading, speed, gear, isDrifting }` —
  atualização de posição de outro jogador.
- `{ type: 'player-left', id }` — um jogador saiu (desconectou).

</details>

## Estrutura do projeto

```
.
├── index.html              # tela de seleção de carro + HUD do jogo
├── src/
│   ├── main.js              # física do carro, cena 3D, câmera, HUD
│   └── multiplayer.js       # conexão WebSocket, carros remotos, interpolação
├── assets/
│   ├── mustang.glb
│   ├── carro.glb
│   └── previews/
│       └── mustang.jpg
├── server/
│   ├── server.js            # HTTP estático + WebSocket, mesma porta
│   └── package.json
└── README.md
```

## Requisitos

- [Node.js](https://nodejs.org/) 18+ (usa `node:crypto` → `randomUUID` e ES
  Modules).
- Navegador atual com suporte a WebGL e ES Modules (Chrome, Firefox, Edge,
  Safari recentes).
- Não precisa de build/bundler — o Three.js é carregado via `importmap` direto
  de um CDN (`unpkg.com`), então é necessário estar conectado à internet ao
  abrir o jogo.

## Detalhes técnicos

- **Motor gráfico:** Three.js (`r160`), modelos de carro em `.glb`
  carregados via `GLTFLoader`.
- **Física:** simulação simplificada própria (não usa engine de física
  externa) — aceleração/curva/drift calculados a cada frame com base no
  câmbio, grip lateral e velocidade.
- **Câmera:** câmera de perseguição (chase cam) que segue o carro; sem
  controle de mouse/órbita.
- **Servidor:** Node.js puro (`node:http` + [`ws`](https://www.npmjs.com/package/ws)),
  sem framework — arquivos estáticos servidos manualmente com mapeamento de
  mime-types (incluindo `text/javascript` para os módulos ES e
  `model/gltf-binary` para os `.glb`).

## Próximos passos

- Nome/apelido acima de cada carro remoto (ex.: `CSS2DRenderer` do three.js).
- Detecção de colisão entre carros.
- Lobby/salas separadas em vez de todo mundo na mesma sala.
- Autoridade do servidor sobre a física, para evitar trapaças.
- Sistema de corrida (checkpoints, tempo de volta, ranking).
