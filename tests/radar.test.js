const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../js/engine.js'),D=require('../js/data.js'),Rd=require('../js/radar.js');

const TF=900000,HTF=14400000;
function aggregate(cs,k){const out=[];for(let i=0;i+k<=cs.length;i+=k){const g=cs.slice(i,i+k);out.push({t:g[0].t,o:g[0].o,h:Math.max(...g.map(x=>x.h)),l:Math.min(...g.map(x=>x.l)),c:g[g.length-1].c,v:g.reduce((a,x)=>a+x.v,0)})}return out}
const series=(seed=11,b=95000,n=2400)=>E.genCandles(seed,b,0.004,n);
const P=E.normParams({htf:1});
function at(cs,i,extra){ // dados como estariam logo depois da vela i fechar, com uma vela nova em formação
  const now=cs[i].t+TF+1000,hc=aggregate(cs,16).filter(c=>c.t+HTF<=now);
  const forming={t:cs[i].t+TF,o:cs[i].c,h:cs[i].c*1.002,l:cs[i].c*0.998,c:cs[i].c*1.001,v:1};
  return Object.assign({sym:'BTCUSDT',tf:'15m',htfTf:'4h',base:cs.slice(0,i+1).concat([forming]),htf:hc,params:P,now},extra);
}
function find(cs,pred,from=800){for(let i=from;i<cs.length-1;i++)if(pred(i))return i;return -1}

test('closedOnly corta a vela em formação; nextClose e countdown',()=>{
  const cs=[{t:0},{t:TF},{t:2*TF}];
  assert.equal(Rd.closedOnly(cs,TF,2*TF+10).length,2);assert.equal(Rd.closedOnly(cs,TF,3*TF).length,3);assert.equal(Rd.closedOnly(cs,TF,0).length,0);
  assert.equal(Rd.nextClose(cs,TF,2*TF+10),3*TF);assert.equal(Rd.nextClose(cs,TF,3*TF+5),4*TF);assert.equal(Rd.nextClose([],TF,100),100+TF);
  assert.equal(Rd.countdown(45000),'45 s');assert.equal(Rd.countdown(5*60000),'5 min');assert.equal(Rd.countdown(2*3600000+10*60000),'2 h 10 min');assert.equal(Rd.countdown(3*86400000),'3 dias');assert.equal(Rd.countdown(0),'agora');
});

test('verde: sinal com todos os critérios, calculado só na vela fechada',()=>{
  const cs=series(),ind=E.computeIndicators(cs,P,aggregate(cs,16));
  const i=find(cs,j=>E.signalAt(cs,ind,j,P).dir!=='wait');
  assert.ok(i>0,'a série precisa ter um sinal com filtro macro');
  const a=Rd.analyze(at(cs,i));
  assert.equal(a.traffic.color,'green');assert.equal(a.traffic.title,'Pronto para operar');
  assert.notEqual(a.signal.dir,'wait');assert.equal(a.onlyClosed,true);
  assert.equal(a.closedAt,cs[i].t+TF,'o sinal é da vela que acabou de fechar');
  assert.equal(a.nextCloseAt,cs[i].t+2*TF);
  assert.ok(a.signal.checks.filter(c=>c.required).every(c=>c.ok));
});

test('a vela em formação nunca muda o sinal',()=>{
  const cs=series(),ind=E.computeIndicators(cs,P,aggregate(cs,16));
  const i=find(cs,j=>E.signalAt(cs,ind,j,P).dir!=='wait'),o=at(cs,i);
  const a=Rd.analyze(o);
  const wild=o.base.slice(0,-1).concat([{t:cs[i].t+TF,o:1,h:1e9,l:0.0001,c:5e8,v:1e12}]);
  const b=Rd.analyze({...o,base:wild});
  assert.deepEqual(b.signal,a.signal);assert.equal(b.traffic.color,a.traffic.color);
  // e uma vela do intervalo maior ainda em formação também não conta
  const hWild=o.htf.concat([{t:o.htf[o.htf.length-1].t+HTF,o:1,h:1e9,l:0.1,c:1e9,v:1}]);
  assert.deepEqual(Rd.analyze({...o,htf:hWild}).signal,a.signal);
});

test('amarelo: mercado lateral (ADX baixo) com explicação',()=>{
  const cs=series(23,3400),ind=E.computeIndicators(cs,P,aggregate(cs,16));
  const i=find(cs,j=>{const s=E.signalAt(cs,ind,j,P);return isFinite(s.adx)&&s.adx<P.adxMin});
  const a=Rd.analyze(at(cs,i));
  assert.equal(a.traffic.color,'yellow');assert.equal(a.traffic.title,'Mercado lateral');assert.match(a.traffic.reason,/ADX \d+ \(mínimo 20\)/);
  assert.equal(a.signal.dir,'wait');
});

