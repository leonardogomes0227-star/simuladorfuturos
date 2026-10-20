# Radar de Futuros

Simulador **educacional** de futuros. Mostra um sinal por regras (tendência, força, RSI, rompimento e volume), calcula o tamanho da posição pelo risco, registra um diário de operações simuladas e testa a estratégia no histórico. **Não envia ordens e não usa dinheiro real.**

Site estático, sem build e sem dependências. Abra `index.html` por um servidor local (`npm run serve`) ou publique em qualquer hospedagem estática.

## O que tem

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
| `js/app.js` | Interface e estado |
| `sw.js` | Cache offline. **Mude `VERSION` a cada publicação.** |

## Publicação

O site é estático (sem build) e está na Vercel: todo merge na branch padrão publica sozinho. Qualquer hospedagem estática serve (GitHub Pages, Netlify). O workflow `.github/workflows/test.yml` roda os testes a cada push.

## Dados e privacidade

Tudo fica no `localStorage` do navegador. Use **Dados e backup** para exportar/importar o JSON. Os contadores de uso são locais; só são enviados a algum lugar se você definir `window.RADAR_ANALYTICS_URL` (vazio por padrão).

Os preços são do mercado **à vista** (spot) em USDT, parecidos com os de futuros mas não idênticos.
