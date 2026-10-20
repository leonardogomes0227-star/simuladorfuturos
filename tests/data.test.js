const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../js/data.js');
const FAST={sleep:()=>Promise.resolve()};
test.beforeEach(()=>D.resetBreaker());

const row=(t,c)=>[t,String(c),String(c+1),String(c-1),String(c),'10',t+59999];

test('validSymbol e normSymbol',()=>{
  assert.ok(D.validSymbol('BTCUSDT'));assert.ok(!D.validSymbol('btc'));assert.ok(!D.validSymbol('BTC/USDT'));assert.ok(!D.validSymbol(''));
  assert.equal(D.normSymbol(' btc-usdt '),'BTCUSDT');
});
test('parseKlines converte, ordena e descarta linhas ruins',()=>{
  const cs=D.parseKlines([row(2000,20),row(1000,10),['x'],[3000,'a','b','c','d','1'],row(4000,0)]);
  assert.deepEqual(cs.map(c=>c.t),[1000,2000]);
  assert.equal(cs[0].c,10);assert.equal(cs[0].h,11);
  assert.deepEqual(D.parseKlines(null),[]);
});
test('applyKline atualiza, acrescenta e ignora velas velhas',()=>{
  const cs=[{t:1,o:1,h:1,l:1,c:1,v:1}];
  assert.equal(D.applyKline(cs,{t:1,o:1,h:2,l:1,c:2,v:2}),'update');assert.equal(cs[0].c,2);assert.equal(cs.length,1);
  assert.equal(D.applyKline(cs,{t:2,o:2,h:2,l:2,c:2,v:1}),'append');assert.equal(cs.length,2);
  assert.equal(D.applyKline(cs,{t:0,o:0,h:0,l:0,c:0,v:0}),'ignore');
  assert.equal(D.applyKline(cs,null),'ignore');
  const big=[];for(let i=0;i<D.MAX_CANDLES;i++)big.push({t:i});
  D.applyKline(big,{t:D.MAX_CANDLES});assert.equal(big.length,D.MAX_CANDLES);assert.equal(big[0].t,1);
});
test('klineFromWs lê a mensagem da Binance',()=>{
  const msg={e:'kline',k:{t:1000,o:'1.5',h:'2',l:'1',c:'1.8',v:'30'}};
  assert.deepEqual(D.klineFromWs(JSON.stringify(msg)),{t:1000,o:1.5,h:2,l:1,c:1.8,v:30});
  assert.equal(D.klineFromWs('lixo'),null);assert.equal(D.klineFromWs({}),null);
});
test('urls',()=>{
  assert.equal(D.wsUrl('BTCUSDT','1m'),'wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
  assert.match(D.klinesUrl('https://h','BTCUSDT','1h',500),/symbol=BTCUSDT&interval=1h&limit=500$/);
});
const ok=body=>Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(body)});
const bad=s=>Promise.resolve({ok:false,status:s,json:()=>Promise.resolve({})});

test('fetchKlines usa o espelho quando o principal falha',async()=>{
  const urls=[];
  const f=u=>{urls.push(u);return urls.length===1?Promise.reject(new Error('rede')):ok([row(1000,10),row(2000,11)])};
  const cs=await D.fetchKlines('BTCUSDT','1m',100,f,{...FAST,tries:1});
  assert.equal(cs.length,2);assert.equal(urls.length,2);assert.match(urls[1],/data-api\.binance\.vision/);
});
test('fetchKlines: ativo inexistente e entradas inválidas',async()=>{
  await assert.rejects(D.fetchKlines('NAOEXISTEUSDT','1m',10,()=>bad(400),FAST),/não encontrado/);
  await assert.rejects(D.fetchKlines('btc','1m',10,()=>ok([])),/inválido/);
  await assert.rejects(D.fetchKlines('BTCUSDT','7m',10,()=>ok([])),/Intervalo/);
  await assert.rejects(D.fetchKlines('BTCUSDT','1m',10,()=>Promise.reject(new Error('rede')),FAST),/rede/);
});
test('fetchSymbols filtra pares USDT',async()=>{
  const l=await D.fetchSymbols(()=>ok([{symbol:'ETHUSDT'},{symbol:'BTCBRL'},{symbol:'BTCUSDT'},{symbol:'ETHUPUSDT'},{x:1}]));
  assert.deepEqual(l,['BTCUSDT','ETHUSDT']);
});

