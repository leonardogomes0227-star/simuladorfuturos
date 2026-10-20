# Radar de Futuros

Simulador **educacional** de futuros. Mostra um sinal por regras (tendência, força, RSI, rompimento e volume), calcula o tamanho da posição pelo risco, registra um diário de operações simuladas e testa a estratégia no histórico. **Não envia ordens e não usa dinheiro real.**

Site estático, sem build e sem dependências. Abra `index.html` por um servidor local (`npm run serve`) ou publique em qualquer hospedagem estática.

## O que tem

- **Hoje** (tela inicial): uma resposta só, em palavras (HÁ OPORTUNIDADE, ESPERAR, SÓ SIMULAR ou NÃO OPERAR HOJE). Mostra os sinais do robô com preço ao vivo, janela de entrada (se o preço já passou do ponto, manda não entrar), stop, alvo e **quanto comprar com o seu dinheiro** (em R$ ou USDT, arriscando 0,25% a 1% e com alavancagem máxima que você define). Tem limite de perda do dia e da semana e uma **trava de segurança**: enquanto o robô não passar no placar de prontidão, a tela diz SÓ SIMULAR.
- **Avisos no Telegram** (opcional) quando o robô abre ou fecha uma operação (veja `robo/LEIA-ME.md`).

- **Robô de simulação** (tela principal): opera sozinho no papel, vela fechada a vela fechada, em várias moedas, com a estratégia escolhida. Aplica taxa, derrapagem, limite diário e máximo de posições. Mostra saldo, curva, posições abertas com o motivo da entrada, histórico e um placar de "pronto para operar de verdade?". Roda enquanto a aba estiver aberta e, ao reabrir, **recupera o que perdeu** reprocessando o histórico da Binance (até 500 velas), com o mesmo resultado que teria em tempo real. Para rodar 24h sem aba aberta seria preciso um servidor.
- **Robô 24h no servidor**: o workflow `.github/workflows/robo.yml` roda `server/run-bot.js` a cada ~5 minutos no GitHub Actions (grátis, com o computador desligado) e grava o estado na branch `robo-estado`; o site só lê. A configuração fica em `robo/config.json` (veja `robo/LEIA-ME.md`). É o mesmo `js/bot.js` do navegador, e o histórico se recupera sozinho se o GitHub atrasar uma rodada.
- **Testar antes de ligar**: backtest de todas as estratégias nas moedas escolhidas.

- **Dados reais**: velas da Binance (API pública, sem chave) por WebSocket, com fallback para atualização a cada 5 s; intervalos de 1 min a 1 dia; busca de qualquer par USDT. Também há dados simulados e importação de CSV.
- **Treino cego**: no CSV, esconde o futuro e libera uma vela por vez, com velocidade ajustável.
- **Ordens**: sinal automático ou plano manual (Comprar/Vender), com stop e alvo ajustáveis digitando ou arrastando as linhas no gráfico.
- **Gráfico**: zoom (roda do mouse, `+`/`-`), mover arrastando, mira com preço, tela cheia.
- **Diário**: filtros, tags, nota pós-trade, exportação em CSV, desfazer.
- **Desempenho**: curva de saldo, expectativa, fator de lucro, maior queda, R médio, quebra por lado, saída, ativo, tag, hora e dia da semana.
- **Estratégia**: parâmetros editáveis, estratégias salvas e comparação lado a lado no backtest.
- **Risco**: limite diário e semanal, pausa após perdas seguidas, risco aberto máximo, alerta de posições correlacionadas e preço de liquidação.
- **App**: PWA instalável e offline, tema claro/escuro, atalhos de teclado (`?` mostra a lista), backup em JSON.

## Arquitetura

```
Binance ──► data.js ──► engine.js ──► radar.js ──► tela Hoje (semáforo por moeda)
 (REST/WS)  tentativas,   indicadores,   só vela     app.js + css
            disjuntor,    ADX, intervalo fechada,
            saúde dos     maior, lista    semáforo
            dados         de critérios        │
                              │               └──► narrativa.js (frases claras)
                              ├──► bot.js ──► server/run-bot.js (GitHub Actions, a cada ~5 min)
                              └──► server/research.js (validação walk-forward)
```

Regra de ouro: **nenhum módulo de lógica toca no DOM**. `data`, `engine`, `metrics`, `radar`, `narrativa`, `hoje`, `bot` rodam igual no navegador, no servidor e nos testes; só `app.js` conhece a tela.

### Filtros de segurança (o semáforo)

