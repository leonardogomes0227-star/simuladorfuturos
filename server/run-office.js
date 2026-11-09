#!/usr/bin/env node
// Roda uma rodada do escritório de IAs (GitHub Actions) e grava o estado em JSON.
// Uso: node server/run-office.js escritorio/config.json estado/escritorio.json
// Tudo é SIMULAÇÃO: nada aqui envia ordem a corretora.
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('../js/data.js');
const O = require('../js/escritorio.js');
const P = require('./office-providers.js');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// Parâmetros do motor de sinais usados no briefing e pelo agente de referência.
const PARAMS = { minScore: 4, adxMin: 25, stopAtr: 2.5, rr: 3, trendP: 200, beR: 1 };

async function decide(agentCfg, a, ctx, markets, env, fetchImpl) {
  if (agentCfg.provider === 'regras') return O.rulesDecisions(a, markets, ctx);
  const kn = P.keyName(agentCfg), key = env[kn];
  if (!key) { a.status = 'sem chave'; a.error = 'Falta o segredo ' + kn + ' no GitHub (veja escritorio/LEIA-ME.md).'; return null; }
  const { system, user } = O.briefing(a, agentCfg, ctx, markets);
  a.usage.calls++;
  try {
    const r = await P.ask(agentCfg, key, system, user, fetchImpl);
    a.usage.inTok += r.inTok; a.usage.outTok += r.outTok;
    const parsed = O.parseDecision(r.text);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed;
  } catch (e) {
    a.usage.errors++;
    a.status = 'erro'; a.error = String(e.message || e).slice(0, 280);
    return { ok: false, error: a.error };
  }
}

async function run({ configPath, statePath, fetchImpl, now, env }) {
  now = now || Date.now();
  env = env || {};
  const file = readJson(statePath) || {};
  const st = O.sanitize(file.state);
  const meta = Object.assign({ runs: 0, configError: '', errors: [] }, file.meta);
  meta.errors = [];

  const parsed = O.parseConfig(readJson(configPath));
  if (parsed.error) {
    meta.configError = parsed.error;
  } else {
    meta.configError = '';
    O.sync(st, parsed, now);
    const cfg = parsed, tfMs = D.TFS[cfg.tf];
    meta.cfg = { on: cfg.on, tf: cfg.tf, syms: cfg.syms, capital: cfg.capital, rules: cfg.rules };

    const res = await Promise.all(cfg.syms.map((sym) =>
      D.fetchKlines(sym, cfg.tf, 500, fetchImpl).then((cs) => ({ sym, cs }))
        .catch((e) => { meta.errors.push(sym + ': ' + e.message); return null; })));
    const data = {}, prices = {};
    res.forEach((r) => { if (r) { data[r.sym] = r.cs; prices[r.sym] = r.cs[r.cs.length - 1].c; } });
    const mTf = D.macroTf(cfg.tf), dataHtf = {};
    if (mTf && Object.keys(data).length) {
      await Promise.all(Object.keys(data).map((sym) => D.fetchKlines(sym, mTf, 500, fetchImpl)
        .then((cs) => { dataHtf[sym] = cs; })
        .catch((e) => { meta.errors.push(sym + ' (' + mTf + '): ' + e.message); })));
    }

    if (Object.keys(data).length) {
      const markets = O.analyzeAll(cfg, data, dataHtf, now, PARAMS);
      const closedCandles = {};
      Object.keys(data).forEach((s) => { closedCandles[s] = markets[s] ? markets[s].closed : []; });
      const ctx = { now, tf: cfg.tf, syms: cfg.syms, prices, rules: cfg.rules };
      const refT = closedCandles[cfg.syms[0]] && closedCandles[cfg.syms[0]].length ? closedCandles[cfg.syms[0]].slice(-1)[0].t : 0;

      for (const agentCfg of cfg.agents) {
        const a = st.agents[agentCfg.id];
        // posições abertas sempre são acompanhadas (stop e alvo), mesmo se a IA estiver desligada
        O.markToMarket(a, closedCandles, now, cfg.rules);
        if (cfg.on && agentCfg.active) {
          // uma decisão por vela fechada: rodar de novo na mesma vela não gasta chamada
          if (a.decidedT !== refT || refT === 0) {
            const d = await decide(agentCfg, a, ctx, markets, env, fetchImpl);
            if (d && d.ok) {
              const out = O.applyDecisions(a, d.decisoes, ctx);
              a.decisions.push({ at: now, resumo: d.resumo, acoes: out.results });
              a.decidedT = refT; a.status = 'ok'; a.error = '';
            } else if (d) {
              a.decisions.push({ at: now, resumo: '', erro: d.error, acoes: [] });
              a.decidedT = refT;
            }
          }
        } else if (a.status !== 'sem chave') {
          a.status = 'desligado'; a.error = '';
        }
        if (a.decisions.length > O.KEEP.decisions) a.decisions = a.decisions.slice(-O.KEEP.decisions);
        a.lastRun = now;
        a.curve.push({ t: now, e: O.r2(O.equity(a, prices)) });
        if (a.curve.length > O.KEEP.curve) a.curve = a.curve.slice(-O.KEEP.curve);
      }
      meta.prices = prices;
      meta.lastOk = now;
      meta.net = Object.keys(data).length < cfg.syms.length ? 'part' : 'ok';
    } else {
      meta.net = 'off';
    }
  }
  meta.lastRun = now;
  meta.runs += 1;

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ version: 1, state: st, meta }));
  return { st, meta };
}

module.exports = { run };

if (require.main === module) {
  const [configPath, statePath] = process.argv.slice(2);
  if (!configPath || !statePath) {
    console.error('Uso: node server/run-office.js <config.json> <estado.json>');
    process.exit(2);
  }
  run({ configPath, statePath, fetchImpl: fetch, env: process.env }).then(({ st, meta }) => {
    if (meta.configError) console.log('ATENÇÃO configuração: ' + meta.configError);
    meta.errors.forEach((e) => console.log('ATENÇÃO dados: ' + e));
    Object.keys(st.agents).forEach((id) => {
      const a = st.agents[id];
      console.log(`${id.padEnd(14)} ${a.status.padEnd(10)} saldo ${O.equity(a, meta.prices || {}).toFixed(2)} · ${O.closedTrades(a).length} fechadas, ${O.openTrades(a).length} abertas${a.error ? ' · ' + a.error : ''}`);
    });
  }).catch((e) => { console.error(e); process.exit(1); });
}
