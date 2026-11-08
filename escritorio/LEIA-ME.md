# Escritório de IAs

Cada IA tem uma conta própria de **100 USDT simulados** e opera no papel, com preço real da Binance. A IA só **propõe** (abrir, fechar, ajustar, manter). Quem aprova é o **gestor de risco em código**, igual para todas:

- risco máximo por operação, alavancagem máxima, máximo de posições, perda máxima do dia (valores em `config.json`);
- ordem sem stop é recusada; o stop só pode se aproximar do preço, nunca afrouxar;
- risco e alavancagem pedidos acima do limite são **reduzidos**, não obedecidos.

Nada aqui envia ordem a corretora. Existe um agente de referência (`regras`, sem IA) para você comparar: se uma IA não ganha dele, ela não está agregando.

## Como ligar (amanhã)

1. **Chaves.** No GitHub: *Settings → Secrets and variables → Actions → New repository secret*. Crie só as das IAs que for usar:
   `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`.
   Nunca coloque chave em arquivo do repositório.
2. **Ativar a IA.** Em `escritorio/config.json`, troque `"ativo": false` por `true` na IA desejada e confira o `"modelo"` (os nomes mudam; veja o site do provedor).
3. **Primeira rodada.** *Actions → Escritório de IAs → Run workflow*. Depois roda sozinho a cada ~15 min (o agendamento só vale com o workflow na branch padrão do repositório).
4. Abra o site, aba **Escritório**.

## Configuração (`config.json`)

| Campo | O que faz |
|---|---|
| `ligado` | `false` para as IAs pararem de decidir (posições abertas continuam sendo acompanhadas) |
| `intervalo` | vela de decisão: a IA decide **uma vez por vela fechada** |
| `moedas` | até 10 pares, ex.: `BTCUSDT` |
| `capitalPorIA` | saldo inicial de cada conta (só vale para contas novas) |
| `regras` | limites do gestor de risco |
| `agentes[]` | `id`, `nome`, `provedor` (`regras`, `anthropic`, `openai`, `gemini`, `xai`, `deepseek`), `modelo`, `estilo` (a personalidade da IA), `ativo`, e opcional `chaveEnv` (outro nome de segredo) |

IA ativa sem chave aparece como **sem chave** e não gasta nada. Resposta inválida da IA vira **erro** registrado, sem ordem.

## Custo

Uma consulta por IA a cada vela fechada (96 por dia em 15 min). A tela mostra consultas, erros e tokens de cada IA. Para gastar menos, use `intervalo` maior (`1h`, `4h`).

## Dinheiro real

Não está implementado, de propósito. Antes disso: algumas semanas de placar, conta separada na corretora e chave de API **sem permissão de saque**.