test('vermelho: contra a tendência maior',()=>{
  const cs=series(),P0=E.normParams(),ind0=E.computeIndicators(cs,P0),ind=E.computeIndicators(cs,P,aggregate(cs,16));
  const i=find(cs,j=>E.signalAt(cs,ind0,j,P0).dir!=='wait'&&E.signalAt(cs,ind,j,P).blockers.some(b=>/tendência maior/.test(b)));
  assert.ok(i>0);
  const a=Rd.analyze(at(cs,i));
  assert.equal(a.traffic.color,'red');assert.equal(a.traffic.title,'Contra a tendência maior');assert.match(a.traffic.reason,/Operar contra ela é arriscado/);
});

test('vermelho: dados atrasados ou do intervalo maior atrasados; amarelo: poucos dados',()=>{
  const cs=series(),ind=E.computeIndicators(cs,P,aggregate(cs,16)),i=find(cs,j=>E.signalAt(cs,ind,j,P).dir!=='wait'),o=at(cs,i);
  const late=Rd.analyze({...o,now:o.now+10*TF});
  assert.equal(late.traffic.color,'red');assert.equal(late.traffic.title,'Dados desatualizados');
  const lateH=Rd.analyze({...o,htf:o.htf.slice(0,-6)});
  assert.equal(lateH.traffic.color,'red');assert.match(lateH.traffic.title,/intervalo maior atrasados/);
  const few=Rd.analyze({...o,base:cs.slice(0,30),now:cs[29].t+TF+1000});
  assert.equal(few.traffic.color,'yellow');assert.equal(few.traffic.title,'Poucos dados');
  assert.equal(Rd.analyze({...o,base:[],htf:[]}).traffic.color,'red');
});

test('sem o filtro macro, o semáforo não exige o intervalo maior',()=>{
  const cs=series(),P0=E.normParams(),ind0=E.computeIndicators(cs,P0),i=find(cs,j=>E.signalAt(cs,ind0,j,P0).dir!=='wait');
  const o=at(cs,i,{params:P0,htf:[],htfTf:null});
  assert.equal(Rd.analyze(o).traffic.color,'green');
});

test('summary escolhe o melhor cenário e conta',()=>{
  const t=(c,s)=>({sym:s,traffic:{color:c}});
  let r=Rd.summary([t('red','ETHUSDT'),t('green','BTCUSDT'),t('yellow','SOLUSDT')]);
  assert.equal(r.color,'green');assert.deepEqual(r.counts,{green:1,yellow:1,red:1});assert.match(r.text,/^BTC com todos/);
  r=Rd.summary([t('red','A'),t('yellow','B')]);assert.equal(r.color,'yellow');assert.match(r.text,/1 de 2 moedas/);
  r=Rd.summary([t('red','A')]);assert.equal(r.color,'red');assert.match(r.text,/Nenhuma das 1 moeda atende/);
  assert.equal(Rd.summary([]).color,'red');
});

test('semaphore cobre "atenção": preço esticado e quase lá',()=>{
  const P0=E.normParams({minScore:4});
  const base=(o)=>Object.assign({dir:'wait',score:0,htfBias:null,checks:[{id:'adx',ok:true,detail:'ADX 30'},{id:'rsi',ok:true,detail:'RSI 60'}]},o);
  assert.equal(Rd.semaphore(base({score:4,checks:[{id:'adx',ok:true,detail:'ADX 30'},{id:'rsi',ok:false,detail:'RSI 80'}]}),P0,{}).title,'Atenção: preço esticado');
  assert.equal(Rd.semaphore(base({score:3}),P0,{}).title,'Atenção: quase lá');
  assert.equal(Rd.semaphore(base({score:1}),P0,{}).title,'Fora dos critérios');
  assert.equal(Rd.semaphore(base({score:-3}),P0,{}).color,'yellow');
});

test('analyze traz a tendência maior como contexto, mesmo com o filtro desligado',()=>{
  const cs=series(),P0=E.normParams(),ind=E.computeIndicators(cs,P,aggregate(cs,16));
  const i=find(cs,j=>E.signalAt(cs,ind,j,P).dir==='long');
  const a=Rd.analyze(at(cs,i,{params:P0}));
  assert.equal(a.macro.tf,'4h');assert.equal(a.macro.bias,1);assert.ok(a.macro.adx>0);
  const b=Rd.analyze(at(cs,i,{params:P0,htf:[],htfTf:null}));assert.equal(b.macro,null);
});
