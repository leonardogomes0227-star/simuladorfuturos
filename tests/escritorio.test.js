const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const E=require('../js/engine.js'),O=require('../js/escritorio.js'),P=require('../server/office-providers.js'),{run}=require('../server/run-office.js');

const RULES=O.defaultRules(),TF=900000,T0=Date.UTC(2026,8,1);
const CONF={intervalo:'15m',moedas:['BTCUSDT'],capitalPorIA:100,agentes:[{id:'ia',nome:'IA',provedor:'anthropic',ativo:true}]};
const acct=()=>O.newAgent({id:'ia',name:'IA',provider:'anthropic',model:''},100,0);
const ctx=(price,over)=>Object.assign({now:T0,tf:'15m',syms:['BTCUSDT'],prices:{BTCUSDT:price},rules:RULES},over||{});
const open=(d)=>Object.assign({acao:'abrir',ativo:'BTCUSDT',lado:'long',stop:95,alvo:110,riscoPct:1,alavancagem:2,motivo:'x'},d||{});

test('configuração: valores padrão e erros claros',()=>{
  const ok=O.parseConfig(CONF);assert.equal(ok.error,undefined);assert.equal(ok.agents[0].active,true);assert.equal(ok.capital,100);
  assert.match(O.parseConfig(null).error,/não encontrado/);
  assert.match(O.parseConfig({...CONF,intervalo:'7m'}).error,/intervalo/);
  assert.match(O.parseConfig({...CONF,moedas:['btc']}).error,/moedas/);
  assert.match(O.parseConfig({...CONF,regras:{alavancagemMax:50}}).error,/alavancagemMax/);
  assert.match(O.parseConfig({...CONF,agentes:[{id:'A B',provedor:'openai'}]}).error,/id/);
  assert.match(O.parseConfig({...CONF,agentes:[{id:'ia',provedor:'foo'}]}).error,/provedor/);
  assert.match(O.parseConfig({...CONF,agentes:[{id:'ia',provedor:'openai'},{id:'ia',provedor:'xai'}]}).error,/repetido/);
  assert.equal(O.parseConfig({...CONF,agentes:[{id:'ia',provedor:'openai'}]}).agents[0].active,false); // desligado por padrão
});

test('decisão: lê JSON dentro de texto, cerca de código e sinônimos',()=>{
  const r=O.parseDecision('Claro!\n```json\n{"resumo":"alta","decisoes":[{"acao":"Abrir","ativo":"btc-usdt","lado":"compra","stop":"95,5","alvo":110,"riscoPct":1,"alavancagem":3,"motivo":"tendência"}]}\n```');
  assert.equal(r.ok,true);assert.equal(r.decisoes[0].ativo,'BTCUSDT');assert.equal(r.decisoes[0].lado,'long');assert.equal(r.decisoes[0].stop,95.5);
  assert.equal(O.parseDecision('{"decisoes":[{"acao":"manter"}]}').ok,true);
  assert.equal(O.parseDecision('sem json').ok,false);
  assert.equal(O.parseDecision('{"decisoes":[{"acao":"voar","ativo":"BTCUSDT"}]}').ok,false);
  assert.equal(O.parseDecision('{"decisoes":[{"acao":"abrir","ativo":"BTCUSDT"},{},{},{},{},{}]}').decisoes.length,1); // lixo descartado, máx. 4
  assert.equal(O.extractJson('lixo {"a":"}" } fim').a,'}'); // chave dentro de texto não confunde
});

test('risco: ordem sem stop, stop do lado errado e ativo desconhecido são recusados',()=>{
  const a=acct();
  assert.match(O.riskCheck(a,open({stop:NaN}),ctx(100)).msg,/sem stop/);
  assert.match(O.riskCheck(a,open({stop:101}),ctx(100)).msg,/lado errado/);
  assert.match(O.riskCheck(a,open({lado:'short',stop:99}),ctx(100)).msg,/lado errado/);
  assert.match(O.riskCheck(a,open({ativo:'DOGEUSDT'}),ctx(100)).msg,/fora da lista/);
  assert.match(O.riskCheck(a,open({lado:''}),ctx(100)).msg,/lado/);
});