test('fetchPrices lê vários pares e usa o espelho se o principal falhar',async()=>{
  const urls=[];
  const f=u=>{urls.push(u);return urls.length===1?Promise.reject(new Error('rede')):ok([{symbol:'BTCUSDT',price:'81000.5'},{symbol:'USDTBRL',price:'5.4'},{symbol:'X',price:'1'},{symbol:'ETHUSDT',price:'0'}])};
  const p=await D.fetchPrices(['BTCUSDT','USDTBRL','lixo'],f,{...FAST,tries:1});
  assert.deepEqual(p,{BTCUSDT:81000.5,USDTBRL:5.4});
  assert.match(decodeURIComponent(urls[0]),/symbols=\["BTCUSDT","USDTBRL"\]/);
  assert.deepEqual(await D.fetchPrices([],()=>{throw new Error('não deve chamar')}),{});
  await assert.rejects(D.fetchPrices(['BTCUSDT'],()=>Promise.reject(new Error('rede')),FAST),/rede/);
});

test('fetchKlinesRange pagina, não repete velas e para no fim',async()=>{
  const STEP=3600000,all=[];for(let i=0;i<2500;i++)all.push(row(i*STEP,100+i));
  const urls=[];
  const f=u=>{urls.push(u);const url=new URL(u),st=+url.searchParams.get('startTime'),en=+url.searchParams.get('endTime'),lim=+url.searchParams.get('limit');
    return ok(all.filter(r=>r[0]>=st&&r[0]<=en).slice(0,lim))};
  const cs=await D.fetchKlinesRange('BTCUSDT','1h',0,2499*STEP,f,FAST);
  assert.equal(cs.length,2500);assert.equal(urls.length,3);
  for(let i=1;i<cs.length;i++)assert.equal(cs[i].t-cs[i-1].t,STEP);
  assert.deepEqual((await D.fetchKlinesRange('BTCUSDT','1h',5*STEP,5*STEP+1,f,FAST)).length,1);
  await assert.rejects(D.fetchKlinesRange('btc','1h',0,1,f,FAST),/inválido/);
  await assert.rejects(D.fetchKlinesRange('BTCUSDT','1h',0,10*STEP,()=>Promise.reject(new Error('rede')),FAST),/rede/);
  assert.equal((await D.fetchKlinesRange('BTCUSDT','1h',0,10*STEP,()=>ok([]),FAST)).length,0);
});

test('fetchTicker24h devolve preço e variação em %, com espelho de reserva',async()=>{
  const urls=[];
  const f=u=>{urls.push(u);return urls.length===1?Promise.reject(new Error('rede')):ok([{symbol:'BTCUSDT',lastPrice:'81000',openPrice:'80000'},{symbol:'ETHUSDT',lastPrice:'2400',openPrice:'2500'},{symbol:'X',lastPrice:'1',openPrice:'1'},{symbol:'SOLUSDT',lastPrice:'0',openPrice:'1'}])};
  const t=await D.fetchTicker24h(['BTCUSDT','ETHUSDT','lixo'],f,{...FAST,tries:1});
  assert.deepEqual(Object.keys(t),['BTCUSDT','ETHUSDT']);
  approx(t.BTCUSDT.price,81000);approx(t.BTCUSDT.change,1.25);approx(t.ETHUSDT.change,-4);
  assert.match(urls[1],/data-api\.binance\.vision/);assert.match(decodeURIComponent(urls[0]),/ticker\/24hr\?type=MINI&symbols=\["BTCUSDT","ETHUSDT"\]/);
  assert.deepEqual(await D.fetchTicker24h([],()=>{throw new Error('não deve chamar')}),{});
  await assert.rejects(D.fetchTicker24h(['BTCUSDT'],()=>Promise.reject(new Error('rede')),FAST),/rede/);
});
function approx(a,b,e=1e-9){assert.ok(Math.abs(a-b)<=e,a+' != '+b)}


