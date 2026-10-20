#!/usr/bin/env node
// Pesquisa da estratégia com validação walk-forward.
// Otimiza os parâmetros numa janela de treino, testa na janela seguinte (que o otimizador nunca viu) e repete.
// Só o resultado fora da amostra conta: é a única medida honesta de se a estratégia tem vantagem.
// Uso: node server/research.js --months 30 --coins BTCUSDT,ETHUSDT --tf 1h --out pesquisa.json
'use strict';
const fs = require('fs');
const E = require('../js/engine.js');
const D = require('../js/data.js');

const DAY = 86400000;
const COSTS = { fee: 0.05, slip: 0.02 }; // % por lado, iguais aos do robô

// Combinações testadas. Grade pequena de propósito: quanto mais combinações, maior o risco de decorar o passado.
function buildGrid() {
  const mgmt = [{ beR: 0, trailAtr: 0 }, { beR: 1, trailAtr: 0 }, { beR: 1, trailAtr: 2.5 }];
  const out = [];
  // htf: 0 = sem confirmação; 1 = só opera a favor da tendência do intervalo maior (exige dados do intervalo maior)
  [4, 5].forEach((minScore) => [20, 25].forEach((adxMin) => [1.5, 2.5].forEach((stopAtr) => [2, 3].forEach((rr) => [0, 200].forEach((trendP) => [0, 1].forEach((htf) => mgmt.forEach((m) => {
    out.push(E.normParams(Object.assign({ minScore, adxMin, stopAtr, rr, trendP, htf }, m)));
  })))))));
  return out;
}

function lowerBound(cs, t) {
  let lo = 0, hi = cs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cs[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo;
}
function indKey(P) { return [P.emaF, P.emaM, P.emaS, P.trendP, P.htf].join('|'); }
function getInd(ds, P) {
  const k = indKey(P);
  if (!ds.inds[k]) ds.inds[k] = E.computeIndicators(ds.cs, P, P.htf ? ds.htf : null);
  return ds.inds[k];
}

function stats(trades) {
  const sorted = trades.slice().sort((a, b) => a.t - b.t);
  const n = sorted.length;
  let gw = 0, gl = 0, sum = 0, wins = 0, cum = 0, peak = 0, dd = 0;
  sorted.forEach((x) => {
    sum += x.R; cum += x.R;
    if (x.R > 0) { wins++; gw += x.R; } else gl -= x.R;
    if (cum > peak) peak = cum;
    if (peak - cum > dd) dd = peak - cum;
  });
  const avg = n ? sum / n : 0;
  let v = 0; sorted.forEach((x) => { v += (x.R - avg) * (x.R - avg); });
  const std = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
  return { n, wins, winRate: n ? wins / n * 100 : 0, totalR: sum, avgR: avg, std, tStat: std > 0 ? avg / (std / Math.sqrt(n)) : 0,
    pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), maxDD: dd };
}

// Resultado agrupado de todas as moedas num intervalo de tempo [tFrom, tTo).
function evalRange(datasets, P, tFrom, tTo, costs) {
  const trades = [];
  datasets.forEach((ds) => {
    const from = lowerBound(ds.cs, tFrom), to = lowerBound(ds.cs, tTo);
    if (to - from < 50) return;
    const bt = E.backtest(ds.cs, getInd(ds, P), costs.fee, P, costs.slip, from, to);
    bt.trades.forEach((x) => trades.push({ R: x.R, t: ds.cs[x.j].t, sym: ds.sym, why: x.why }));
  });
  return { trades, s: stats(trades) };
}

// Nota usada no treino: confiança estatística da vantagem (média / erro padrão), só se houver amostra e fator de lucro > 1.
function objective(s, minTrades) {
  if (s.n < minTrades || !(s.pf > 1) || !(s.avgR > 0)) return -Infinity;
  return s.tStat;
}

