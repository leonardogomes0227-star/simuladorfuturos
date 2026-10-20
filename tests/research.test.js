const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../js/engine.js'),R=require('../server/research.js');
const approx=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,a+' != '+b);

const STEP=900000;
const mkSets=(n=5200)=>[[11,95000],[23,3400],[37,180],[41,20]].map(([seed,base],i)=>({sym:['A','B','C','D'][i]+'USDT',tf:'15m',cs:E.genCandles(seed,base,0.004,n),inds:{}}));
const small=()=>[E.normParams({}),E.normParams({minScore:5,adxMin:25}),E.normParams({minScore:3,adxMin:15,rr:1.5}),E.normParams({trendP:100,beR:1})];

test('buildGrid: tamanho fixo, valores válidos e sem repetição',()=>{
  const g=R.buildGrid();assert.equal(g.length,192);
  assert.equal(new Set(g.map(p=>JSON.stringify(p))).size,192);
  assert.equal(g.filter(p=>p.htf===1).length,96,'metade usa o intervalo maior');
  g.forEach(p=>{assert.ok(p.minScore>=3&&p.rr>=0.5)});
});

test('stats: contas básicas e queda máxima em ordem de tempo',()=>{
  const s=R.stats([{R:2,t:1},{R:-1,t:2},{R:-1,t:3},{R:3,t:4},{R:-1,t:0}]);
  assert.equal(s.n,5);assert.equal(s.wins,2);approx(s.totalR,2);approx(s.avgR,0.4);approx(s.pf,5/3);
  approx(s.maxDD,2); // ordem por tempo: -1,2,-1,-1,3 -> pico 1, fundo -1
  assert.equal(R.stats([]).n,0);assert.equal(R.stats([]).tStat,0);
});

test('objective: exige amostra, fator de lucro e média positivos',()=>{
  const good={n:100,pf:1.4,avgR:0.1,tStat:2.5},few={...good,n:10},flat={...good,pf:0.9};
  assert.equal(R.objective(good,40),2.5);assert.equal(R.objective(few,40),-Infinity);assert.equal(R.objective(flat,40),-Infinity);
});

test('evalRange: usa só o trecho pedido e é reprodutível',()=>{
  const ds=mkSets(),t0=ds[0].cs[0].t,P=E.normParams({});
  const a=R.evalRange(ds,P,t0+1500*STEP,t0+3500*STEP,R.COSTS),b=R.evalRange(ds,P,t0+1500*STEP,t0+3500*STEP,R.COSTS);
  assert.deepEqual(a.s,b.s);assert.ok(a.s.n>0);
  a.trades.forEach(x=>{assert.ok(x.t>=t0+1500*STEP&&x.t<t0+3500*STEP)});
  assert.equal(R.evalRange(ds,P,t0,t0+10*STEP,R.COSTS).s.n,0);
  // custos pioram o resultado
  const free=R.evalRange(ds,P,t0+1500*STEP,t0+3500*STEP,{fee:0,slip:0});
  assert.ok(free.s.totalR>a.s.totalR);
});

test('walkForward: janelas em ordem, teste depois do treino e agregação coerente',()=>{
  const ds=mkSets(),wf=R.walkForward(ds,{trainMs:2000*STEP,testMs:800*STEP,stepMs:800*STEP,minTrades:15,grid:small()});
  assert.ok(wf.windows.length>=3);
  wf.windows.forEach((w,i)=>{
    assert.equal(w.testTo-w.trainTo,800*STEP);assert.equal(w.trainTo-w.trainFrom,2000*STEP);
    if(i)assert.equal(w.trainFrom-wf.windows[i-1].trainFrom,800*STEP);
  });
  const sum=wf.windows.reduce((a,w)=>a+w.test.n,0);assert.equal(wf.oos.n,sum);
  const sumBase=wf.windows.reduce((a,w)=>a+w.base.n,0);assert.equal(wf.baseline.n,sumBase);
  assert.equal(wf.grid.combos,4);assert.ok(wf.grid.positiveShare>=0&&wf.grid.positiveShare<=1);
  assert.ok(wf.grid.worstTotalR<=wf.grid.medianTotalR&&wf.grid.medianTotalR<=wf.grid.bestTotalR);
});

