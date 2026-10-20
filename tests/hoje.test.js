const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../js/bot.js'),H=require('../js/hoje.js');
const approx=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,a+' != '+b);
const HR=3600000,NOW=Date.UTC(2026,9,20,12,0,0);

const trade=(o={})=>Object.assign({id:'t',sym:'BTCUSDT',side:'long',entry:100,stop:98,target:104,qty:1,lev:3,risk:2,openedAt:NOW-HR/2,openT:NOW-HR,status:'open',score:4,reasons:['a']},o);
const state=(trades,over={})=>{const st=B.defaults();st.cfg.tf='1h';st.trades=trades;st.startedAt=NOW-30*86400000;return Object.assign(st,over)};
const closedWins=n=>Array.from({length:n},(_,i)=>({id:'c'+i,sym:'BTCUSDT',side:'long',entry:100,stop:99,target:102,qty:1,lev:1,risk:1,openedAt:NOW-20*86400000+i,openT:i,status:'closed',exit:102,pnl:i%3?2:-1,closedAt:NOW-20*86400000+i+1,reason:'x',score:4,reasons:[]}));

test('sizeForUser: arrisca a porcentagem pedida',()=>{
  const z=H.sizeForUser({capital:1000,riskPct:0.5,maxLev:2},trade());
  approx(z.riskUSD,5);approx(z.qty,2.5);approx(z.notional,250);approx(z.lev,1);assert.equal(z.capped,false);approx(z.rewardUSD,10);
});
test('sizeForUser: limita pela alavancagem máxima e mostra o risco real',()=>{
  const z=H.sizeForUser({capital:1000,riskPct:5,maxLev:1},trade({stop:99.5,target:101}));
  assert.equal(z.capped,true);approx(z.notional,1000);assert.ok(z.riskPct<5);approx(z.riskPct,z.riskUSD/10);
  approx(z.lev,1);
  assert.equal(H.sizeForUser({capital:0,riskPct:1,maxLev:1},trade()),null);
  assert.equal(H.sizeForUser({capital:1000,riskPct:1,maxLev:1},trade({stop:100})),null);
});
test('sizeForUser: alavancagem necessária quando a posição passa do capital',()=>{
  const z=H.sizeForUser({capital:100,riskPct:2,maxLev:5},trade({stop:99.5,target:101}));
  approx(z.notional,400);approx(z.lev,4);approx(z.marginUSD,100);
});

test('entryStatus: janela de entrada, atraso, stop, alvo e sinal velho',()=>{
  const t=trade(),tf=HR,s=(p,now)=>H.entryStatus(t,p,now||NOW,tf);
  assert.equal(s(100).state,'valid');
  assert.equal(s(100.5).state,'valid');          // +0,25R a favor
  assert.equal(s(100.7).state,'late');           // +0,35R: já andou
  assert.equal(s(99.1).state,'valid');           // -0,45R contra: ainda dentro
  assert.equal(s(98.9).state,'late');            // -0,55R contra: passou do limite
  assert.equal(s(98.5).state,'late');            // -0,75R contra
  assert.equal(s(98).state,'stopped');assert.equal(s(97).state,'stopped');
  assert.equal(s(104).state,'target');assert.equal(s(110).state,'target');
  assert.equal(s(100,NOW+3*HR).state,'old');
  assert.equal(s(undefined).state,'sem-preco');
  approx(s(101).rr,3/3);approx(s(100).lo,99);approx(s(100).hi,100.6);
  const sh=trade({side:'short',stop:102,target:96});
  assert.equal(H.entryStatus(sh,100,NOW,tf).state,'valid');
  assert.equal(H.entryStatus(sh,99.3,NOW,tf).state,'late');
  assert.equal(H.entryStatus(sh,102,NOW,tf).state,'stopped');
  assert.equal(H.entryStatus(sh,96,NOW,tf).state,'target');
});

test('advise: só simular enquanto o robô não provou a estratégia',()=>{
  const st=state([trade()]);
  const a=H.advise(st,{lastRun:NOW-HR/4},{BTCUSDT:100},{capital:1000,riskPct:0.5,maxLev:2},NOW);
  assert.equal(a.code,'simular');assert.equal(a.ready,false);assert.equal(a.actionable.length,1);assert.ok(a.signals[0].size);
});
test('advise: oportunidade, esperar, parar, desatualizado',()=>{
  const tr=closedWins(40).map((t,i)=>({...t,pnl:i%4?3:-1}));
  const OK={tf:'1h',recommended:true,oosAvgR:0.1};
  const mk=(open,over,meta)=>H.advise(state(tr.concat(open),over),meta||{lastRun:NOW-HR/4,pesquisa:OK},{BTCUSDT:100},{capital:1000,riskPct:0.5,maxLev:2},NOW);
  let a=mk([trade()]);assert.equal(a.ready,true);assert.equal(a.code,'oportunidade');
  assert.equal(mk([trade({openedAt:NOW-5*HR})]).code,'esperar');           // sinal velho
  assert.equal(mk([]).code,'esperar');
  assert.equal(mk([trade()],{},{lastRun:NOW-10*HR,pesquisa:OK}).code,'desatualizado');
  const losing=tr.concat([{...tr[0],id:'big',pnl:-50,closedAt:NOW-HR}]);
  a=H.advise(state(losing.concat([trade()])),{lastRun:NOW-HR/4,pesquisa:OK},{BTCUSDT:100},null,NOW);
  assert.equal(a.code,'parar');assert.equal(a.dailyHit,true);
});
test('limits e alertText',()=>{
  const l=H.limits(1000,2,6);approx(l.daily,20);approx(l.weekly,60);
  const f=n=>n.toFixed(2);
  const open=H.alertText({type:'open',trade:trade()},false,f);
  assert.match(open,/COMPRAR BTCUSDT/);assert.match(open,/SIMULAÇÃO/);assert.match(open,/Stop 98.00/);assert.match(open,/entre 99.00 e 100.60/);
  assert.match(H.alertText({type:'open',trade:trade({side:'short',stop:102,target:96})},true,f),/VENDER.*comece pequeno[\s\S]*futuros/);
  assert.match(H.alertText({type:'close',trade:{...trade(),reason:'Stop',pnl:-12.5}},false,f),/Stop em BTCUSDT: -12.50/);
  assert.match(H.alertText({type:'close',trade:{...trade(),reason:'Alvo',pnl:20}},false,f),/Alvo em BTCUSDT: \+20.00/);
});

test('advise: sem pesquisa aprovada nunca libera, mesmo com bom histórico no robô',()=>{
  const tr=closedWins(40).map((t,i)=>({...t,pnl:i%4?3:-1})),st=()=>state(tr.concat([trade()]));
  const run=(pesquisa)=>H.advise(st(),{lastRun:NOW-HR/4,pesquisa},{BTCUSDT:100},{capital:1000,riskPct:0.5,maxLev:1},NOW);
  assert.equal(run(undefined).code,'simular');
  assert.equal(run(null).code,'simular');
  const rej=run({tf:'1h',recommended:false,oosAvgR:-0.045,passed:2,total:5});
  assert.equal(rej.code,'simular');assert.match(rej.reason,/pesquisa com anos de dados reais não encontrou vantagem/);
  assert.equal(rej.rd.checks[0].ok,false);assert.match(rej.rd.checks[0].detail,/reprovada \(-0,045R/);
  assert.equal(run({tf:'4h',mismatch:true}).code,'simular');
  assert.equal(run({tf:'1h',recommended:true,oosAvgR:0.1}).code,'oportunidade');
  assert.equal(rej.signals.length,1,'ainda mostra o sinal para acompanhar em simulação');
});
