const test=require('node:test'),assert=require('node:assert/strict');
const N=require('../js/narrativa.js'),E=require('../js/engine.js');

test('friendlyError traduz cada tipo de falha em frase clara, com a moeda quando houver',()=>{
  const k=(m)=>N.friendlyError(m);
  assert.equal(k('BTCUSDT: HTTP 451').kind,'blocked');assert.match(k('BTCUSDT: HTTP 451').text,/^BTC: A Binance recusou o acesso/);
  assert.equal(k('HTTP 429').kind,'rate');assert.match(k('HTTP 418').text,/pediu calma/);
  assert.equal(k('ETHUSDT: HTTP 503').kind,'server');
  assert.equal(k('Ativo não encontrado na Binance').kind,'notfound');assert.equal(k('HTTP 400').kind,'notfound');
  assert.equal(k('The operation was aborted due to timeout').kind,'timeout');assert.equal(k('This operation was aborted').kind,'timeout');
  assert.equal(k('Failed to fetch').kind,'network');assert.equal(k('getaddrinfo ENOTFOUND x').kind,'network');assert.equal(k('fetch failed').kind,'network');assert.equal(k('Sem resposta').kind,'network');
  assert.equal(k('Ativo sem velas').kind,'nodata');
  assert.match(k('coisa estranha').text,/Algo inesperado .*coisa estranha/);
  assert.equal(k('SOLUSDT: Failed to fetch').sym,'SOLUSDT');assert.equal(k(null).kind,'network'.replace('network','other'));
  ['HTTP 451','HTTP 429','Failed to fetch','abort'].forEach(m=>assert.ok(!/HTTP \d{3}|Failed to fetch|abort/.test(k(m).text),'sem jargão técnico: '+m));
});

test('friendlyLog traduz as mensagens do robô e deixa o resto como está',()=>{
  assert.match(N.friendlyLog('Robô ligado'),/começou a vigiar o mercado/);
  assert.match(N.friendlyLog('Histórico zerado (fase3-4h-candidata)'),/nova fase \(fase3-4h-candidata\).*recomeçou/);
  assert.match(N.friendlyLog('BTCUSDT: faltou histórico entre as checagens, algumas velas não foram analisadas'),/^BTC: o robô ficou um tempo sem checar/);
  assert.match(N.friendlyLog('Configuração mudou: 2 posição(ões) encerrada(s) ao último preço'),/encerrei 2 posição/);
  assert.match(N.friendlyLog('Capital só muda com o histórico zerado; mantido em 1000'),/Mantive 1000 USDT/);
  assert.match(N.friendlyLog('Robô desligado pela configuração'),/Nenhuma checagem/);
  assert.equal(N.friendlyLog('texto novo'),'texto novo');assert.equal(N.friendlyLog(null),'');
});

test('reasonText cobre todos os motivos que o motor produz',()=>{
  const cs=E.genCandles(11,95000,0.004,1500),P=E.normParams({minScore:3,adxMin:10}),ind=E.computeIndicators(cs,P);
  const seen=new Set();
  for(let i=70;i<cs.length;i++)E.signalAt(cs,ind,i,P).reasons.forEach(r=>seen.add(r));
  assert.ok(seen.size>=6);
  seen.forEach(r=>{const t=N.reasonText(r);assert.notEqual(t,r,'sem tradução: '+r);assert.ok(!/EMA|ADX|ATR/.test(t))});
  assert.equal(N.reasonText('algo novo'),'algo novo');
});

const trade=(o={})=>({id:'a',sym:'BTCUSDT',side:'long',entry:80000,stop:78800,target:82400,dist0:1200,qty:0.01,risk:12,openedAt:1000,closedAt:5000,status:'closed',exit:82400,pnl:24,reason:'Alvo',reasons:['Médias 9, 21 e 50 alinhadas para cima','RSI em 58, força sem exagero'],...o});

test('describeOpen: compra e venda, com retorno e motivos simples',()=>{
  const a=N.describeOpen(trade());
  assert.equal(a.title,'Comprou BTC');assert.equal(a.icon,'🟢');assert.match(a.text,/Entrada perto de 80\.000,00\. Stop em 78\.800,00.*alvo em 82\.400,00\. Retorno de 2,0 para 1\./);
  assert.deepEqual(a.why,['As médias apontam todas para cima (tendência de alta)','Força saudável, sem exagero (RSI 58)']);assert.equal(a.rr,2);
  const v=N.describeOpen(trade({sym:'SOLUSDT',side:'short',entry:100,stop:103,target:91,dist0:3}));
  assert.equal(v.title,'Vendeu SOL');assert.equal(v.icon,'🔴');assert.match(v.text,/Retorno de 3,0 para 1/);
});

test('describeClose: alvo, stop, stop móvel, tempo, manual',()=>{
  assert.match(N.describeClose(trade()).title,/Alvo atingido em BTC/);assert.match(N.describeClose(trade()).text,/Lucro de \+24,00 USDT \(\+2,0R\)\. Plano cumprido/);
  const s=N.describeClose(trade({reason:'Stop',pnl:-12}));assert.equal(s.icon,'🛑');assert.match(s.text,/Perda de −12,00 USDT \(−1,0R\).*faz parte do jogo/);assert.equal(s.tone,'neg');
  assert.match(N.describeClose(trade({reason:'Stop móvel',pnl:6})).title,/Lucro protegido em BTC/);
  assert.match(N.describeClose(trade({reason:'Stop móvel',pnl:-0.5})).title,/Saída perto da entrada/);
  assert.match(N.describeClose(trade({reason:'Tempo',pnl:3})).title,/Saída por tempo/);
  assert.match(N.describeClose(trade({reason:'Manual',pnl:-2})).title,/manualmente/);
  assert.equal(N.describeClose(trade({reason:'Outra',pnl:1})).icon,'ℹ️');
  assert.doesNotMatch(N.describeClose(trade({risk:0})).text,/NaN|R\)/);
});

test('timeline: mais novo primeiro, abertura e fechamento, e operação aberta só tem a abertura',()=>{
  const t1=trade({id:'1',openedAt:1000,closedAt:5000}),t2=trade({id:'2',openedAt:3000,status:'open',closedAt:undefined,reason:undefined,pnl:undefined});
  const tl=N.timeline([t1,t2]);
  assert.deepEqual(tl.map(e=>e.id+':'+e.kind),['1:close','2:open','1:open']);
  assert.equal(N.timeline([t1,t2],1).length,1);
  assert.deepEqual(N.timeline([]),[]);
});
