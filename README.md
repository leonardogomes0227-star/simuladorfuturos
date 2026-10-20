# Radar de Futuros

Simulador **educacional** de futuros. Mostra um sinal por regras (tendência, força, RSI, rompimento e volume), calcula o tamanho da posição pelo risco, registra um diário de operações simuladas e testa a estratégia no histórico. **Não envia ordens e não usa dinheiro real.**

Site estático, sem build e sem dependências. Abra `index.html` por um servidor local (`npm run serve`) ou publique em qualquer hospedagem estática.

## O que tem

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
| `js/app.js` | Interface e estado |
| `sw.js` | Cache offline. **Mude `VERSION` a cada publicação.** |

## Publicação

O site é estático (sem build) e está na Vercel: todo merge na branch padrão publica sozinho. A branch `robo-estado` (dados do robô, reescrita a cada 5 min) **não** deve gerar deploy; o workflow já grava um `vercel.json` nela para isso, e o `vercel.json` da raiz também a exclui. Qualquer hospedagem estática serve (GitHub Pages, Netlify). O workflow `.github/workflows/test.yml` roda os testes a cada push.

## Dados e privacidade

Tudo fica no `localStorage` do navegador. Use **Dados e backup** para exportar/importar o JSON. Os contadores de uso são locais; só são enviados a algum lugar se você definir `window.RADAR_ANALYTICS_URL` (vazio por padrão).

Os preços são do mercado **à vista** (spot) em USDT, parecidos com os de futuros mas não idênticos.