/* ---------- resiliência ---------- */
const hdr=(m)=>({get:k=>m[k.toLowerCase()]||null});
const resp=(status,extra={})=>Promise.resolve({ok:false,status,headers:hdr(extra.headers||{}),json:()=>Promise.resolve({})});

test('rede instável: tenta de novo no mesmo servidor com espera crescente e acaba conseguindo',async()=>{
  const waits=[],urls=[];let n=0;
  const f=u=>{urls.push(u);return ++n<3?Promise.reject(new Error('rede')):ok([row(1000,10),row(2000,11)])};
  const cs=await D.fetchKlines('BTCUSDT','1m',10,f,{sleep:ms=>{waits.push(ms);return Promise.resolve()}});
  assert.equal(cs.length,2);assert.equal(urls.length,3);
  assert.ok(urls.every(u=>/api\.binance\.com/.test(u)),'insiste no principal antes do espelho');
  assert.deepEqual(waits,[400,800]);
});
test('429 respeita o Retry-After; depois de esgotar as tentativas, usa o servidor reserva',async()=>{
  const waits=[],urls=[];
  const f=u=>{urls.push(u);return /binance\.vision/.test(u)?ok([row(1000,10),row(2000,11)]):resp(429,{headers:{'retry-after':'3'}})};
  const cs=await D.fetchKlines('BTCUSDT','1m',10,f,{sleep:ms=>{waits.push(ms);return Promise.resolve()}});
  assert.equal(cs.length,2);assert.deepEqual(waits,[3000,3000]);assert.equal(urls.length,4);
});
test('erro 5xx também é tentado de novo; 400 não é',async()=>{
  let n=0;const f=()=>++n<2?resp(503):ok([row(1000,10),row(2000,11)]);
  assert.equal((await D.fetchKlines('BTCUSDT','1m',10,f,FAST)).length,2);assert.equal(n,2);
  n=0;await assert.rejects(D.fetchKlines('NOPEUSDT','1m',10,()=>{n++;return resp(400)},FAST),/não encontrado/);assert.equal(n,1,'pedido ruim não repete');
});
test('451 (bloqueio regional) passa direto ao reserva e o servidor fica de molho',async()=>{
  const urls=[];let now=1e6;
  const f=u=>{urls.push(u);return /binance\.vision/.test(u)?ok([row(1000,10),row(2000,11)]):resp(451)};
  const o={...FAST,now:()=>now};
  await D.fetchKlines('BTCUSDT','1m',10,f,o);
  assert.equal(urls.length,2,'uma tentativa no bloqueado, depois o reserva');
  urls.length=0;now+=60000;
  await D.fetchKlines('BTCUSDT','1m',10,f,o);
  assert.equal(urls.length,1);assert.match(urls[0],/binance\.vision/,'nem tenta o servidor bloqueado');
  urls.length=0;now+=11*60000;
  await D.fetchKlines('BTCUSDT','1m',10,f,o);
  assert.equal(urls.length,2,'passado o bloqueio, volta a tentar o principal');
});
test('disjuntor abre depois de falhas seguidas e fecha ao ter sucesso',async()=>{
  let now=1e6;const o={...FAST,now:()=>now,tries:1};
  const bad=u=>/binance\.vision/.test(u)?ok([row(1000,10),row(2000,11)]):Promise.reject(new Error('rede'));
  for(let i=0;i<3;i++)await D.fetchKlines('BTCUSDT','1m',10,bad,o);
  assert.ok(D.breakerState()['https://api.binance.com'].openUntil>now);
  const urls=[];await D.fetchKlines('BTCUSDT','1m',10,u=>{urls.push(u);return ok([row(1000,10),row(2000,11)])},o);
  assert.match(urls[0],/binance\.vision/);
  now+=61000;await D.fetchKlines('BTCUSDT','1m',10,()=>ok([row(1000,10),row(2000,11)]),o);
  assert.equal(D.breakerState()['https://api.binance.com'].fails,0);
});
test('se todos os servidores estão de molho, tenta mesmo assim em vez de ficar parado',async()=>{
  let now=1e6;const o={...FAST,now:()=>now,tries:1};
  for(let i=0;i<3;i++)await D.fetchKlines('BTCUSDT','1m',10,()=>Promise.reject(new Error('x')),o).catch(()=>{});
  assert.equal((await D.fetchKlines('BTCUSDT','1m',10,()=>ok([row(1000,10),row(2000,11)]),o)).length,2);
});
test('timeout vira erro e é tentado de novo',async()=>{
  let n=0;const f=(u,o)=>++n<2?new Promise((_,rej)=>{o.signal.addEventListener('abort',()=>rej(Object.assign(new Error('aborted'),{name:'AbortError'})))}):ok([row(1000,10),row(2000,11)]);
  const cs=await D.fetchKlines('BTCUSDT','1m',10,f,{...FAST,timeoutMs:20});
  assert.equal(cs.length,2);assert.equal(n,2);
});

