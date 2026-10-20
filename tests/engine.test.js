const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../js/engine.js');

const approx=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,a+' != '+b);

test('ema, sma e rsi em séries conhecidas',()=>{
  const e=E.ema([1,2,3,4,5],3);
  assert.ok(isNaN(e[0])&&isNaN(e[1]));approx(e[2],2);approx(e[3],3);approx(e[4],4);
  approx(E.sma([1,2,3,4],2)[3],3.5);
  const up=E.rsi(Array.from({length:30},(_,i)=>i+1),14);
  approx(up[29],100);
  const flat=E.rsi(Array.from({length:30},()=>5),14);
  approx(flat[29],100); // sem perdas
});

test('genCandles é determinística e coerente',()=>{
  const a=E.genCandles(11,95000,0.0035,200),b=E.genCandles(11,95000,0.0035,200);
  assert.deepEqual(a,b);
  a.forEach(c=>{assert.ok(c.h>=Math.max(c.o,c.c)&&c.l<=Math.min(c.o,c.c)&&c.v>0)});
});

test('normParams limita e mantém médias em ordem',()=>{
  const p=E.normParams({emaF:30,emaM:10,emaS:5,minScore:99,rr:0,stopAtr:'x'});
  assert.ok(p.emaF<p.emaM&&p.emaM<p.emaS);
  assert.equal(p.minScore,6);assert.equal(p.rr,0.5);assert.equal(p.stopAtr,E.DEFAULTS.stopAtr);
  assert.deepEqual(E.normParams(),E.DEFAULTS);
});

test('signalAt: poucos dados e sinal consistente com stop/alvo',()=>{
  const cs=E.genCandles(11,95000,0.0035,320),ind=E.computeIndicators(cs);
  assert.equal(E.signalAt(cs,ind,10).dir,'wait');
  let found=0;
  for(let i=70;i<cs.length;i++){
    const s=E.signalAt(cs,ind,i);
    if(s.dir==='wait'){assert.ok(s.blockers.length>0);continue}
    found++;
    assert.equal(s.blockers.length,0);
    const long=s.dir==='long';
    assert.ok(long?s.stop<s.entry&&s.target>s.entry:s.stop>s.entry&&s.target<s.entry);
    approx(Math.abs(s.target-s.entry),E.DEFAULTS.rr*Math.abs(s.entry-s.stop),1e-6);
    assert.ok(Math.abs(s.score)>=E.DEFAULTS.minScore);
  }
  assert.ok(found>0,'a série de demonstração deve gerar ao menos um sinal');
});

test('parâmetros mudam o resultado: preset conservador dá menos sinais',()=>{
  const cs=E.genCandles(23,3400,0.0045,600),count=p=>E.backtest(cs,E.computeIndicators(cs,p),0.05,p).n;
  assert.ok(count(E.PRESETS.conservadora.p)<=count(E.PRESETS.agressiva.p));
});

test('sizing: risco, margem e liquidação',()=>{
  const z=E.sizing(1000,1,100,95,5,0.05);
  approx(z.riskUSD,10);approx(z.qty,2);approx(z.notional,200);approx(z.margin,40);
  approx(z.distPct,5);approx(z.liqPct,100/5-E.MMR);
  approx(z.liqPrice,100*(1-z.liqPct/100));
  assert.equal(z.marginOver,false);assert.equal(z.stopBeyondLiq,false);
  const s=E.sizing(1000,1,100,105,5,0.05);
  assert.ok(s.liqPrice>100);
  const hi=E.sizing(1000,1,100,95,25,0.05);
  assert.equal(hi.stopBeyondLiq,true);
  assert.equal(E.sizing(1000,1,100,100,5,0.05).qty,0);
});

test('levels devolve stop e alvo pelo ATR e RR',()=>{
  const l=E.levels('long',100,2,{stopAtr:1.5,rr:2});
  approx(l.stop,97);approx(l.target,106);
  const s=E.levels('short',100,2,{stopAtr:1.5,rr:2});
  approx(s.stop,103);approx(s.target,94);
});

test('backtest: contabilidade em R fecha',()=>{
  const cs=E.genCandles(11,95000,0.0035,800),ind=E.computeIndicators(cs),b=E.backtest(cs,ind,0);
  assert.ok(b.n>0);
  approx(b.curve[b.curve.length-1],b.totalR,1e-9);
  assert.equal(b.curve.length,b.n+1);
  b.trades.forEach(t=>{assert.ok(t.j>t.i);if(t.why==='stop')approx(t.R,-1);if(t.why==='alvo')approx(t.R,2)});
  const withFee=E.backtest(cs,ind,0.1);
  assert.ok(withFee.totalR<b.totalR);
});

test('resolveTrade: vela da abertura só vale pelo fechamento',()=>{
  const mk=(t,o,h,l,c)=>({t,o,h,l,c,v:1});
  const tr={side:'long',stop:95,target:110,openT:1000};
  // a mínima da vela da entrada (t=1000) é anterior à entrada e não pode acionar o stop
  assert.equal(E.resolveTrade(tr,[mk(900,100,101,99,100),mk(1000,100,105,90,100)]),null);
  // fechamento da vela da entrada abaixo do stop aciona
  assert.equal(E.resolveTrade(tr,[mk(1000,100,105,90,94)]).reason,'Stop');
  // vela seguinte vale por máxima e mínima
  const r=E.resolveTrade(tr,[mk(1000,100,101,99,100),mk(2000,100,111,99,100)]);
  assert.deepEqual(r,{price:110,reason:'Alvo'});
  // stop e alvo na mesma vela: vale o stop
  assert.equal(E.resolveTrade(tr,[mk(1000,100,101,99,100),mk(2000,100,111,90,100)]).reason,'Stop');
  const sh={side:'short',stop:105,target:90,openT:1000};
  assert.equal(E.resolveTrade(sh,[mk(1000,100,101,99,100),mk(2000,100,101,89,100)]).reason,'Alvo');
  assert.equal(E.resolveTrade(sh,[]),null);
});

test('parseCSV: cabeçalho, separador e decimais brasileiros',()=>{
  let rows=['time,open,high,low,close,volume'];
  for(let i=0;i<100;i++)rows.push([1700000000000+i*60000,100+i,102+i,99+i,101+i,5].join(','));
  const r=E.parseCSV(rows.join('\n'));
  assert.equal(r.candles.length,100);assert.equal(r.candles[0].o,100);
  const br=['data;abertura;máxima;mínima;fechamento;volume'];
  for(let i=0;i<90;i++)br.push(`2026-01-01 00:${String(i%60).padStart(2,'0')};1.234,5;1.240,0;1.230,0;1.236,5;10`);
  const r2=E.parseCSV(br.join('\n'));
  assert.ok(r2.candles,r2.error);approx(r2.candles[0].o,1234.5);
  assert.match(E.parseCSV('a').error,/poucas linhas/);
  assert.match(E.parseCSV('foo,bar\n1,2').error,/colunas/);
  assert.match(E.parseCSV(rows.slice(0,20).join('\n')).error,/80 velas/);
});
