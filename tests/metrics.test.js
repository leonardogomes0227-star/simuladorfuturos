const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../js/metrics.js');
const approx=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,a+' != '+b);

const H=3600000,T0=new Date(2026,0,5,10,0,0).getTime(); // segunda-feira
const tr=(i,pnl,o={})=>Object.assign({id:'t'+i,sym:'BTCUSDT',mode:'demo',side:'long',status:'closed',entry:100,exit:100,stop:95,target:110,qty:1,lev:5,
  risk:10,pnl,reason:pnl>0?'Alvo':'Stop',openedAt:T0+i*H,closedAt:T0+i*H+1000,tags:[]},o);

test('summarize: totais, expectativa, fator de lucro e drawdown',()=>{
  const trades=[tr(1,20),tr(2,-10),tr(3,-10),tr(4,30),tr(5,-10)];
  const s=M.summarize(trades,1000);
  assert.equal(s.n,5);assert.equal(s.wins,2);approx(s.winRate,40);approx(s.total,20);
  approx(s.avgWin,25);approx(s.avgLoss,10);approx(s.expectancy,0.4*25-0.6*10);
  approx(s.pf,50/30);approx(s.best,30);approx(s.worst,-10);
  approx(s.maxDD,20);approx(s.maxDDPct,20/1020*100,1e-6);
  assert.equal(s.maxLossStreak,2);assert.equal(s.maxWinStreak,1);
  assert.deepEqual(s.curve,[1000,1020,1010,1000,1030,1020]);
  approx(s.avgR,(2-1-1+3-1)/5);
});
test('summarize sem operações não quebra',()=>{
  const s=M.summarize([],500);
  assert.equal(s.n,0);assert.equal(s.total,0);assert.deepEqual(s.curve,[500]);
});
test('groupBy por lado, tag, horário e dia',()=>{
  const trades=[tr(1,20,{tags:['rompimento','a']}),tr(2,-10,{side:'short',tags:['a']}),tr(3,5)];
  const side=M.groupBy(trades,M.by.side);
  assert.equal(side.find(g=>g.key==='Compra').n,2);
  const tag=M.groupBy(trades,M.by.tag);
  assert.equal(tag.find(g=>g.key==='a').n,2);approx(tag.find(g=>g.key==='a').pnl,10);
  assert.equal(M.groupBy(trades,M.by.hour)[0].key,'11h');
  assert.equal(M.groupBy(trades,M.by.weekday)[0].key,'seg');
});
test('sequência de perdas e PnL por período',()=>{
  const trades=[tr(1,10),tr(2,-5),tr(3,-5)];
  const ls=M.lossStreak(trades);assert.equal(ls.count,2);assert.equal(ls.lastAt,trades[2].closedAt);
  approx(M.pnlSince(trades,trades[1].closedAt),-10);
  assert.equal(M.startOfWeek(T0+3*24*H),new Date(2026,0,5).getTime());
  assert.equal(M.startOfDay(T0),new Date(2026,0,5).getTime());
});
test('exposição soma valor, margem, risco e detecta correlação',()=>{
  const open=[{sym:'BTCUSDT',side:'long',qty:1,entry:100,lev:5,risk:10,stop:95},{sym:'ETHUSDT',side:'long',qty:2,entry:50,lev:5,risk:8,stop:46},{sym:'SOLUSDT',side:'short',qty:1,entry:10,lev:2,stop:11}];
  const e=M.exposure(open,1000);
  approx(e.notional,210);approx(e.margin,20+20+5);approx(e.risk,10+8+1);approx(e.riskPct,1.9);
  assert.equal(e.corr.length,1);assert.deepEqual(e.corr[0].syms,['BTCUSDT','ETHUSDT']);
  assert.equal(M.exposure([],0).leverage,0);
});
test('CSV escapa aspas, vírgulas e inclui R',()=>{
  const csv=M.toCSV([tr(1,20,{note:'entrei "cedo", mal',tags:['x','y']})]);
  const lines=csv.trim().split('\n');
  assert.equal(lines.length,2);
  assert.ok(lines[1].includes('"entrei ""cedo"", mal"'));
  assert.ok(lines[1].includes('x|y'));
  assert.ok(lines[1].includes('2.000'));
});
test('parseTags limpa, deduplica e limita',()=>{
  assert.deepEqual(M.parseTags(' Rompimento, rompimento;  Volume ,, '),['rompimento','volume']);
  assert.equal(M.parseTags('a,b,c,d,e,f,g,h').length,6);
  assert.deepEqual(M.parseTags(null),[]);
});