Cada moeda é analisada **só com velas fechadas** (a vela em formação é descartada antes de qualquer conta) e recebe uma cor:

| Cor | Quando |
| --- | --- |
| 🟢 Pronto para operar | todos os critérios obrigatórios passaram na última vela fechada e os dados estão em dia |
| 🟡 Mercado lateral ou atenção | ADX abaixo do mínimo (mercado travado), preço esticado (RSI) ou faltou pouco para os critérios fecharem |
| 🔴 Fora dos critérios | sem alinhamento, **contra a tendência do intervalo maior**, ou dados atrasados |

Critérios obrigatórios: força da tendência (ADX ≥ mínimo, padrão 20), médias para o mesmo lado, pontuação mínima, sem exagero de RSI e, com `confirmacaoMacro`, **alinhamento com a tendência do intervalo maior** (15m↔4h, 1h↔4h, 4h↔1d). A tendência maior de cada vela usa só velas do intervalo maior **já fechadas naquele instante** (teste automático garante que cortar o fim dos dados não muda o passado). Sem dados do intervalo maior, o sistema falha para o lado seguro: não abre posição nova.

### Resiliência dos dados

`data.js` tenta de novo com espera crescente (400 ms, 800 ms…), respeita `Retry-After` do erro 429, pula direto para o servidor reserva em 451/403 (bloqueio regional), abre um "disjuntor" depois de falhas seguidas, corrige/descarta velas inválidas e mede a saúde da série (atraso da última vela fechada e buracos). Ao vivo, uma vela que pula o intervalo dispara a reconstrução pelo REST e, a cada minuto, as últimas velas são reconciliadas mesmo com o WebSocket ligado.

## Pesquisa e "treino" da estratégia

`server/research.js` faz **otimização walk-forward**: escolhe os parâmetros numa janela de 9 meses e testa nos 3 meses seguintes, que o otimizador nunca viu, repetindo ao longo de 2,5 anos de dados reais de várias moedas, já com taxa e derrapagem. Só o resultado fora da amostra conta. Se ele não mostrar vantagem, o relatório diz **NÃO RECOMENDADA**. Rode em Actions → *Pesquisa da estratégia*.

Recursos que a estratégia pode usar (todos desligados por padrão): filtro de tendência longa, filtro de volatilidade, stop no breakeven, stop móvel (trailing), saída por tempo e pausa depois de um stop. O robô e o backtest usam exatamente a mesma regra (`E.stepTrade`), com teste automático garantindo que produzem as mesmas operações.

## Desenvolvimento

```
npm test        # testes do motor, das métricas e dos dados (Node 20+, sem dependências)
npm run serve   # servidor local em http://localhost:8080
```

Estrutura:

| Arquivo | Papel |
| --- | --- |
| `js/engine.js` | Indicadores, sinal, dimensionamento, backtest, leitura de CSV (puro, testado) |
| `js/metrics.js` | Métricas do diário, exposição, exportação (puro, testado) |
| `js/data.js` | Cliente da Binance: REST, WebSocket, fallback (testado com `fetch` simulado) |
| `js/bot.js` | Robô de simulação: passo a passo determinístico, recuperação, prontidão (puro, testado) |
| `server/run-bot.js` | Uma checagem do robô no servidor (lê a config, busca velas, grava o estado) |
| `js/radar.js` | Semáforo por moeda: junta intervalo base e maior, só vela fechada (puro, testado) |
| `js/narrativa.js` | Traduz logs, erros e operações em frases claras (puro, testado) |
| `js/hoje.js` | Veredito do dia, tamanho de posição e janela de entrada (puro, testado) |
| `js/app.js` | Interface e estado |
| `sw.js` | Cache offline. **Mude `VERSION` a cada publicação.** |

## Publicação

O site é estático (sem build) e está na Vercel: todo merge na branch padrão publica sozinho. A branch `robo-estado` (dados do robô, reescrita a cada 5 min) **não** deve gerar deploy; o workflow já grava um `vercel.json` nela para isso, e o `vercel.json` da raiz também a exclui. Qualquer hospedagem estática serve (GitHub Pages, Netlify). O workflow `.github/workflows/test.yml` roda os testes a cada push.

## Dados e privacidade

Tudo fica no `localStorage` do navegador. Use **Dados e backup** para exportar/importar o JSON. Os contadores de uso são locais; só são enviados a algum lugar se você definir `window.RADAR_ANALYTICS_URL` (vazio por padrão).

Os preços são do mercado **à vista** (spot) em USDT, parecidos com os de futuros mas não idênticos.
