# Configuração do robô 24h

Edite `config.json` neste mesmo diretório (no GitHub: abra o arquivo, clique no lápis e faça o commit). O servidor lê o arquivo a cada checagem (a cada ~5 minutos).

| Campo | O que é | Valores |
| --- | --- | --- |
| `ligado` | liga ou desliga o robô | `true` ou `false` |
| `estrategia` | regra de entrada | `padrao`, `conservadora`, `agressiva`, `lenta` |
| `parametros` | opcional: troca `estrategia` por números seus (`emaF`, `emaM`, `emaS`, `adxMin`, `minScore`, `stopAtr`, `rr`) | objeto |
| `intervalo` | tamanho da vela | `1m`, `5m`, `15m`, `1h`, `4h`, `1d` |
| `moedas` | pares USDT da Binance | de 1 a 10, ex.: `"SUIUSDT"` |
| `capital` | saldo inicial simulado | 10 a 10.000.000 |
| `riscoPorOperacaoPct` | quanto do saldo se arrisca por operação | 0,1 a 5 |
| `alavancagem` | alavancagem simulada | 1 a 20 |
| `maxPosicoes` | operações abertas ao mesmo tempo | 1 a 10 |
| `limiteDiarioPct` | para de abrir novas no dia ao perder isso | 0,5 a 20 |
| `taxaPorLadoPct` | taxa da corretora por lado | 0 a 0,5 |
| `derrapagemPorLadoPct` | pior preço na execução, por lado | 0 a 1 |

Regras de segurança:

- Mudar `intervalo` ou `moedas` **encerra as posições abertas** ao último preço e recomeça a partir de agora.
- `capital` só muda se o histórico estiver vazio.
- Se o arquivo tiver erro, o servidor mantém a configuração anterior e mostra o erro no site.
