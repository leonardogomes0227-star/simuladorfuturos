const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../js/engine.js'),B=require('../js/bot.js');

const TF=900000;
function series(seed,base,n){return E.genCandles(seed,base,0.004,n)}
function fresh(syms,cursorIdx,cs,over){
  const st=B.defaults();st.cfg.syms=syms;st.cfg.tf='15m';Object.assign(st.cfg,over||{});
  syms.forEach(s=>{st.cursor[s]=cs[s][cursorIdx].t});
  return st;
}
const nowAfter=(cs,n)=>cs[n-1].t+TF; // instante em que a vela n-1 acabou de fechar

test('primeira checagem só marca o ponto de partida, sem operar',()=>{
  const cs=series(11,95000,320),st=B.defaults();st.cfg.syms=['BTCUSDT'];
  const ev=B.step(st,{BTCUSDT:cs},nowAfter(cs,320));
  assert.equal(ev.length,0);assert.equal(st.trades.length,0);assert.equal(st.cursor.BTCUSDT,cs[319].t);
});

test('não usa a vela em formação',()=>{
  const cs=series(11,95000,320),st=fresh(['BTCUSDT'],100,{BTCUSDT:cs});
  // agora está no meio da última vela: ela ainda não fechou
  B.step(st,{BTCUSDT:cs},cs[319].t+TF/2);
  assert.equal(st.cursor.BTCUSDT,cs[318].t);
});

test('opera sozinho e as contas fecham',()=>{
  const cs=series(11,95000,600),st=fresh(['BTCUSDT'],80,{BTCUSDT:cs});
  const ev=B.step(st,{BTCUSDT:cs},nowAfter(cs,600));
  assert.ok(st.trades.length>0,'deve haver operações');
  assert.equal(ev.filter(e=>e.type==='open').length,st.trades.length);
  st.trades.forEach(t=>{
    const long=t.side==='long';
    assert.ok(long?t.stop<t.entry&&t.target>t.entry:t.stop>t.entry&&t.target<t.entry);
    assert.ok(t.reasons.length>0);
    if(t.status==='closed'){
      assert.ok(t.closedAt>t.openedAt,'fecha depois de abrir');
      assert.ok(['Stop','Alvo'].includes(t.reason));
      if(t.reason==='Alvo')assert.ok(t.pnl>0);
    }
  });
  const sum=B.closedTrades(st).reduce((a,t)=>a+t.pnl,0);
  assert.ok(Math.abs(B.balance(st)-(st.cfg.capital+sum))<1e-9);
});

test('risco por operação respeita o limite (derrapagem à parte)',()=>{
  const cs=series(23,3400,600),st=fresh(['ETHUSDT'],80,{ETHUSDT:cs},{slipPct:0});
  B.step(st,{ETHUSDT:cs},nowAfter(cs,600));
  assert.ok(st.trades.length>0);
  st.trades.forEach(t=>{assert.ok(t.risk<=st.cfg.capital*st.cfg.riskPct/100*3,'risco proporcional ao saldo')});
  const t0=st.trades[0];
  assert.ok(Math.abs(t0.risk-st.cfg.capital*st.cfg.riskPct/100)<1e-6,'primeira operação arrisca exatamente o configurado');
});

test('recuperar em duas etapas dá o mesmo resultado que em uma (sem olhar o futuro)',()=>{
  const cs=series(11,95000,700),sc={BTCUSDT:cs};
  const a=fresh(['BTCUSDT'],80,sc),b=fresh(['BTCUSDT'],80,sc);
  B.step(a,{BTCUSDT:cs.slice(0,350)},nowAfter(cs,350));
  B.step(a,{BTCUSDT:cs.slice(0,700)},nowAfter(cs,700));
  B.step(b,{BTCUSDT:cs.slice(0,700)},nowAfter(cs,700));
  assert.ok(b.trades.length>0);
  assert.deepEqual(a.trades,b.trades);
  assert.equal(a.cursor.BTCUSDT,b.cursor.BTCUSDT);
});

test('várias vezes seguidas sem velas novas não muda nada',()=>{
  const cs=series(11,95000,500),st=fresh(['BTCUSDT'],80,{BTCUSDT:cs}),now=nowAfter(cs,500);
  B.step(st,{BTCUSDT:cs},now);const snap=JSON.stringify(st.trades);
  const ev=B.step(st,{BTCUSDT:cs},now+60000);
  assert.equal(ev.length,0);assert.equal(JSON.stringify(st.trades),snap);
});

