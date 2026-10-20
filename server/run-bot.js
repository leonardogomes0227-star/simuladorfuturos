#!/usr/bin/env node
// Roda uma checagem do robô no servidor (GitHub Actions) e grava o estado em JSON.
// Uso: node server/run-bot.js robo/config.json estado/estado.json
// É o mesmo js/bot.js do navegador: o resultado é igual ao de ficar com a aba aberta o tempo todo.
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../js/data.js');
const Bot = require('../js/bot.js');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

async function run({ configPath, statePath, fetchImpl, now }) {
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
      Bot.step(st, data, now);
      meta.lastOk = now;
      meta.net = ok < syms.length ? 'part' : 'ok';
    } else {
      meta.net = 'off';
    }
  }
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
  run({ configPath, statePath, fetchImpl: fetch }).then(({ st, meta }) => {
    const open = Bot.openTrades(st).length, closed = Bot.closedTrades(st).length;
    console.log(`robô ${st.running ? 'ligado' : 'desligado'} · rede: ${meta.net || '-'} · ${closed} fechadas, ${open} abertas · saldo ${Bot.balance(st).toFixed(2)}`);
    if (meta.configError) console.log('ATENÇÃO configuração: ' + meta.configError);
    meta.errors.forEach((e) => console.log('ATENÇÃO dados: ' + e));
  }).catch((e) => { console.error(e); process.exit(1); });
}