test('risco: limita risco e alavancagem em vez de obedecer a IA',()=>{
  const a=acct(),r=O.riskCheck(a,open({stop:98,riscoPct:50,alavancagem:100}),ctx(100));
  assert.equal(r.ok,true);
  assert.match(r.msg,/risco reduzido de 50% para 2%/);assert.match(r.msg,/alavancagem reduzida de 100x para 5x/);
  const o=r.open;
  assert.ok(o.qty*o.entry<=100*RULES.levMax+1e-6);                       // nunca passa da alavancagem máxima
  assert.ok(o.risk<=100*RULES.riskMaxPct/100*1.2);                       // perda no stop dentro do risco máximo (com folga da derrapagem)
});

test('risco: um por ativo, limite de posições e perda diária',()=>{
  const a=acct(),c=ctx(100,{syms:['BTCUSDT','ETHUSDT'],prices:{BTCUSDT:100,ETHUSDT:50}});
  assert.equal(O.applyDecisions(a,[open()],c).results[0].ok,true);
  assert.match(O.riskCheck(a,open(),c).msg,/já existe/);
  assert.equal(O.applyDecisions(a,[open({ativo:'ETHUSDT',stop:45})],c).results[0].ok,true);
  const c3=ctx(100,{syms:['BTCUSDT','ETHUSDT','SOLUSDT'],prices:{BTCUSDT:100,ETHUSDT:50,SOLUSDT:10}});
  assert.match(O.riskCheck(a,open({ativo:'SOLUSDT',stop:9}),c3).msg,/limite de 2 posições/);
  const b=acct();b.trades.push({id:'x',sym:'BTCUSDT',side:'long',entry:100,stop:90,target:120,qty:1,lev:1,risk:10,openedAt:T0-1,next:T0,motive:'',status:'closed',exit:90,pnl:-11,closedAt:T0});
  assert.match(O.riskCheck(b,open(),ctx(100)).msg,/perda do dia/);
});

test('ajustar: só aproxima o stop, nunca afrouxa nem cruza o preço',()=>{
  const a=acct(),c=ctx(100);O.applyDecisions(a,[open()],c);
  const t=O.openTrades(a)[0];
  assert.match(O.riskCheck(a,{acao:'ajustar',ativo:'BTCUSDT',stop:90},c).msg,/nunca afrouxar/);
  assert.match(O.riskCheck(a,{acao:'ajustar',ativo:'BTCUSDT',stop:101},c).msg,/nunca afrouxar/);
  assert.equal(O.applyDecisions(a,[{acao:'ajustar',ativo:'BTCUSDT',stop:99}],c).results[0].ok,true);
  assert.equal(t.stop,99);
  assert.match(O.riskCheck(a,{acao:'ajustar',ativo:'BTCUSDT'},c).msg,/nada para ajustar/);
});

test('stop e alvo: vale o stop quando os dois caem na mesma vela; taxa e derrapagem entram na conta',()=>{
  const a=acct();O.applyDecisions(a,[open({stop:98,alvo:104})],ctx(100,{now:T0}));
  const t=O.openTrades(a)[0];
  assert.equal(O.markToMarket(a,{BTCUSDT:[{t:T0-TF,o:100,h:200,l:1,c:100,v:1}]},T0+TF,RULES).length,0); // vela anterior à abertura é ignorada
  const ev=O.markToMarket(a,{BTCUSDT:[{t:T0,o:100,h:105,l:97,c:100,v:1}]},T0+TF,RULES);
  assert.equal(ev.length,1);assert.equal(t.reason,'Stop');assert.ok(t.pnl<0);
  const b=acct();O.applyDecisions(b,[open({stop:98,alvo:104})],ctx(100));
  O.markToMarket(b,{BTCUSDT:[{t:T0,o:100,h:105,l:99,c:104,v:1}]},T0+TF,RULES);
  const w=b.trades[0];assert.equal(w.reason,'Alvo');assert.ok(w.pnl>0);
  assert.ok(w.pnl<(w.target-w.entry)*w.qty); // taxa desconta do ganho
  assert.equal(O.markToMarket(b,{BTCUSDT:[{t:T0,o:1,h:1,l:1,c:1,v:1}]},T0+TF,RULES).length,0); // fechada não fecha de novo
});