test('limite de posições abertas e uma posição por ativo',()=>{
  const syms=['BTCUSDT','ETHUSDT','SOLUSDT'],data={BTCUSDT:series(11,95000,700),ETHUSDT:series(23,3400,700),SOLUSDT:series(37,180,700)};
  const st=fresh(syms,80,data,{maxOpen:1});
  // confere a cada vela, reprocessando em passos, que nunca passa do limite
  let max=0;
  for(let n=100;n<=700;n+=25){
    const part={};syms.forEach(s=>part[s]=data[s].slice(0,n));
    B.step(st,part,nowAfter(data.BTCUSDT,n));
    max=Math.max(max,B.openTrades(st).length);
    const per={};B.openTrades(st).forEach(t=>{per[t.sym]=(per[t.sym]||0)+1});
    Object.values(per).forEach(c=>assert.equal(c,1));
  }
  assert.ok(max<=1);assert.ok(st.trades.length>0);
});

test('limite de perda do dia bloqueia novas entradas',()=>{
  const cs=series(11,95000,700),loose=fresh(['BTCUSDT'],80,{BTCUSDT:cs},{dailyPct:20}),tight=fresh(['BTCUSDT'],80,{BTCUSDT:cs},{dailyPct:0.5,riskPct:2});
  B.step(loose,{BTCUSDT:cs},nowAfter(cs,700));B.step(tight,{BTCUSDT:cs},nowAfter(cs,700));
  assert.ok(tight.trades.length<=loose.trades.length);
});

test('buraco de histórico é registrado',()=>{
  const cs=series(11,95000,700),st=B.defaults();st.cfg.syms=['BTCUSDT'];st.cursor.BTCUSDT=cs[100].t;
  B.step(st,{BTCUSDT:cs.slice(400)},nowAfter(cs,700));
  assert.equal(st.gaps,1);assert.ok(st.log.length>0);
});

test('closeAll fecha ao último preço e cobra taxa',()=>{
  const cs=series(11,95000,700),st=fresh(['BTCUSDT'],80,{BTCUSDT:cs});
  B.step(st,{BTCUSDT:cs.slice(0,500)},nowAfter(cs,500));
  const open=B.openTrades(st);
  if(!open.length)return; // série sem posição aberta nesse ponto
  st.prices.BTCUSDT=open[0].entry;
  const out=B.closeAll(st,{},12345);
  assert.equal(out.length,open.length);
  out.forEach(t=>{assert.equal(t.status,'closed');assert.equal(t.reason,'Manual');assert.ok(t.pnl<=0,'sem movimento, só sobra a taxa')});
  assert.equal(B.openTrades(st).length,0);
});

test('aggregate e readiness',()=>{
  const r=B.aggregate([{trades:[{R:2},{R:-1}]},{trades:[{R:2},{R:-1},{R:-1}]}]);
  assert.equal(r.n,5);assert.equal(r.wins,2);assert.ok(Math.abs(r.totalR-1)<1e-9);assert.ok(Math.abs(r.pf-4/3)<1e-9);
  const st=B.defaults(),now=Date.now();
  let rd=B.readiness(st,now);
  assert.equal(rd.ready,false);assert.equal(rd.passed,1); // só "sem buracos" passa no começo
  st.startedAt=now-20*86400000;
  for(let i=0;i<40;i++)st.trades.push({id:'x'+i,sym:'BTCUSDT',side:'long',entry:100,stop:99,target:102,qty:1,lev:1,risk:1,openedAt:i,openT:i,status:'closed',exit:102,pnl:i%3?2:-1,closedAt:i+1,reason:'x',score:4,reasons:[]});
  rd=B.readiness(st,now);
  assert.equal(rd.ready,true);
});

test('sanitize aceita estado válido e descarta lixo',()=>{
  const st=B.defaults();st.cfg.capital=5000;st.trades.push({id:'a',sym:'BTCUSDT',side:'long',entry:1,stop:0.9,target:1.2,qty:1,openedAt:1,openT:1,status:'open',reasons:['r']});
  const back=B.sanitize(JSON.parse(JSON.stringify(st)));
  assert.equal(back.cfg.capital,5000);assert.equal(back.trades.length,1);
  const bad=B.sanitize({cfg:{capital:'abc',lev:999,tf:'7m',syms:['x','BTCUSDT','BTCUSDT']},trades:[{status:'open'},null,5],running:true,cursor:{BTCUSDT:'x'}});
  assert.equal(bad.cfg.capital,1000);assert.equal(bad.cfg.lev,20);assert.equal(bad.cfg.tf,'15m');assert.deepEqual(bad.cfg.syms,['BTCUSDT']);
  assert.equal(bad.trades.length,0);assert.equal(bad.running,true);assert.deepEqual(bad.cursor,{});
  assert.equal(B.sanitize(null).cfg.capital,1000);
});

