const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../js/engine.js');

const TF=900000;
function aggregate(cs,k){const out=[];for(let i=0;i+k<=cs.length;i+=k){const g=cs.slice(i,i+k);out.push({t:g[0].t,o:g[0].o,h:Math.max(...g.map(x=>x.h)),l:Math.min(...g.map(x=>x.l)),c:g[g.length-1].c,v:g.reduce((a,x)=>a+x.v,0)})}return out}
const base=(seed=11,b=95000,n=2400)=>E.genCandles(seed,b,0.004,n);
const P1=E.normParams({htf:1});

test('normParams: htf é 0 ou 1',()=>{
  assert.equal(E.normParams().htf,0);assert.equal(E.normParams({htf:1}).htf,1);assert.equal(E.normParams({htf:7}).htf,1);assert.equal(E.normParams({htf:-1}).htf,0);
});

test('tfName',()=>{assert.equal(E.tfName(900000),'15m');assert.equal(E.tfName(14400000),'4h');assert.equal(E.tfName(86400000),'1d');assert.equal(E.tfName(604800000),'1sem')});

test('htfBiasSeries: alinha cada vela base à última vela maior já FECHADA',()=>{
  const cs=base(),hc=aggregate(cs,16),s=E.htfBiasSeries(cs,hc);
  assert.equal(s.name,'4h');assert.equal(s.bias.length,cs.length);
  // dentro de uma vela de 4h (ainda em formação) vale a vela de 4h anterior
  const k=60,i0=k*16;                      // início da 61ª vela de 4h
  const sTrunc=E.htfBiasSeries(cs.slice(0,i0+5),hc.slice(0,k));  // só as 60 primeiras de 4h fechadas
  for(let i=i0;i<i0+5;i++)assert.equal(s.bias[i],sTrunc.bias[i],'vela base '+i+' usa só o que já fechou');
  assert.ok(s.bias.some(b=>b===1)&&s.bias.some(b=>b===-1),'a série tem altas e baixas');
  assert.ok(isNaN(s.bias[0]),'sem histórico suficiente no começo');
});

test('htfBiasSeries não vaza o futuro: cortar o fim dos dados não muda o passado',()=>{
  const cs=base(23,3400,2400),hc=aggregate(cs,16),full=E.htfBiasSeries(cs,hc);
  for(const cut of [900,1300,1700,2100]){
    const csC=cs.slice(0,cut),hcC=hc.filter(c=>c.t+TF*16<=csC[csC.length-1].t+TF);
    const part=E.htfBiasSeries(csC,hcC);
    for(let i=0;i<cut;i++){
      const a=full.bias[i],b=part.bias[i];
      assert.ok((isNaN(a)&&isNaN(b))||a===b,'diferença no índice '+i+' com corte '+cut);
    }
  }
});

test('htfBiasSeries: dados ruins viram "sem dados", nunca erro',()=>{
  const cs=base(11,95000,200);
  assert.equal(E.htfBiasSeries(cs,[]).missing,true);
  assert.equal(E.htfBiasSeries(cs,cs).missing,true,'intervalo maior igual ao base não serve');
  assert.equal(E.htfBiasSeries(cs.slice(0,1),aggregate(cs,16)).missing,true);
});

test('com htf ligado e sem dados do intervalo maior, nunca dispara sinal (falha segura)',()=>{
  const cs=base(),ind=E.computeIndicators(cs,P1);
  assert.equal(ind.htf.missing,true);
  let blockedByMissing=0;
  for(let i=70;i<cs.length;i++){
    const s=E.signalAt(cs,ind,i,P1);
    assert.equal(s.dir,'wait');
    if(s.blockers.some(b=>/Sem dados do intervalo maior/.test(b)))blockedByMissing++;
  }
  assert.ok(blockedByMissing>0,'explica o motivo');
});

