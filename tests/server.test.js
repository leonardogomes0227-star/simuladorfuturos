const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const E=require('../js/engine.js'),Bot=require('../js/bot.js'),{run}=require('../server/run-bot.js');

const STEP=900000,T0=Date.UTC(2026,8,1);
const mk=(seed,base,n)=>E.genCandles(seed,base,0.004,n).map((c,i)=>[T0+i*STEP,String(c.o),String(c.h),String(c.l),String(c.c),String(c.v),0]);
const DATA={BTCUSDT:mk(11,95000,800),ETHUSDT:mk(23,3400,800)};
let N=300;
const fetchOk=(u)=>{
  const url=new URL(u),sym=url.searchParams.get('symbol'),lim=+url.searchParams.get('limit');
  if(!DATA[sym])return Promise.resolve({ok:false,status:400,json:()=>Promise.resolve({})});
  const rows=DATA[sym].slice(Math.max(0,N-lim),N);
  return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(rows)});
};
const nowFor=(n)=>T0+(n-1)*STEP+STEP+1000; // logo depois da vela n-1 fechar

function tmp(conf){
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'robo-'));
  const c=path.join(d,'config.json');if(conf!==undefined)fs.writeFileSync(c,typeof conf==='string'?conf:JSON.stringify(conf));
  return {dir:d,configPath:c,statePath:path.join(d,'estado','estado.json')};
}
const CONF={ligado:true,estrategia:'padrao',intervalo:'15m',moedas:['BTCUSDT','ETHUSDT']};

test('primeira rodada só marca o ponto de partida e grava o estado',async()=>{
  N=300;const t=tmp(CONF);
  const {st,meta}=await run({...t,fetchImpl:fetchOk,now:nowFor(300)});
  assert.equal(st.running,true);assert.equal(st.trades.length,0);assert.equal(meta.net,'ok');assert.equal(meta.runs,1);
  const file=JSON.parse(fs.readFileSync(t.statePath,'utf8'));
  assert.equal(file.state.cursor.BTCUSDT,DATA.BTCUSDT[299][0]);assert.equal(file.meta.lastRun,nowFor(300));
});

async function twoWays(last){
  const a=tmp(CONF),b=tmp(CONF);
  N=300;await run({...a,fetchImpl:fetchOk,now:nowFor(300)});await run({...b,fetchImpl:fetchOk,now:nowFor(300)});
  // a: checa a cada 40 velas; b: só no final (recuperação de uma vez)
  for(N=340;N<=last;N+=40)await run({...a,fetchImpl:fetchOk,now:nowFor(N)});
  N=last;await run({...b,fetchImpl:fetchOk,now:nowFor(last)});
  return [JSON.parse(fs.readFileSync(a.statePath)).state,JSON.parse(fs.readFileSync(b.statePath)).state];
}

test('rodadas espaçadas dão exatamente o mesmo que uma só quando a janela cobre a série',async()=>{
  const [sa,sb]=await twoWays(500);
  assert.ok(sa.trades.length>0,'deve ter operado');
  assert.deepEqual(sa.trades,sb.trades);
  assert.equal(Bot.balance(Bot.sanitize(sa)),Bot.balance(Bot.sanitize(sb)));
});

test('com janela deslizante (500 velas) o resultado é o mesmo, salvo diferença mínima de indicador',async()=>{
  const [sa,sb]=await twoWays(700);
  assert.ok(sa.trades.length>0);
  assert.deepEqual(sa.trades.map(t=>[t.id,t.side,t.status,t.reason]),sb.trades.map(t=>[t.id,t.side,t.status,t.reason]));
  sa.trades.forEach((t,i)=>{const u=sb.trades[i];assert.ok(Math.abs(t.stop-u.stop)/t.stop<1e-3);if(t.status==='closed')assert.ok(Math.abs(t.pnl-u.pnl)<0.05)});
});

test('rede fora do ar não quebra e fica registrada',async()=>{
  N=300;const t=tmp(CONF);
  await run({...t,fetchImpl:fetchOk,now:nowFor(300)});
  const {meta,st}=await run({...t,fetchImpl:()=>Promise.reject(new Error('sem rede')),now:nowFor(310)});
  assert.equal(meta.net,'off');assert.equal(meta.errors.length,2);assert.equal(meta.lastOk,nowFor(300));assert.equal(st.running,true);
  const p=await run({...t,fetchImpl:(u)=>/ETHUSDT/.test(u)?Promise.reject(new Error('x')):fetchOk(u),now:nowFor(320)});
  assert.equal(p.meta.net,'part');
});

test('configuração inválida ou ausente mantém o que estava',async()=>{
  N=300;const t=tmp(CONF);
  await run({...t,fetchImpl:fetchOk,now:nowFor(300)});
  fs.writeFileSync(t.configPath,JSON.stringify({...CONF,alavancagem:500}));
  let r=await run({...t,fetchImpl:fetchOk,now:nowFor(310)});
  assert.match(r.meta.configError,/alavancagem/);assert.equal(r.st.cfg.lev,3);assert.equal(r.st.running,true);
  fs.writeFileSync(t.configPath,'{ quebrado');
  r=await run({...t,fetchImpl:fetchOk,now:nowFor(320)});
  assert.match(r.meta.configError,/inválido/);
  fs.writeFileSync(t.configPath,JSON.stringify(CONF));
  r=await run({...t,fetchImpl:fetchOk,now:nowFor(330)});
  assert.equal(r.meta.configError,'');
});

test('desligado: não busca dados nem opera',async()=>{
  const t=tmp({...CONF,ligado:false});let calls=0;
  const {st,meta}=await run({...t,fetchImpl:(u)=>{calls++;return fetchOk(u)},now:nowFor(300)});
  assert.equal(calls,0);assert.equal(st.running,false);assert.equal(meta.net,'');assert.equal(meta.runs,1);
});

test('estado corrompido recomeça do zero em vez de quebrar',async()=>{
  N=300;const t=tmp(CONF);
  fs.mkdirSync(path.dirname(t.statePath),{recursive:true});fs.writeFileSync(t.statePath,'não é json');
  const {st}=await run({...t,fetchImpl:fetchOk,now:nowFor(300)});
  assert.equal(st.running,true);assert.equal(st.trades.length,0);
});
