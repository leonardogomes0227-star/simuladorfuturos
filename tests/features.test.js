const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../js/engine.js'),B=require('../js/bot.js');
const approx=(a,b,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,a+' != '+b);
const TF=900000;
const mk=(o,h,l,c,t=0)=>({t,o,h,l,c,v:1});

test('normParams: recursos novos desligados por padrão e limitados',()=>{
  const d=E.normParams();
  ['trendP','beR','trailAtr','maxBars','atrMinPct','atrMaxPct','cooldown'].forEach(k=>assert.equal(d[k],0,k));
  const p=E.normParams({trendP:10,beR:9,trailAtr:0.2,maxBars:1,atrMinPct:9,atrMaxPct:1,cooldown:500});
  assert.equal(p.trendP,50);assert.equal(p.beR,3);assert.equal(p.trailAtr,1);assert.equal(p.maxBars,4);assert.equal(p.cooldown,50);
  assert.ok(p.atrMaxPct>=p.atrMinPct);
  assert.equal(E.normParams({trendP:-5,beR:-1,cooldown:-3}).trendP,0);
});

test('stepTrade: breakeven sobe o stop só depois da vela e vale a partir da próxima',()=>{
  const P=E.normParams({beR:1});
  const t={side:'long',entry:100,stop:98,target:110,dist0:2,mfe:0,bars:0,moved:false};
  assert.equal(E.stepTrade(t,mk(100,102.5,99,101),1,P),null);   // andou +2,5 (>=1R): stop vai para 100
  assert.equal(t.stop,100);assert.equal(t.moved,true);
  const r=E.stepTrade(t,mk(101,102,99.5,100.5),1,P);             // volta e toca 100
  assert.deepEqual(r,{price:100,reason:'Stop móvel'});
  // sem breakeven, o mesmo caminho não sairia
  const t2={side:'long',entry:100,stop:98,target:110,dist0:2,mfe:0,bars:0,moved:false};
  E.stepTrade(t2,mk(100,102.5,99,101),1,E.normParams());
  assert.equal(E.stepTrade(t2,mk(101,102,99.5,100.5),1,E.normParams()),null);
});

test('stepTrade: trailing persegue o preço e nunca afrouxa; venda espelha',()=>{
  const P=E.normParams({trailAtr:2,beR:1});
  const t={side:'long',entry:100,stop:98,target:120,dist0:2,mfe:0,bars:0,moved:false};
  E.stepTrade(t,mk(100,106,100,105),1,P);approx(t.stop,104);   // 106-2*1
  E.stepTrade(t,mk(105,105.5,104.5,105),1,P);approx(t.stop,104); // não desce
  E.stepTrade(t,mk(105,108,105,107),1,P);approx(t.stop,106);
  assert.equal(E.stepTrade(t,mk(107,107,105.9,106),1,P).reason,'Stop móvel');
  const s={side:'short',entry:100,stop:102,target:80,dist0:2,mfe:0,bars:0,moved:false};
  E.stepTrade(s,mk(100,100,94,95),1,P);approx(s.stop,96);       // 94+2
  E.stepTrade(s,mk(95,97,95,96),1,P);approx(s.stop,96);
});

test('stepTrade: tempo máximo, stop antes do alvo na mesma vela e alvo',()=>{
  const P=E.normParams({maxBars:5});
  const t={side:'long',entry:100,stop:98,target:110,dist0:2,mfe:0,bars:0,moved:false};
  for(let i=0;i<4;i++)assert.equal(E.stepTrade(t,mk(100,101,99,100),1,P),null);
  assert.deepEqual(E.stepTrade(t,mk(100,101,99,100.4),1,P),{price:100.4,reason:'Tempo'});
  const u={side:'long',entry:100,stop:98,target:110,dist0:2,mfe:0,bars:0};
  assert.equal(E.stepTrade(u,mk(100,111,97,100),1,E.normParams()).reason,'Stop');
  assert.equal(E.stepTrade({...u,bars:0},mk(100,111,99,100),1,E.normParams()).reason,'Alvo');
});