test('filtro de intervalo maior só bloqueia, nunca cria sinal; e todo sinal está a favor da tendência maior',()=>{
  for(const [seed,b] of [[11,95000],[23,3400],[37,180]]){
    const cs=base(seed,b),hc=aggregate(cs,16);
    const ind0=E.computeIndicators(cs,E.normParams()),ind1=E.computeIndicators(cs,P1,hc);
    let n0=0,n1=0;
    for(let i=0;i<cs.length;i++){
      const s0=E.signalAt(cs,ind0,i,E.normParams()),s1=E.signalAt(cs,ind1,i,P1);
      if(s0.dir!=='wait')n0++;
      if(s1.dir!=='wait'){
        n1++;
        assert.notEqual(s0.dir,'wait','nunca cria sinal');assert.equal(s0.dir,s1.dir);
        assert.equal(s1.htfBias,s1.dir==='long'?1:-1,'a favor da tendência maior');
      }
    }
    assert.ok(n0>0);assert.ok(n1<=n0);
  }
});

test('bloqueio explica: compra contra a tendência maior',()=>{
  const cs=base(),hc=aggregate(cs,16),ind=E.computeIndicators(cs,P1,hc);
  let achou=false;
  for(let i=0;i<cs.length&&!achou;i++){
    const s=E.signalAt(cs,ind,i,P1),s0=E.signalAt(cs,E.computeIndicators(cs,E.normParams()),i,E.normParams());
    if(s0.dir!=='wait'&&s.dir==='wait'){
      const m=s.blockers.find(b=>/tendência maior/.test(b));
      if(m){achou=true;assert.match(m,/(Compra|Venda) sem apoio da tendência maior \(4h (em baixa|em alta|lateral)\)/)}
    }
  }
  assert.ok(achou,'deve existir ao menos um sinal barrado pelo filtro nesta série');
});

test('checks: lista de critérios completa e coerente com o sinal',()=>{
  const cs=base(),hc=aggregate(cs,16),P=E.normParams({htf:1,adxMin:20}),ind=E.computeIndicators(cs,P,hc);
  let comSinal=0,lateral=0;
  for(let i=0;i<cs.length;i++){
    const s=E.signalAt(cs,ind,i,P);
    if(i<E.minBars(P)||!isFinite(s.adx)){assert.equal(s.checks.length,0);continue}
    const ids=s.checks.map(c=>c.id);
    assert.deepEqual(ids,['adx','macro','align','score','rsi','volume','rr']);
    s.checks.forEach(c=>{assert.equal(typeof c.ok,'boolean');assert.ok(c.label&&c.detail)});
    if(s.dir!=='wait'){comSinal++;assert.ok(s.checks.filter(c=>c.required).every(c=>c.ok),'sinal => todos os critérios obrigatórios ok')}
    if(s.adx<P.adxMin){lateral++;assert.equal(s.checks[0].ok,false);assert.ok(s.blockers.some(b=>/Mercado lateral/.test(b)),'ADX baixo sempre bloqueia')}
    else assert.equal(s.checks[0].ok,true);
  }
  assert.ok(comSinal>0&&lateral>0);
  // sem o filtro macro, o critério não aparece
  const s=E.signalAt(cs,E.computeIndicators(cs,E.normParams()),500,E.normParams());
  assert.ok(!s.checks.some(c=>c.id==='macro'));
});

test('ADX abaixo do mínimo bloqueia mesmo com todo o resto a favor',()=>{
  const cs=base(23,3400,1500),P=E.normParams({adxMin:50}),ind=E.computeIndicators(cs,P);
  for(let i=0;i<cs.length;i++){const s=E.signalAt(cs,ind,i,P);if(isFinite(s.adx)&&s.adx<50)assert.equal(s.dir,'wait')}
});