test('classify decide o que fazer com cada erro',()=>{
  const e=s=>Object.assign(new Error('x'),{status:s});
  assert.equal(D.classify(e(400)),'fatal');assert.equal(D.classify(e(404)),'fatal');
  assert.equal(D.classify(e(451)),'blocked');assert.equal(D.classify(e(403)),'blocked');
  assert.equal(D.classify(e(429)),'retry');assert.equal(D.classify(e(418)),'retry');assert.equal(D.classify(e(502)),'retry');
  assert.equal(D.classify(e(401)),'next');assert.equal(D.classify(new Error('rede')),'retry');
});

test('parseKlines corrige máxima/mínima, remove repetidas e ignora lixo',()=>{
  const cs=D.parseKlines([[2000,'10','9','8','9.5','5'],[1000,'10','11','9','10','1'],[2000,'10','12','8','11','7'],[3000,'-1','1','1','1','1'],[4000,'5','5','5','5','x']]);
  assert.deepEqual(cs.map(c=>c.t),[1000,2000,4000]);
  assert.equal(cs[1].c,11,'vale a última repetida');
  const fix=D.parseKlines([[1000,'10','9','8','9.5','5']])[0];assert.ok(fix.h>=10&&fix.l<=8);
  assert.equal(cs[2].v,0);
});

test('dataHealth: em dia, atrasada, com buracos e vazia',()=>{
  const TF=3600000,mk=(n,from=0)=>Array.from({length:n},(_,i)=>({t:from+i*TF,o:1,h:1,l:1,c:1,v:1}));
  const cs=mk(10),now=cs[9].t+TF+5000;            // a última vela acabou de fechar
  let h=D.dataHealth(cs,TF,now);assert.equal(h.ok,true);assert.equal(h.stale,false);assert.equal(h.gaps,0);
  h=D.dataHealth(cs,TF,now+3*TF);assert.equal(h.stale,true);assert.equal(h.ok,false);assert.match(h.reason,/atraso/);
  const holes=cs.slice(0,4).concat(cs.slice(6));h=D.dataHealth(holes,TF,now);assert.equal(h.gaps,1);assert.equal(h.ok,false);
  h=D.dataHealth(cs.concat([{t:cs[9].t+TF,o:1,h:1,l:1,c:1,v:1}]),TF,now);assert.equal(h.stale,false,'vela em formação não conta como fechada');
  assert.equal(D.dataHealth([],TF,now).stale,true);assert.equal(D.dataHealth(null,TF,now).ok,false);
  assert.match(D.dataHealth([{t:now,o:1,h:1,l:1,c:1,v:1}],TF,now).reason,/nenhuma vela fechada/);
});

test('macroTf mapeia o intervalo maior de cada intervalo',()=>{
  assert.equal(D.macroTf('15m'),'4h');assert.equal(D.macroTf('1h'),'4h');assert.equal(D.macroTf('4h'),'1d');assert.equal(D.macroTf('1d'),'1w');assert.equal(D.macroTf('1w'),null);
  Object.values({a:'15m',b:'1h',c:'4h',d:'1d',e:'5m',f:'1m'}).forEach(tf=>assert.ok(D.TFS[D.macroTf(tf)]>D.TFS[tf]));
});