function walkForward(datasets, opt) {
  const o = Object.assign({ trainMs: 270 * DAY, testMs: 90 * DAY, stepMs: 90 * DAY, minTrades: 40, costs: COSTS, grid: buildGrid() }, opt);
  const t0 = Math.max.apply(null, datasets.map((d) => d.cs[0].t));
  const t1 = Math.min.apply(null, datasets.map((d) => d.cs[d.cs.length - 1].t));
  const baseP = E.normParams({});
  const windows = [], chosenTrades = [], baseTrades = [], gridPool = o.grid.map(() => []);
  for (let a = t0; a + o.trainMs + o.testMs <= t1 + 1; a += o.stepMs) {
    const trainEnd = a + o.trainMs, testEnd = trainEnd + o.testMs;
    let best = null, bestScore = -Infinity;
    o.grid.forEach((P) => {
      const sc = objective(evalRange(datasets, P, a, trainEnd, o.costs).s, o.minTrades);
      if (sc > bestScore) { bestScore = sc; best = P; }
    });
    const train = best ? evalRange(datasets, best, a, trainEnd, o.costs).s : null;
    const test = best ? evalRange(datasets, best, trainEnd, testEnd, o.costs) : { trades: [], s: stats([]) };
    const base = evalRange(datasets, baseP, trainEnd, testEnd, o.costs);
    o.grid.forEach((P, i) => { evalRange(datasets, P, trainEnd, testEnd, o.costs).trades.forEach((x) => gridPool[i].push(x)); });
    test.trades.forEach((x) => chosenTrades.push(x));
    base.trades.forEach((x) => baseTrades.push(x));
    windows.push({ trainFrom: a, trainTo: trainEnd, testTo: testEnd, params: best, train, test: test.s, base: base.s });
  }
  const gridStats = gridPool.map((tr) => stats(tr));
  const sortedTotals = gridStats.map((g) => g.totalR).sort((x, y) => x - y);
  return {
    windows, oos: stats(chosenTrades), baseline: stats(baseTrades),
    grid: { combos: o.grid.length, positiveShare: gridStats.filter((g) => g.totalR > 0).length / o.grid.length, medianTotalR: sortedTotals[Math.floor(sortedTotals.length / 2)] || 0,
      bestTotalR: sortedTotals[sortedTotals.length - 1] || 0, worstTotalR: sortedTotals[0] || 0 }
  };
}

// Critério para recomendar: amostra, vantagem por operação, fator de lucro e consistência entre janelas.
function verdict(wf) {
  const w = wf.windows.filter((x) => x.test.n > 0), pos = w.filter((x) => x.test.totalR > 0).length;
  const checks = [
    { ok: wf.oos.n >= 100, label: 'Pelo menos 100 operações fora da amostra', detail: String(wf.oos.n) },
    { ok: wf.oos.avgR >= 0.05, label: 'Média de pelo menos +0,05R por operação', detail: wf.oos.avgR.toFixed(3) + 'R' },
    { ok: wf.oos.pf >= 1.15, label: 'Fator de lucro de pelo menos 1,15', detail: isFinite(wf.oos.pf) ? wf.oos.pf.toFixed(2) : 'sem perdas' },
    { ok: w.length > 0 && pos >= Math.ceil(w.length * 0.6), label: 'Lucro em pelo menos 60% das janelas de teste', detail: pos + ' de ' + w.length },
    { ok: wf.oos.totalR > wf.baseline.totalR, label: 'Melhor que a estratégia padrão sem otimização', detail: wf.oos.totalR.toFixed(1) + 'R contra ' + wf.baseline.totalR.toFixed(1) + 'R' }
  ];
  return { checks, passed: checks.filter((c) => c.ok).length, recommended: checks.every((c) => c.ok) };
}

// Melhor combinação usando os últimos `ms` de dados, com a estabilidade por trimestre.
function finalSelection(datasets, grid, ms, costs, minTrades) {
  const t1 = Math.min.apply(null, datasets.map((d) => d.cs[d.cs.length - 1].t)), t0 = t1 - ms;
  const ranked = grid.map((P) => ({ P, s: evalRange(datasets, P, t0, t1, costs).s }))
    .map((x) => Object.assign(x, { score: objective(x.s, minTrades) })).filter((x) => x.score > -Infinity).sort((a, b) => b.score - a.score).slice(0, 5);
  const q = ms / 4;
  return ranked.map((x) => {
    const quarters = [0, 1, 2, 3].map((k) => evalRange(datasets, x.P, t0 + k * q, t0 + (k + 1) * q, costs).s);
    return { params: x.P, s: x.s, quarters: quarters.map((s) => ({ n: s.n, totalR: s.totalR })), positiveQuarters: quarters.filter((s) => s.totalR > 0).length };
  });
}

function fmtDate(t) { return new Date(t).toISOString().slice(0, 10); }
function f2(n) { return isFinite(n) ? n.toFixed(2) : '∞'; }
function row(s) { return s.n + ' ops · acerto ' + s.winRate.toFixed(0) + '% · ' + (s.totalR >= 0 ? '+' : '') + f2(s.totalR) + 'R · média ' + (s.avgR >= 0 ? '+' : '') + s.avgR.toFixed(3) + 'R · FL ' + f2(s.pf) + ' · queda ' + f2(s.maxDD) + 'R'; }
function pstr(P) { return 'pontos ' + P.minScore + ', ADX ' + P.adxMin + ', stop ' + P.stopAtr + 'ATR, alvo ' + P.rr + 'x, tendência ' + (P.trendP || 'off') + ', breakeven ' + (P.beR || 'off') + ', trailing ' + (P.trailAtr || 'off') + ', intervalo maior ' + (P.htf ? 'on' : 'off'); }