test('parseConfig: valida, usa padrões e dá mensagens claras',()=>{
  const ok=B.parseConfig({ligado:true,estrategia:'conservadora',intervalo:'1h',moedas:['btcusdt','ETHUSDT'],capital:2000,alavancagem:2});
  assert.equal(ok.error,undefined);assert.equal(ok.cfg.tf,'1h');assert.deepEqual(ok.cfg.syms,['BTCUSDT','ETHUSDT']);
  assert.equal(ok.cfg.capital,2000);assert.equal(ok.cfg.lev,2);assert.equal(ok.cfg.riskPct,1);assert.equal(ok.cfg.presetId,'conservadora');
  assert.equal(ok.params.minScore,5);assert.equal(ok.enabled,true);
  assert.equal(B.parseConfig({}).cfg.tf,'15m');
  assert.equal(B.parseConfig({ligado:false}).enabled,false);
  assert.equal(B.parseConfig({parametros:{minScore:3}}).cfg.presetId,'custom');
  assert.match(B.parseConfig({alavancagem:99}).error,/alavancagem/);
  assert.match(B.parseConfig({capital:'x'}).error,/número/);
  assert.match(B.parseConfig({intervalo:'7m'}).error,/intervalo/);
  assert.match(B.parseConfig({moedas:[]}).error,/moedas/);
  assert.match(B.parseConfig({moedas:['BTCUSDT','BTCUSDT']}).error,/repetida/);
  assert.match(B.parseConfig({moedas:['b t c']}).error,/inválida/);
  assert.match(B.parseConfig({estrategia:'xyz'}).error,/estrategia/);
  assert.match(B.parseConfig(null).error,/objeto/);
});

test('applyConfig: liga, troca estrutura com posição aberta e protege o capital',()=>{
  const cs=series(11,95000,700),st=B.defaults();
  let notes=B.applyConfig(st,B.parseConfig({moedas:['BTCUSDT'],capital:1000}),1000);
  assert.equal(st.running,true);assert.equal(st.startedAt,1000);assert.ok(notes.includes('Robô ligado'));
  st.cursor.BTCUSDT=cs[80].t;
  B.step(st,{BTCUSDT:cs.slice(0,500)},nowAfter(cs,500));
  assert.ok(st.trades.length>0);
  // capital não muda com histórico
  notes=B.applyConfig(st,B.parseConfig({moedas:['BTCUSDT'],capital:5000}),2000);
  assert.equal(st.cfg.capital,1000);assert.ok(notes.some(n=>/Capital/.test(n)));
  // mudar a estratégia vale para as próximas entradas, sem mexer no resto
  B.applyConfig(st,B.parseConfig({moedas:['BTCUSDT'],estrategia:'agressiva'}),2500);
  assert.equal(st.params.minScore,3);assert.deepEqual(st.cursor.BTCUSDT,cs[499].t);
  // mudar moedas encerra o que estiver aberto e zera os cursores
  st.prices.BTCUSDT=100;
  const open=B.openTrades(st).length;
  notes=B.applyConfig(st,B.parseConfig({moedas:['ETHUSDT']}),3000);
  assert.equal(B.openTrades(st).length,0);assert.deepEqual(st.cursor,{});assert.deepEqual(st.cfg.syms,['ETHUSDT']);
  if(open)assert.ok(notes.some(n=>/encerrada/.test(n)));
  // desligar e religar
  B.applyConfig(st,B.parseConfig({moedas:['ETHUSDT'],ligado:false}),4000);assert.equal(st.running,false);
  B.applyConfig(st,B.parseConfig({moedas:['ETHUSDT']}),5000);assert.equal(st.running,true);assert.equal(st.startedAt,1000);
});

test('zerarHistorico: texto novo começa conta limpa, o mesmo texto não repete',()=>{
  const cs=series(11,95000,700),st=B.defaults();
  B.applyConfig(st,B.parseConfig({moedas:['BTCUSDT'],zerarHistorico:'v1'}),1000);
  st.cursor.BTCUSDT=cs[80].t;B.step(st,{BTCUSDT:cs.slice(0,500)},nowAfter(cs,500));
  assert.ok(st.trades.length>0);st.gaps=2;
  const n=st.trades.length;
  B.applyConfig(st,B.parseConfig({moedas:['BTCUSDT'],zerarHistorico:'v1'}),2000);
  assert.equal(st.trades.length,n,'mesmo texto não zera de novo');
  const notes=B.applyConfig(st,B.parseConfig({moedas:['BTCUSDT'],zerarHistorico:'v2'}),3000);
  assert.equal(st.trades.length,0);assert.equal(st.gaps,0);assert.deepEqual(st.cursor,{});assert.equal(st.startedAt,3000);assert.equal(st.resetToken,'v2');
  assert.ok(notes.some(x=>/zerado/.test(x)));
  assert.equal(B.sanitize(JSON.parse(JSON.stringify(st))).resetToken,'v2');
  assert.equal(B.parseConfig({}).resetToken,'');
});