test('contas são independentes e o placar ordena por retorno',()=>{
  const st={version:1,agents:{a:acct(),b:acct()}};st.agents.a.id='a';st.agents.b.id='b';
  O.applyDecisions(st.agents.a,[open({stop:98,alvo:104})],ctx(100));
  assert.equal(O.openTrades(st.agents.b).length,0);
  const lb=O.leaderboard(st,{BTCUSDT:103},T0);
  assert.equal(lb[0].id,'a');assert.ok(lb[0].pnl>0);assert.equal(lb[1].pnl,0);
});

test('sanitize descarta lixo do estado salvo',()=>{
  const st=O.sanitize({agents:{'ia':{capital:'x',trades:[{status:'open'},null,{id:'t',sym:'BTCUSDT',side:'long',entry:1,stop:0.9,target:2,qty:1,openedAt:1,status:'open'}]},'BAD ID':{}}});
  assert.deepEqual(Object.keys(st.agents),['ia']);assert.equal(st.agents.ia.trades.length,1);assert.equal(st.agents.ia.capital,100);
  assert.deepEqual(O.sanitize(null),{version:1,agents:{}});
});

test('briefing traz regras duras, mercado e conta, e nunca a chave',()=>{
  const cs=E.genCandles(5,95000,0.004,320).map((c,i)=>({...c,t:T0+i*TF}));
  const now=cs[319].t+TF+1000,cfg=O.parseConfig(CONF),a=acct();
  const mk=O.analyzeAll(cfg,{BTCUSDT:cs},{},now,{});
  const b=O.briefing(a,cfg.agents[0],{now,tf:'15m',syms:['BTCUSDT'],prices:{BTCUSDT:cs[319].c},rules:RULES},mk);
  assert.match(b.system,/REGRAS DURAS/);assert.match(b.system,/risco máximo por operação 2%/);assert.match(b.user,/BTCUSDT: preço/);assert.match(b.user,/Posições abertas: nenhuma/);
});

test('provedores: monta a chamada certa de cada IA e esconde a chave nos erros',async()=>{
  const calls=[];
  const mock=(body,ok=true,status=200)=>(url,init)=>{calls.push({url,init});return Promise.resolve({ok,status,json:()=>Promise.resolve(body)})};
  const an=await P.ask({provider:'anthropic',model:''},'K1','sys','usr',mock({content:[{type:'text',text:'{"a":1}'}],usage:{input_tokens:5,output_tokens:2}}));
  assert.equal(an.text,'{"a":1}');assert.equal(an.inTok,5);
  assert.equal(calls[0].url,'https://api.anthropic.com/v1/messages');assert.equal(calls[0].init.headers['x-api-key'],'K1');
  assert.equal(JSON.parse(calls[0].init.body).model,'claude-sonnet-5-5');
  const gp=await P.ask({provider:'openai',model:'m'},'K2','sys','usr',mock({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:3,completion_tokens:1}}));
  assert.equal(gp.text,'ok');assert.equal(calls[1].init.headers.authorization,'Bearer K2');
  await P.ask({provider:'gemini',model:'g'},'K3','sys','usr',mock({candidates:[{content:{parts:[{text:'gem'}]}}]}));
  assert.match(calls[2].url,/models\/g:generateContent$/);assert.equal(calls[2].init.headers['x-goog-api-key'],'K3');assert.ok(!calls[2].url.includes('K3'));
  for(const p of ['xai','deepseek'])await P.ask({provider:p,model:'m'},'K','s','u',mock({choices:[{message:{content:'x'}}]}));
  assert.match(calls[3].url,/x\.ai/);assert.match(calls[4].url,/deepseek/);
  await assert.rejects(P.ask({provider:'openai'},'SEGREDO','s','u',mock({error:{message:'bad key SEGREDO'}},false,401)),(e)=>/HTTP 401/.test(e.message)&&!e.message.includes('SEGREDO'));
  await assert.rejects(P.ask({provider:'openai'},'K','s','u',mock({choices:[]})),/vazia/);
});

/* ---- rodada completa no servidor, com internet e IAs de mentira ---- */
const mkRows=(seed,base,n)=>E.genCandles(seed,base,0.004,n).map((c,i)=>[T0+i*TF,String(c.o),String(c.h),String(c.l),String(c.c),String(c.v),0]);
const DATA={BTCUSDT:mkRows(11,95000,800)};
const fetchMarket=(u)=>{
  const url=new URL(u),sym=url.searchParams.get('symbol'),lim=+url.searchParams.get('limit'),tf=url.searchParams.get('interval');
  if(!DATA[sym])return Promise.resolve({ok:false,status:400,json:()=>Promise.resolve({})});
  const rows=DATA[sym].slice(Math.max(0,300-lim),300);
  return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve(tf==='15m'?rows:[])});
};
const tmp=(conf)=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'esc-'));const c=path.join(d,'c.json');fs.writeFileSync(c,JSON.stringify(conf));return {configPath:c,statePath:path.join(d,'e','escritorio.json')}};
const NOW=T0+299*TF+TF+1000;

