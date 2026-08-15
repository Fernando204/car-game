# Jogo de Carro 3D — Multiplayer

## O que mudou

- **`server/`** — servidor Node.js único que faz duas coisas na mesma porta:
  1. Serve os arquivos do jogo por HTTP (`index.html`, `src/`, `assets/`).
  2. Roda o WebSocket que conecta os jogadores entre si.
- **`src/multiplayer.js`** — módulo do cliente que conecta ao servidor, manda a posição do
  seu carro e desenha/interpola os carros dos outros jogadores na cena.
- **`src/main.js`** e **`index.html`** — pequenos ajustes para conectar ao servidor assim
  que você seleciona um carro, e mostrar um indicador de status (canto superior esquerdo).

## Como funciona

- **Client-authoritative**: cada jogador continua rodando a física do próprio carro
  localmente (igual antes). O servidor só repassa (`relay`) a posição/direção de cada
  jogador para todos os outros, ~20 vezes por segundo.
- O jogador se conecta **assim que clica em "Selecionar"** no menu de carros — não
  precisa esperar o modelo 3D terminar de carregar.
- Os carros dos outros jogadores aparecem na cena e se movem por **interpolação**
  suave entre as posições recebidas (não têm física própria, só seguem os dados
  que chegam do servidor).
- Se o servidor cair ou não estiver rodando, o jogo continua funcionando normalmente
  em modo local (single-player) — só não aparecem outros carros.
- O cliente (`src/multiplayer.js`) conecta sempre ao **mesmo host:porta de onde a
  página foi carregada** — como HTTP e WebSocket agora compartilham a mesma porta,
  não existe nenhuma configuração de endereço/porta para ajustar no código.

## Como rodar

Só um comando, um único servidor cuida de tudo:

```bash
cd server
npm install
npm start
```

Depois abra **`http://localhost:8080`** no navegador (não abra o `index.html`
direto pelo `file://`, use sempre essa URL). Abra em duas abas/janelas para ver o
multiplayer funcionando entre elas.

Porta configurável via variável de ambiente, se precisar:

```bash
PORT=9000 npm start   # aí acesse http://localhost:9000
```

### Jogando em rede (não só localhost)

Se quiser jogar com alguém em outra máquina na mesma rede:

1. Descubra o IP local da máquina que vai hospedar (ex.: `192.168.0.10`).
2. Rode `npm start` nela normalmente (dentro de `server/`).
3. No(s) outro(s) computador(es), acesse `http://192.168.0.10:8080` no navegador.
   Tanto os arquivos do jogo quanto o WebSocket vêm do mesmo endereço, então não
   precisa mudar nada no código.

Para jogar pela internet (fora da rede local) você precisaria hospedar esse mesmo
servidor em algum provedor (Render, Fly.io, um VPS, etc.) — o código já está pronto
para isso, já que HTTP e WebSocket saem da mesma porta.


## Protocolo (mensagens JSON pelo WebSocket)

**Cliente → servidor**
- `{ type: 'join', car: 'mustang' }` — enviado uma vez, ao conectar.
- `{ type: 'state', position: {x,y,z}, heading, speed, gear, isDrifting }` — enviado
  periodicamente (~20x/s) enquanto joga.

**Servidor → cliente**
- `{ type: 'welcome', id, players: [...] }` — resposta ao `join`, com seu próprio id
  e a lista de quem já está na sala.
- `{ type: 'player-joined', id, car }` — um novo jogador entrou.
- `{ type: 'state', id, position, heading, speed, gear, isDrifting }` — atualização de
  posição de outro jogador.
- `{ type: 'player-left', id }` — um jogador saiu (desconectou).

## Possíveis próximos passos

- Nome/apelido acima de cada carro remoto (ex.: `CSS2DRenderer` do three.js).
- Detecção de colisão entre carros.
- Lobby/salas separadas em vez de todo mundo na mesma sala.
- Autoridade do servidor sobre a física, para evitar trapaças.
