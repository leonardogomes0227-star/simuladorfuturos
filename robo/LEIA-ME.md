# Configuração do robô 24h

Edite `config.json` neste mesmo diretório (no GitHub: abra o arquivo, clique no lápis e faça o commit). O servidor lê o arquivo a cada checagem (a cada ~5 minutos).

| Campo | O que é | Valores |
| --- | --- | --- |
| `confirmacaoMacro` | **só opera a favor da tendência do intervalo maior** (15m com 4h, 1h com 4h, 4h com 1 dia). Sem dados do intervalo maior, o robô não abre posição nova | `true` ou `false` |
| `ligado` | liga ou desliga o robô | `true` ou `false` |
| `estrategia` | regra de entrada | `padrao`, `conservadora`, `agressiva`, `lenta` |
| `parametros` | opcional: troca `estrategia` por números seus: `emaF`, `emaM`, `emaS`, `adxMin`, `minScore`, `stopAtr`, `rr` e os recursos extras `trendP` (média longa de tendência), `beR` (stop no breakeven após esse lucro em R), `trailAtr` (stop móvel em ATR), `maxBars` (saída por tempo), `atrMinPct`/`atrMaxPct` (filtro de volatilidade) e `cooldown` (pausa em velas depois de uma perda). Tudo que não for informado fica desligado | objeto |
| `intervalo` | tamanho da vela | `1m`, `5m`, `15m`, `1h`, `4h`, `1d` |
| `moedas` | pares USDT da Binance | de 1 a 10, ex.: `"SUIUSDT"` |
| `capital` | saldo inicial simulado | 10 a 10.000.000 |
| `riscoPorOperacaoPct` | quanto do saldo se arrisca por operação | 0,1 a 5 |
| `alavancagem` | alavancagem simulada | 1 a 20 |
| `maxPosicoes` | operações abertas ao mesmo tempo | 1 a 10 |
| `limiteDiarioPct` | para de abrir novas no dia ao perder isso | 0,5 a 20 |
| `taxaPorLadoPct` | taxa da corretora por lado | 0 a 0,5 |
| `derrapagemPorLadoPct` | pior preço na execução, por lado | 0 a 1 |
| `zerarHistorico` | opcional: **troque o texto** para começar uma conta nova (apaga operações e recomeça o placar de prontidão). O mesmo texto não zera de novo. Use ao mudar estratégia ou intervalo | qualquer texto, ex.: `"fase3"` |

Regras de segurança:

- Mudar `intervalo` ou `moedas` **encerra as posições abertas** ao último preço e recomeça a partir de agora.
- `capital` só muda se o histórico estiver vazio.
- Se o arquivo tiver erro, o servidor mantém a configuração anterior e mostra o erro no site.

## Avisos no Telegram (opcional)

O robô pode te avisar quando surgir um sinal novo ou quando uma operação fechar. Só avisa abertura se o sinal for recente (até 2 velas), para você não agir em cima de sinal velho.

1. No Telegram, converse com o **@BotFather**, envie `/newbot` e guarde o **token** que ele devolver.
2. Mande uma mensagem qualquer para o seu bot novo. Depois abra `https://api.telegram.org/bot<TOKEN>/getUpdates` e copie o número em `"chat":{"id":...}`.
3. No GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Crie `TELEGRAM_BOT_TOKEN` (o token) e `TELEGRAM_CHAT_ID` (o número).

4. **Teste na hora**: em Actions → *Robô 24h* → Run workflow, marque **Enviar uma mensagem de teste ao Telegram** e rode. A mensagem chega em segundos; o log da execução diz `TESTE DO TELEGRAM: enviado` ou o motivo do erro (por exemplo, segredo faltando ou token errado). Antes de testar, abra o seu bot no Telegram e toque em **Iniciar** (`/start`), senão o Telegram não deixa o bot escrever para você.

Enquanto o robô estiver em simulação, todo aviso vem marcado como **SIMULAÇÃO**. O GitHub pode atrasar as rodadas agendadas em algumas horas; por isso o aviso diz até onde o preço ainda vale a entrada.

## Validação em anos de dados reais

O site só libera "HÁ OPORTUNIDADE" quando a pesquisa walk-forward do **mesmo intervalo** do robô for aprovada, além do histórico do próprio robô. Rode em Actions → *Pesquisa da estratégia* (informe o mesmo intervalo do `config.json`); o veredito é gravado ao lado do estado do robô e aparece na tela Hoje. Se a pesquisa for reprovada, a tela fica em **SÓ SIMULAR**.