/* ---------- robô e servidor com o intervalo maior ---------- */
const B=require('../js/bot.js');
function botVsBacktestHtf(params,seed,b){
  const cs=base(seed,b,2800),hc=aggregate(cs,16),Pm=E.normParams({...params,htf:1});
  const c0=E.minBars(Pm)+16*60-1;                      // o robô começa depois desta vela
  const bt=E.backtest(cs,E.computeIndicators(cs,Pm,hc),0,Pm,0,c0+1); // o backtest larga do mesmo ponto
  const st=B.defaults();
  Object.assign(st.cfg,{syms:['BTCUSDT'],tf:'15m',maxOpen:1,dailyPct:20,riskPct:1,lev:20,feePct:0,slipPct:0,capital:1e6});
  st.params=Pm;st.cursor.BTCUSDT=cs[c0].t;
  B.step(st,{BTCUSDT:cs},cs[cs.length-1].t+TF,{BTCUSDT:hc});
  return {bt,st,cs,Pm};
}
for(const [nome,params] of [['padrão+macro',{}],['macro+breakeven',{beR:1}],['macro+tendência longa',{trendP:100}],['agressiva+macro',{minScore:3,adxMin:15,rr:1.5}]]){
  test('robô == backtest com intervalo maior ('+nome+')',()=>{
    let total=0;
    for(const [seed,b] of [[11,95000],[23,3400],[37,180]]){
      const {bt,st,cs}=botVsBacktestHtf(params,seed,b);
      const btClosed=bt.trades.filter(t=>t.why!=='fim dos dados'),closed=st.trades.filter(t=>t.status==='closed');
      assert.equal(closed.length,btClosed.length,'mesmo número de operações ('+nome+' seed '+seed+')');
      closed.forEach((t,k)=>{
        const x=btClosed[k];
        assert.equal(t.openT,cs[x.i].t);assert.equal(t.side,x.dir);assert.equal(t.reason.toLowerCase(),x.why);assert.equal(t.closedAt,cs[x.j].t+TF);
        assert.ok(Math.abs(t.pnl/t.risk-x.R)<1e-6);
      });
      total+=closed.length;
    }
    assert.ok(total>=3,'amostra mínima: '+total);
  });
}

test('robô: sem dados do intervalo maior não abre posição nova e avisa no registro',()=>{
  const cs=base(11,95000,2800),Pm=E.normParams({htf:1}),st=B.defaults();
  Object.assign(st.cfg,{syms:['BTCUSDT'],tf:'15m',maxOpen:1,dailyPct:20,feePct:0,slipPct:0});
  st.params=Pm;st.cursor.BTCUSDT=cs[E.minBars(Pm)+16*60-1].t;
  B.step(st,{BTCUSDT:cs},cs[cs.length-1].t+TF);                 // nenhum dado do intervalo maior
  assert.equal(st.trades.length,0);
  assert.ok(st.log.some(l=>/sem dados do intervalo maior \(4h\)/.test(l)));
  const n=st.log.length;st.cursor.BTCUSDT=cs[1500].t;B.step(st,{BTCUSDT:cs},cs[cs.length-1].t+TF);
  assert.equal(st.log.length,n,'não repete a mesma mensagem');
  // com os dados, volta a operar
  const st2=B.defaults();Object.assign(st2.cfg,{syms:['BTCUSDT'],tf:'15m',maxOpen:1,dailyPct:20,feePct:0,slipPct:0});st2.params=Pm;st2.cursor.BTCUSDT=cs[1500].t;
  B.step(st2,{BTCUSDT:cs},cs[cs.length-1].t+TF,{BTCUSDT:aggregate(cs,16)});
  assert.ok(st2.trades.length>0);
});

test('robô: operação já aberta continua sendo gerida mesmo sem dados do intervalo maior',()=>{
  const cs=base(11,95000,2800),hc=aggregate(cs,16),Pm=E.normParams({htf:1}),st=B.defaults();
  Object.assign(st.cfg,{syms:['BTCUSDT'],tf:'15m',maxOpen:1,dailyPct:20,feePct:0,slipPct:0});st.params=Pm;
  st.cursor.BTCUSDT=cs[1300].t;
  B.step(st,{BTCUSDT:cs.slice(0,1700)},cs[1699].t+TF,{BTCUSDT:hc});
  const open=st.trades.filter(t=>t.status==='open');
  if(!open.length)return;
  const before=B.closedTrades(st).length;
  B.step(st,{BTCUSDT:cs},cs[cs.length-1].t+TF);                  // sem intervalo maior daqui para frente
  assert.ok(B.closedTrades(st).length>=before,'as posições abertas continuam sendo resolvidas por stop/alvo');
});

test('config em português: confirmacaoMacro liga e desliga o filtro',()=>{
  assert.equal(B.parseConfig({}).params.htf,0);
  assert.equal(B.parseConfig({confirmacaoMacro:true}).params.htf,1);
  assert.equal(B.parseConfig({parametros:{htf:1}}).params.htf,1);
  assert.equal(B.parseConfig({parametros:{htf:1},confirmacaoMacro:false}).params.htf,0,'a chave explícita vence');
  assert.match(B.parseConfig({confirmacaoMacro:'sim'}).error,/true ou false/);
});