test('rodada: IA sem chave não opera nem gasta; com chave opera pelo gestor de risco; uma decisão por vela',async()=>{
  const conf={...CONF,agentes:[{id:'ia',nome:'IA',provedor:'anthropic',ativo:true},{id:'regras',nome:'R',provedor:'regras',ativo:true},{id:'off',nome:'Off',provedor:'openai',ativo:false}]};
  const t=tmp(conf);let hits=0,price=DATA.BTCUSDT[299][4];
  const fetchImpl=(u,init)=>{
    if(String(u).includes('anthropic')){
      hits++;const p=+price;
      const txt='{"resumo":"teste","decisoes":[{"acao":"abrir","ativo":"BTCUSDT","lado":"long","stop":'+(p*0.99)+',"alvo":'+(p*1.03)+',"riscoPct":9,"alavancagem":50,"motivo":"t"}]}';
      return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({content:[{type:'text',text:txt}],usage:{input_tokens:100,output_tokens:50}})});
    }
    return fetchMarket(u);
  };
  let r=await run({...t,fetchImpl,now:NOW,env:{}});
  assert.equal(r.st.agents.ia.status,'sem chave');assert.match(r.st.agents.ia.error,/ANTHROPIC_API_KEY/);assert.equal(hits,0);
  assert.equal(r.st.agents.off.status,'desligado');assert.equal(r.st.agents.regras.status,'ok');
  r=await run({...t,fetchImpl,now:NOW+1000,env:{ANTHROPIC_API_KEY:'sk-teste'}});
  const ia=r.st.agents.ia;assert.equal(hits,1);assert.equal(ia.status,'ok');assert.equal(O.openTrades(ia).length,1);
  const tr=O.openTrades(ia)[0];assert.ok(tr.qty*tr.entry<=100*RULES.levMax+1e-6);assert.equal(ia.usage.inTok,100);
  assert.match(ia.decisions.slice(-1)[0].acoes[0].msg,/risco reduzido/);
  await run({...t,fetchImpl,now:NOW+2000,env:{ANTHROPIC_API_KEY:'sk-teste'}});
  assert.equal(hits,1); // mesma vela fechada: não chama a IA de novo
  const saved=JSON.parse(fs.readFileSync(t.statePath,'utf8'));assert.ok(!JSON.stringify(saved).includes('sk-teste'));
});

test('rodada: resposta ruim da IA vira erro registrado, sem ordem e sem derrubar a rodada; escritório desligado não chama IA',async()=>{
  const conf={...CONF,agentes:[{id:'ia',nome:'IA',provedor:'openai',ativo:true}]};
  const t=tmp(conf);let hits=0;
  const fetchImpl=(u)=>{if(String(u).includes('openai')){hits++;return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({choices:[{message:{content:'não sei'}}]})})}return fetchMarket(u)};
  let r=await run({...t,fetchImpl,now:NOW,env:{OPENAI_API_KEY:'k'}});
  assert.equal(r.st.agents.ia.status,'erro');assert.equal(r.st.agents.ia.trades.length,0);assert.equal(r.st.agents.ia.usage.errors,1);assert.equal(r.meta.net,'ok');
  const off=tmp({...conf,ligado:false});hits=0;
  r=await run({...off,fetchImpl,now:NOW,env:{OPENAI_API_KEY:'k'}});assert.equal(hits,0);assert.equal(r.st.agents.ia.status,'desligado');
});

test('rodada: configuração inválida não apaga o estado e aparece como erro',async()=>{
  const t=tmp(CONF);
  await run({...t,fetchImpl:fetchMarket,now:NOW,env:{}});
  fs.writeFileSync(t.configPath,'{ quebrado');
  const r=await run({...t,fetchImpl:fetchMarket,now:NOW+1,env:{}});
  assert.match(r.meta.configError,/inválido/);assert.equal(r.meta.runs,2);assert.ok(r.st.agents.ia);
});
