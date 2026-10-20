const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../js/data.js');

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
  const cs=await D.fetchKlines('BTCUSDT','1m',100,f);
  assert.equal(cs.length,2);assert.equal(urls.length,2);assert.match(urls[1],/data-api\.binance\.vision/);
});
test('fetchKlines: ativo inexistente e entradas inválidas',async()=>{
  await assert.rejects(D.fetchKlines('NAOEXISTEUSDT','1m',10,()=>bad(400)),/não encontrado/);
  await assert.rejects(D.fetchKlines('btc','1m',10,()=>ok([])),/inválido/);
  await assert.rejects(D.fetchKlines('BTCUSDT','7m',10,()=>ok([])),/Intervalo/);
  await assert.rejects(D.fetchKlines('BTCUSDT','1m',10,()=>Promise.reject(new Error('rede'))),/rede/);
});
test('fetchSymbols filtra pares USDT',async()=>{
  const l=await D.fetchSymbols(()=>ok([{symbol:'ETHUSDT'},{symbol:'BTCBRL'},{symbol:'BTCUSDT'},{symbol:'ETHUPUSDT'},{x:1}]));
  assert.deepEqual(l,['BTCUSDT','ETHUSDT']);
});

test('fetchPrices lê vários pares e usa o espelho se o principal falhar',async()=>{
  const urls=[];
  const f=u=>{urls.push(u);return urls.length===1?Promise.reject(new Error('rede')):ok([{symbol:'BTCUSDT',price:'81000.5'},{symbol:'USDTBRL',price:'5.4'},{symbol:'X',price:'1'},{symbol:'ETHUSDT',price:'0'}])};
  const p=await D.fetchPrices(['BTCUSDT','USDTBRL','lixo'],f);
  assert.deepEqual(p,{BTCUSDT:81000.5,USDTBRL:5.4});
  assert.match(decodeURIComponent(urls[0]),/symbols=\["BTCUSDT","USDTBRL"\]/);
  assert.deepEqual(await D.fetchPrices([],()=>{throw new Error('não deve chamar')}),{});
  await assert.rejects(D.fetchPrices(['BTCUSDT'],()=>Promise.reject(new Error('rede'))),/rede/);
});
