#!/usr/bin/env node
// Roda uma checagem do robô no servidor (GitHub Actions) e grava o estado em JSON.
// Uso: node server/run-bot.js robo/config.json estado/estado.json
// É o mesmo js/bot.js do navegador: o resultado é igual ao de ficar com a aba aberta o tempo todo.
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../js/data.js');
const Bot = require('../js/bot.js');
const H = require('../js/hoje.js');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function fmtPrice(p) {
  const a = Math.abs(p), d = a >= 1000 ? 2 : (a >= 10 ? 3 : (a >= 1 ? 4 : (a >= 0.01 ? 5 : 8)));
  return p.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// Avisa no Telegram (opcional). Nunca derruba a rodada: erro vira meta.notify.error.
// Abertura só é avisada se o sinal ainda é recente (2 velas); depois de uma pausa longa ele já não vale.
async function notify(events, ready, tg, fetchImpl, now, tfMs) {
  const out = { sent: 0, error: '' };
  const fresh = events.filter((ev) => ev.type !== 'open' || now - ev.trade.openedAt <= 2 * tfMs);
  if (!tg || !tg.token || !tg.chatId || !fresh.length) return out;
  for (const ev of fresh.slice(0, 8)) {
    try {
      const res = await fetchImpl('https://api.telegram.org/bot' + tg.token + '/sendMessage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: tg.chatId, text: H.alertText(ev, ready, fmtPrice) })
      });
      if (!res.ok) throw new Error('Telegram respondeu HTTP ' + res.status);
      out.sent++;
    } catch (e) {
      out.error = String(e.message || e).replace(tg.token, '***');
    }
  }
  return out;
}

// Resultado da pesquisa walk-forward (pesquisa-<intervalo>.json), gravado pelo workflow de pesquisa ao lado do estado.
function readPesquisa(statePath, tf) {
  const j = readJson(path.join(path.dirname(statePath), 'pesquisa-' + tf + '.json'));
  if (!j || !j.verdict || !j.oos) return null;
  if (j.tf !== tf) return { mismatch: true, tf: j.tf };
  return { tf, generatedAt: j.generatedAt, recommended: !!j.verdict.recommended, passed: j.verdict.passed, total: j.verdict.checks.length,
    oosN: j.oos.n, oosAvgR: j.oos.avgR, oosPf: isFinite(j.oos.pf) ? j.oos.pf : null, coins: (j.coins || []).length };
}

// Mensagem de teste (workflow manual com "teste_telegram"): confirma que o token e o chat estão certos.
async function telegramTest(tg, st, fetchImpl) {
  if (!tg || !tg.token || !tg.chatId) return 'sem credenciais: crie os segredos TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID';
  const text = '✅ Radar de Futuros conectado ao Telegram.\nRobô ' + (st.running ? 'ligado' : 'desligado') + ' · velas de ' + st.cfg.tf + ' · ' + st.cfg.syms.join(', ') +
    '\n' + Bot.closedTrades(st).length + ' operações fechadas, ' + Bot.openTrades(st).length + ' abertas.\nVocê receberá um aviso quando o robô abrir ou fechar uma operação. Por enquanto tudo é SIMULAÇÃO.';
  try {
    const res = await fetchImpl('https://api.telegram.org/bot' + tg.token + '/sendMessage', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: tg.chatId, text })
    });
    if (!res.ok) {
      let why = '';
      try { why = (await res.json()).description || ''; } catch (e) { /* sem corpo */ }
      return 'erro: o Telegram respondeu HTTP ' + res.status + (why ? ' (' + why + ')' : '');
    }
    return 'enviado';
  } catch (e) {
    return 'erro: ' + String(e.message || e).replace(tg.token, '***');
  }
}

async function run({ configPath, statePath, fetchImpl, now, telegram }) {
  now = now || Date.now();
  const file = readJson(statePath) || {};
  const st = Bot.sanitize(file.state);
  const meta = Object.assign({ runs: 0, lastOk: 0, net: '', configError: '', errors: [] }, file.meta);

  const conf = readJson(configPath);
  const parsed = Bot.parseConfig(conf);
  if (parsed.error) {
    meta.configError = conf === null ? 'robo/config.json não encontrado ou com JSON inválido.' : parsed.error;
  } else {
    meta.configError = '';
    Bot.applyConfig(st, parsed, now);
  }

  meta.errors = [];
  delete meta.telegramTest; // vale só para a rodada que pediu o teste
  if (st.running) {
    const syms = st.cfg.syms, tf = st.cfg.tf;
    const res = await Promise.all(syms.map((sym) =>
      D.fetchKlines(sym, tf, 500, fetchImpl)
        .then((cs) => ({ sym, cs }))
        .catch((e) => { meta.errors.push(sym + ': ' + e.message); return null; })));
    const data = {};
    let ok = 0;
    res.forEach((r) => { if (r) { data[r.sym] = r.cs; st.prices[r.sym] = r.cs[r.cs.length - 1].c; ok++; } });
    if (ok) {
      const events = Bot.step(st, data, now);
      meta.notify = await notify(events, Bot.readiness(st, now).ready, telegram, fetchImpl, now, D.TFS[tf]);
      meta.lastOk = now;
      meta.net = ok < syms.length ? 'part' : 'ok';
    } else {
      meta.net = 'off';
    }
  }
  if (telegram && telegram.test) meta.telegramTest = await telegramTest(telegram, st, fetchImpl);
  meta.pesquisa = readPesquisa(statePath, st.cfg.tf);
  meta.lastRun = now;
  meta.runs += 1;
  meta.running = st.running;

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, state: st, meta }));
  return { st, meta };
}

module.exports = { run };

if (require.main === module) {
  const [configPath, statePath] = process.argv.slice(2);
  if (!configPath || !statePath) {
    console.error('Uso: node server/run-bot.js <config.json> <estado.json>');
    process.exit(2);
  }
  const telegram = { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, test: process.env.TELEGRAM_TEST === '1' };
  run({ configPath, statePath, fetchImpl: fetch, telegram }).then(({ st, meta }) => {
    const open = Bot.openTrades(st).length, closed = Bot.closedTrades(st).length;
    console.log(`robô ${st.running ? 'ligado' : 'desligado'} · rede: ${meta.net || '-'} · ${closed} fechadas, ${open} abertas · saldo ${Bot.balance(st).toFixed(2)}`);
    if (meta.configError) console.log('ATENÇÃO configuração: ' + meta.configError);
    meta.errors.forEach((e) => console.log('ATENÇÃO dados: ' + e));
    if (meta.telegramTest) console.log('TESTE DO TELEGRAM: ' + meta.telegramTest);
    if (meta.notify && (meta.notify.sent || meta.notify.error)) console.log('Telegram: ' + meta.notify.sent + ' aviso(s) enviado(s)' + (meta.notify.error ? ' · ERRO: ' + meta.notify.error : ''));
  }).catch((e) => { console.error(e); process.exit(1); });
}