function report(datasets, wf, v, finals) {
  const L = [];
  L.push('# Pesquisa walk-forward');
  L.push('Moedas: ' + datasets.map((d) => d.sym).join(', ') + ' · velas de ' + datasets[0].tf + ' · de ' + fmtDate(Math.max.apply(null, datasets.map((d) => d.cs[0].t))) + ' a ' + fmtDate(Math.min.apply(null, datasets.map((d) => d.cs[d.cs.length - 1].t))));
  L.push('Custos: ' + COSTS.fee + '% de taxa + ' + COSTS.slip + '% de derrapagem por lado. R = lucro em múltiplos do risco da operação.\n');
  L.push('## Janelas (treino 9 meses, teste 3 meses seguintes, nunca vistos pelo otimizador)');
  wf.windows.forEach((w, i) => {
    L.push((i + 1) + '. treino ' + fmtDate(w.trainFrom) + '..' + fmtDate(w.trainTo) + ' / teste até ' + fmtDate(w.testTo));
    L.push('   escolhida: ' + (w.params ? pstr(w.params) : 'nenhuma passou no treino (o robô ficaria fora)'));
    if (w.train) L.push('   treino : ' + row(w.train));
    L.push('   TESTE  : ' + row(w.test));
    L.push('   padrão : ' + row(w.base));
  });
  L.push('\n## Resultado fora da amostra (soma de todos os testes)');
  L.push('Estratégia treinada : ' + row(wf.oos));
  L.push('Estratégia padrão   : ' + row(wf.baseline));
  L.push('Das ' + wf.grid.combos + ' combinações da grade, ' + (wf.grid.positiveShare * 100).toFixed(0) + '% deram lucro fora da amostra; mediana ' + f2(wf.grid.medianTotalR) + 'R, melhor ' + f2(wf.grid.bestTotalR) + 'R, pior ' + f2(wf.grid.worstTotalR) + 'R.');
  L.push('\n## Veredito: ' + (v.recommended ? 'RECOMENDADA' : 'NÃO RECOMENDADA') + ' (' + v.passed + ' de ' + v.checks.length + ' critérios)');
  v.checks.forEach((c) => L.push((c.ok ? '[x] ' : '[ ] ') + c.label + ': ' + c.detail));
  L.push('\n## Melhores combinações nos últimos 12 meses (uso só se o veredito acima for RECOMENDADA)');
  finals.forEach((x, i) => L.push((i + 1) + '. ' + pstr(x.params) + '\n   ' + row(x.s) + '\n   trimestres positivos: ' + x.positiveQuarters + ' de 4 (' + x.quarters.map((q) => q.n + 'op/' + (q.totalR >= 0 ? '+' : '') + f2(q.totalR) + 'R').join(', ') + ')'));
  if (!finals.length) L.push('Nenhuma combinação passou no filtro de amostra e fator de lucro.');
  return L.join('\n');
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
  const months = parseInt(args.months || '30', 10), tf = args.tf || '1h';
  const coins = (args.coins || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT').split(',');
  const end = Date.now(), start = end - months * 30 * DAY;
  const datasets = [];
  for (const sym of coins) {
    try {
      const cs = await D.fetchKlinesRange(sym, tf, start, end, fetch);
      console.log(sym + ': ' + cs.length + ' velas');
      let htf = null;
      const mTf = D.macroTf(tf);
      if (mTf) {
        // um pouco de histórico a mais para a média de 50 velas do intervalo maior já estar pronta no começo
        const warm = Math.max(120 * DAY, 70 * D.TFS[mTf]);
        htf = await D.fetchKlinesRange(sym, mTf, start - warm, end, fetch);
        console.log(sym + ' (' + mTf + '): ' + htf.length + ' velas do intervalo maior');
      }
      if (cs.length > 2000) datasets.push({ sym, tf, cs, htf, inds: {} });
    } catch (e) { console.log(sym + ': falhou (' + e.message + ')'); }
  }
  if (datasets.length < 2) { console.log('Dados insuficientes para pesquisar.'); process.exit(1); }
  const grid = buildGrid();
  const wf = walkForward(datasets, { grid });
  const v = verdict(wf);
  const finals = finalSelection(datasets, grid, 365 * DAY, COSTS, 40);
  const text = report(datasets, wf, v, finals);
  console.log('\n' + text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + text + '\n```\n');
  if (args.out) fs.writeFileSync(args.out, JSON.stringify({ generatedAt: Date.now(), tf, coins: datasets.map((d) => d.sym), verdict: v, oos: wf.oos, baseline: wf.baseline, finals: finals.map((x) => ({ params: x.params, s: x.s, positiveQuarters: x.positiveQuarters })) }, null, 1));
}

module.exports = { buildGrid, evalRange, stats, objective, walkForward, verdict, finalSelection, report, COSTS };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