test('walkForward não vaza o futuro: mudar só o fim dos dados não muda janelas anteriores',()=>{
  const a=mkSets(5200),b=mkSets(5200);
  b.forEach(d=>{d.cs=d.cs.slice(0,4400);d.inds={}});            // tira o último trecho
  const o={trainMs:2000*STEP,testMs:800*STEP,stepMs:800*STEP,minTrades:15,grid:small()};
  const wa=R.walkForward(a,o),wb=R.walkForward(b,o);
  for(let i=0;i<wb.windows.length;i++){
    assert.deepEqual(wa.windows[i].params,wb.windows[i].params,'mesma escolha na janela '+(i+1));
    assert.deepEqual(wa.windows[i].test,wb.windows[i].test,'mesmo teste na janela '+(i+1));
  }
});

test('verdict: só recomenda com todos os critérios; sem vantagem não passa',()=>{
  const win=(tot)=>({test:{n:30,totalR:tot},base:{}});
  const good={windows:[win(5),win(3),win(-1),win(4)],oos:{n:200,avgR:0.12,pf:1.3,totalR:24},baseline:{totalR:5}};
  const v=R.verdict(good);assert.equal(v.recommended,true);assert.equal(v.passed,5);
  assert.equal(R.verdict({...good,oos:{...good.oos,n:50}}).recommended,false);
  assert.equal(R.verdict({...good,oos:{...good.oos,avgR:0.01}}).recommended,false);
  assert.equal(R.verdict({...good,baseline:{totalR:100}}).recommended,false);
  assert.equal(R.verdict({...good,windows:[win(5),win(-3),win(-1),win(-4)]}).recommended,false);
  assert.equal(R.verdict({windows:[],oos:R.stats([]),baseline:R.stats([])}).recommended,false);
});

test('finalSelection e relatório rodam e descrevem tudo em português',()=>{
  const ds=mkSets(),o={trainMs:2000*STEP,testMs:800*STEP,stepMs:800*STEP,minTrades:15,grid:small()},wf=R.walkForward(ds,o),v=R.verdict(wf);
  const fin=R.finalSelection(ds,small(),2400*STEP,R.COSTS,15);
  fin.forEach(x=>{assert.equal(x.quarters.length,4);assert.ok(x.positiveQuarters>=0&&x.positiveQuarters<=4)});
  const txt=R.report(ds,wf,v,fin);
  assert.match(txt,/Pesquisa walk-forward/);assert.match(txt,/Veredito: (NÃO )?RECOMENDADA/);assert.match(txt,/TESTE/);
});

test('pesquisa com intervalo maior: combinações com htf só barram operações e nunca criam',()=>{
  const agg=(cs,k)=>{const out=[];for(let i=0;i+k<=cs.length;i+=k){const g=cs.slice(i,i+k);out.push({t:g[0].t,o:g[0].o,h:Math.max(...g.map(x=>x.h)),l:Math.min(...g.map(x=>x.l)),c:g[g.length-1].c,v:g.reduce((a,x)=>a+x.v,0)})}return out};
  const ds=mkSets(7000).map(d=>({...d,htf:agg(d.cs,16),inds:{}})),t0=ds[0].cs[0].t,t1=t0+7000*STEP;
  const off=R.evalRange(ds,E.normParams({htf:0}),t0+2000*STEP,t1,R.COSTS),on=R.evalRange(ds,E.normParams({htf:1}),t0+2000*STEP,t1,R.COSTS);
  assert.ok(off.s.n>0);assert.ok(on.s.n<=off.s.n,'o filtro reduz operações: '+on.s.n+' <= '+off.s.n);
  // sem dados do intervalo maior, a combinação com htf não opera (falha segura)
  const semHtf=mkSets(7000);
  assert.equal(R.evalRange(semHtf,E.normParams({htf:1}),t0+2000*STEP,t1,R.COSTS).s.n,0);
  // walk-forward roda com o filtro na grade
  const wf=R.walkForward(ds,{trainMs:2000*STEP,testMs:800*STEP,stepMs:800*STEP,minTrades:15,grid:[E.normParams({}),E.normParams({htf:1})]});
  assert.ok(wf.windows.length>=3);assert.equal(wf.grid.combos,2);
});