test('filtros: tendência longa e volatilidade bloqueiam sinais, nunca criam',()=>{
  const cs=E.genCandles(11,95000,0.004,900),base=E.normParams();
  const ind0=E.computeIndicators(cs,base);
  const count=(P)=>{const ind=E.computeIndicators(cs,P);let n=0;for(let i=0;i<cs.length;i++)if(E.signalAt(cs,ind,i,P).dir!=='wait')n++;return n};
  const n0=count(base);assert.ok(n0>0);
  assert.ok(count({...base,trendP:200})<=n0);
  assert.ok(count({...base,atrMinPct:50})===0,'volatilidade mínima absurda bloqueia tudo');
  assert.ok(count({...base,atrMaxPct:0.0001})===0);
  // sinal com filtro de tendência respeita o lado
  const P=E.normParams({trendP:100}),ind=E.computeIndicators(cs,P);
  for(let i=0;i<cs.length;i++){const s=E.signalAt(cs,ind,i,P);if(s.dir==='long')assert.ok(cs[i].c>=ind.et[i]);if(s.dir==='short')assert.ok(cs[i].c<=ind.et[i])}
});

test('backtest: cooldown reduz operações, breakeven e custos mudam R',()=>{
  const cs=E.genCandles(23,3400,0.0045,1500),run=(p,fee=0,slip=0)=>{const P=E.normParams(p);return E.backtest(cs,E.computeIndicators(cs,P),fee,P,slip)};
  const a=run({}),c=run({cooldown:8});
  assert.ok(a.n>10);assert.ok(c.n<=a.n);
  assert.ok(run({},0.05,0.02).totalR<a.totalR,'custos reduzem o resultado');
  const be=run({beR:1});
  assert.ok(be.trades.some(t=>t.why==='stop móvel'),'breakeven deve ser acionado alguma vez');
  be.trades.forEach(t=>{assert.ok(t.j>t.i);if(t.why==='stop móvel')assert.ok(t.R>-1.0001)});
  assert.ok(be.trades.length>0);
});

// A regra do robô e a do backtest são a mesma: mesmas entradas, mesmas saídas.
function botVsBacktest(params,seed,base){
  const cs=E.genCandles(seed,base,0.004,1400),P=E.normParams(params);
  const bt=E.backtest(cs,E.computeIndicators(cs,P),0,P,0);
  const st=B.defaults();
  Object.assign(st.cfg,{syms:['BTCUSDT'],tf:'15m',maxOpen:1,dailyPct:20,riskPct:1,lev:20,feePct:0,slipPct:0,capital:1e6});
  st.params=P;st.cursor.BTCUSDT=cs[E.minBars(P)-1].t;
  B.step(st,{BTCUSDT:cs},cs[cs.length-1].t+TF);
  return {bt,st,cs};
}
for(const [nome,params] of [['padrão',{}],['tendência+breakeven',{trendP:100,beR:1}],['trailing+tempo',{beR:1,trailAtr:2.5,maxBars:30}],['cooldown+volatilidade',{cooldown:6,atrMinPct:0.1}],['agressiva',{minScore:3,adxMin:15,rr:1.5}]]){
  test('robô == backtest ('+nome+')',()=>{
    for(const [seed,base] of [[11,95000],[23,3400]]){
      const {bt,st,cs}=botVsBacktest(params,seed,base);
      const closed=st.trades.filter(t=>t.status==='closed');
      const btClosed=bt.trades.filter(t=>t.why!=='fim dos dados');
      assert.ok(btClosed.length>3,'amostra mínima ('+nome+' seed '+seed+')');
      assert.equal(closed.length,btClosed.length,'mesmo número de operações fechadas');
      closed.forEach((t,k)=>{
        const b=btClosed[k];
        assert.equal(t.openT,cs[b.i].t,'mesma vela de entrada');
        assert.equal(t.side,b.dir);
        assert.equal(t.reason.toLowerCase(),b.why,'mesmo motivo de saída');
        assert.equal(t.closedAt,cs[b.j].t+TF,'mesma vela de saída');
        const R=t.pnl/t.risk;               // sem custos, o R do robô é o do backtest
        assert.ok(Math.abs(R-b.R)<1e-6,'R igual: '+R+' vs '+b.R);
      });
    }
  });
}
test('robô: cooldown de verdade e estado salvo com campos novos',()=>{
  const {st}=botVsBacktest({beR:1,trailAtr:2},11,95000);
  const back=B.sanitize(JSON.parse(JSON.stringify(st)));
  assert.equal(back.trades.length,st.trades.length);
  back.trades.forEach((t,i)=>{assert.equal(t.dist0,st.trades[i].dist0);assert.equal(t.moved,st.trades[i].moved);assert.equal(t.mfe,st.trades[i].mfe)});
  assert.equal(back.params.trailAtr,2);
});
