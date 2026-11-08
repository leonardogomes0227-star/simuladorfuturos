// Escritório de IAs: cada IA tem uma conta simulada própria e opera no papel, com as MESMAS regras de risco.
// A IA só PROPÕE (abrir, fechar, ajustar, manter). Quem decide se a ordem passa é o gestor de risco, em código.
// Puro, sem DOM e sem rede: roda no servidor (server/run-office.js), no navegador (leitura) e nos testes.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine.js'),require('./data.js'),require('./radar.js'));
  else root.RadarOffice=factory(root.RadarEngine,root.RadarData,root.RadarRadar);
})(typeof self!=='undefined'?self:this,function(E,D,R){
'use strict';

var PROVIDERS=['regras','anthropic','openai','gemini','xai','deepseek'];
var RULE_RANGE={riskMaxPct:[0.1,5],levMax:[1,10],maxOpen:[1,5],dailyLossPct:[1,50],feePct:[0,0.5],slipPct:[0,1]};
var KEEP={decisions:30,curve:600,trades:2000};

function isNum(v){return typeof v==='number'&&isFinite(v)}
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function r2(v){return Math.round(v*100)/100}
function fmt(v){var a=Math.abs(v);return v.toFixed(a>=1000?2:(a>=10?3:(a>=1?4:6)))}
function dayKey(ms){var d=new Date(ms);return d.getUTCFullYear()*10000+(d.getUTCMonth()+1)*100+d.getUTCDate()}

function defaultRules(){return {riskMaxPct:2,levMax:5,maxOpen:2,dailyLossPct:10,feePct:0.05,slipPct:0.02}}

/* ---------- configuração (escritorio/config.json) ---------- */
// Devolve {error} ou a configuração já normalizada. Nunca lança.
function parseConfig(conf){
  if(!conf||typeof conf!=='object'||Array.isArray(conf))return {error:'escritorio/config.json não encontrado ou com JSON inválido.'};
  var tf=conf.intervalo==null?'15m':String(conf.intervalo);
  if(!D.TFS[tf])return {error:'"intervalo" inválido: '+tf+'. Use '+Object.keys(D.TFS).join(', ')+'.'};
  var syms=conf.moedas==null?['BTCUSDT','ETHUSDT','SOLUSDT']:conf.moedas;
  if(!Array.isArray(syms)||!syms.length||syms.length>10||!syms.every(D.validSymbol))return {error:'"moedas" deve ter de 1 a 10 símbolos como BTCUSDT.'};
  var capital=conf.capitalPorIA==null?100:Number(conf.capitalPorIA);
  if(!isFinite(capital)||capital<10||capital>1e6)return {error:'"capitalPorIA" deve ficar entre 10 e 1.000.000.'};
  var rules=defaultRules(),rc=conf.regras||{};
  var map={riscoMaxPct:'riskMaxPct',alavancagemMax:'levMax',maxPosicoes:'maxOpen',perdaDiariaMaxPct:'dailyLossPct',taxaPorLadoPct:'feePct',derrapagemPorLadoPct:'slipPct'};
  for(var k in map){
    if(rc[k]==null)continue;
    var v=Number(rc[k]),rg=RULE_RANGE[map[k]];
    if(!isFinite(v)||v<rg[0]||v>rg[1])return {error:'"regras.'+k+'" deve ficar entre '+rg[0]+' e '+rg[1]+'.'};
    rules[map[k]]=v;
  }
  rules.maxOpen=Math.round(rules.maxOpen);
  var list=conf.agentes==null?[]:conf.agentes;
  if(!Array.isArray(list)||list.length>10)return {error:'"agentes" deve ser uma lista com até 10 IAs.'};
  var seen={},agents=[];
  for(var i=0;i<list.length;i++){
    var a=list[i]||{},id=String(a.id||'');
    if(!/^[a-z0-9_-]{2,24}$/.test(id))return {error:'Agente #'+(i+1)+': "id" deve ter 2 a 24 letras minúsculas, números, - ou _.'};
    if(seen[id])return {error:'Agente "'+id+'" repetido.'};
    seen[id]=1;
    if(PROVIDERS.indexOf(a.provedor)<0)return {error:'Agente "'+id+'": "provedor" deve ser um destes: '+PROVIDERS.join(', ')+'.'};
    if(a.chaveEnv!=null&&!/^[A-Z][A-Z0-9_]{2,39}$/.test(String(a.chaveEnv)))return {error:'Agente "'+id+'": "chaveEnv" inválido.'};
    agents.push({id:id,name:String(a.nome||id).slice(0,40),provider:a.provedor,model:a.modelo?String(a.modelo).slice(0,80):'',
      style:a.estilo?String(a.estilo).slice(0,600):'',active:a.ativo===true,keyEnv:a.chaveEnv?String(a.chaveEnv):''});
  }
  return {on:conf.ligado!==false,tf:tf,syms:syms.slice(),capital:capital,rules:rules,agents:agents};
}

/* ---------- estado ---------- */
function newAgent(a,capital,now){
  return {id:a.id,name:a.name,provider:a.provider,model:a.model,capital:capital,startedAt:now,trades:[],decisions:[],curve:[],
    status:'novo',error:'',lastRun:0,decidedT:0,seen:{},usage:{calls:0,inTok:0,outTok:0,errors:0}};
}
function sanitizeTrade(t){
  if(!t||typeof t!=='object'||(t.status!=='open'&&t.status!=='closed')||(t.side!=='long'&&t.side!=='short'))return null;
  if(![t.entry,t.stop,t.target,t.qty,t.openedAt].every(isNum)||t.qty<=0||!D.validSymbol(t.sym))return null;
  if(t.status==='closed'&&![t.exit,t.pnl,t.closedAt].every(isNum))return null;
  var o={id:String(t.id||''),sym:t.sym,side:t.side,entry:t.entry,stop:t.stop,target:t.target,qty:t.qty,lev:isNum(t.lev)?t.lev:1,
    risk:isNum(t.risk)?t.risk:Math.abs(t.entry-t.stop)*t.qty,openedAt:t.openedAt,next:isNum(t.next)?t.next:t.openedAt,
    motive:String(t.motive||'').slice(0,300),status:t.status};
  if(t.status==='closed'){o.exit=t.exit;o.pnl=t.pnl;o.closedAt=t.closedAt;o.reason=String(t.reason||'')}
  return o;
}
function sanitizeAgent(raw,fallback){
  var a=fallback;
  if(!raw||typeof raw!=='object')return a;
  ['capital','startedAt','lastRun','decidedT'].forEach(function(k){if(isNum(raw[k])&&raw[k]>=0)a[k]=raw[k]});
  ['status','error'].forEach(function(k){if(typeof raw[k]==='string')a[k]=raw[k].slice(0,300)});
  if(Array.isArray(raw.trades))a.trades=raw.trades.map(sanitizeTrade).filter(Boolean).slice(-KEEP.trades);
  if(Array.isArray(raw.decisions))a.decisions=raw.decisions.filter(function(d){return d&&isNum(d.at)}).slice(-KEEP.decisions);
  if(Array.isArray(raw.curve))a.curve=raw.curve.filter(function(p){return p&&isNum(p.t)&&isNum(p.e)}).slice(-KEEP.curve);
  if(raw.seen&&typeof raw.seen==='object')Object.keys(raw.seen).forEach(function(k){if(D.validSymbol(k)&&isNum(raw.seen[k]))a.seen[k]=raw.seen[k]});
  if(raw.usage&&typeof raw.usage==='object')['calls','inTok','outTok','errors'].forEach(function(k){if(isNum(raw.usage[k])&&raw.usage[k]>=0)a.usage[k]=raw.usage[k]});
  return a;
}
function sanitize(raw){
  var st={version:1,agents:{}};
  if(!raw||typeof raw!=='object'||!raw.agents||typeof raw.agents!=='object')return st;
  Object.keys(raw.agents).slice(0,20).forEach(function(id){
    var r=raw.agents[id];
    if(!/^[a-z0-9_-]{2,24}$/.test(id)||!r||typeof r!=='object')return;
    var base=newAgent({id:id,name:String(r.name||id).slice(0,40),provider:PROVIDERS.indexOf(r.provider)>=0?r.provider:'regras',model:String(r.model||'').slice(0,80)},100,0);
    st.agents[id]=sanitizeAgent(r,base);
  });
  return st;
}
// Garante uma conta para cada IA da configuração. A conta existente mantém o capital inicial dela.
function sync(st,cfg,now){
  cfg.agents.forEach(function(a){
    var cur=st.agents[a.id];
    if(!cur)st.agents[a.id]=newAgent(a,cfg.capital,now);
    else{cur.name=a.name;cur.provider=a.provider;cur.model=a.model}
  });
  return st;
}

/* ---------- contas ---------- */
function closedTrades(a){return a.trades.filter(function(t){return t.status==='closed'})}
function openTrades(a){return a.trades.filter(function(t){return t.status==='open'})}
function realized(a){return closedTrades(a).reduce(function(s,t){return s+t.pnl},0)}
function balance(a){return a.capital+realized(a)}
function unrealized(t,price){return isNum(price)?(price-t.entry)*t.qty*(t.side==='long'?1:-1):0}
function equity(a,prices){return balance(a)+openTrades(a).reduce(function(s,t){return s+unrealized(t,prices&&prices[t.sym])},0)}
function dayPnl(a,ms){var k=dayKey(ms);return closedTrades(a).filter(function(t){return dayKey(t.closedAt)===k}).reduce(function(s,t){return s+t.pnl},0)}

function closeTrade(a,t,price,reason,at,rules){
  var long=t.side==='long',fee=rules.feePct/100;
  t.exit=price;t.status='closed';t.reason=reason;t.closedAt=at;
  t.pnl=(price-t.entry)*t.qty*(long?1:-1)-(t.entry+price)*t.qty*fee;
}
// Confere stop e alvo nas velas fechadas depois da última checagem. Se os dois caírem na mesma vela, vale o stop.
// candles: {BTCUSDT:[velas fechadas]}. Devolve os eventos de fechamento.
function markToMarket(a,candles,now,rules){
  var events=[],slip=rules.slipPct/100;
  openTrades(a).forEach(function(t){
    var cs=candles[t.sym]||[],long=t.side==='long';
    for(var i=0;i<cs.length;i++){
      var c=cs[i];
      if(c.t<t.next)continue;
      t.next=c.t+1;
      var hitStop=long?c.l<=t.stop:c.h>=t.stop,hitTarget=long?c.h>=t.target:c.l<=t.target;
      if(hitStop){closeTrade(a,t,long?t.stop*(1-slip):t.stop*(1+slip),'Stop',c.t,rules);events.push({type:'close',trade:t});break}
      if(hitTarget){closeTrade(a,t,t.target,'Alvo',c.t,rules);events.push({type:'close',trade:t});break}
    }
  });
  return events;
}

/* ---------- decisão da IA: leitura e validação ---------- */
var ACTIONS={abrir:'abrir',open:'abrir',fechar:'fechar',close:'fechar',manter:'manter',hold:'manter',ajustar:'ajustar',adjust:'ajustar'};
var SIDES={long:'long',compra:'long',comprar:'long',buy:'long',short:'short',venda:'short',vender:'short',sell:'short'};

// Acha o primeiro objeto JSON do texto (a IA pode devolver cerca de código ou explicação em volta).
function extractJson(text){
  var s=String(text||''),start=s.indexOf('{');
  while(start>=0){
    var depth=0,inStr=false,esc=false;
    for(var i=start;i<s.length;i++){
      var ch=s[i];
      if(inStr){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')inStr=false;continue}
      if(ch==='"')inStr=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){
        try{return JSON.parse(s.slice(start,i+1))}catch(e){break}
      }
    }
    start=s.indexOf('{',start+1);
  }
  return null;
}
function num(v){var n=typeof v==='string'?parseFloat(v.replace(',','.')):v;return isNum(n)?n:NaN}
// Devolve {ok, resumo, decisoes:[{acao, ativo, lado, stop, alvo, riscoPct, alavancagem, motivo}]} ou {ok:false, error}.
function parseDecision(text){
  var j=extractJson(text);
  if(!j||typeof j!=='object')return {ok:false,error:'A resposta não trouxe um JSON válido.'};
  var raw=Array.isArray(j.decisoes)?j.decisoes:(Array.isArray(j.decisions)?j.decisions:(j.acao?[j]:null));
  if(!raw)return {ok:false,error:'O JSON não tem a lista "decisoes".'};
  var out=[],bad=0;
  raw.slice(0,4).forEach(function(d){
    if(!d||typeof d!=='object'){bad++;return}
    var acao=ACTIONS[String(d.acao||d.action||'').toLowerCase()],ativo=String(d.ativo||d.symbol||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!acao){bad++;return}
    if(acao!=='manter'&&!D.validSymbol(ativo)){bad++;return}
    var o={acao:acao,ativo:ativo,lado:SIDES[String(d.lado||d.side||'').toLowerCase()]||'',stop:num(d.stop),alvo:num(d.alvo!=null?d.alvo:d.target),
      riscoPct:num(d.riscoPct!=null?d.riscoPct:d.risk_pct),alavancagem:num(d.alavancagem!=null?d.alavancagem:d.leverage),motivo:String(d.motivo||d.reason||'').slice(0,300)};
    out.push(o);
  });
  if(!out.length&&raw.length)return {ok:false,error:'Nenhuma decisão válida na resposta ('+bad+' descartada'+(bad>1?'s':'')+').'};
  return {ok:true,resumo:String(j.resumo||j.summary||'').slice(0,400),decisoes:out};
}

/* ---------- gestor de risco (código, não IA) ---------- */
// Avalia UMA decisão. Devolve {ok, msg, ...dados para aplicar}. Nada aqui depende da IA ter razão.
function riskCheck(a,d,ctx){
  var rules=ctx.rules,price=ctx.prices[d.ativo],open=openTrades(a),cur=open.filter(function(t){return t.sym===d.ativo})[0];
  function no(msg){return {ok:false,msg:msg}}
  if(d.acao==='manter')return {ok:true,msg:'mantém'};
  if(ctx.syms.indexOf(d.ativo)<0)return no('ativo fora da lista do escritório');
  if(!(price>0))return no('sem preço atual para '+d.ativo);
  if(d.acao==='fechar'){
    if(!cur)return no('não há posição aberta em '+d.ativo);
    return {ok:true,msg:'fechada a mercado',trade:cur,price:price};
  }
  if(d.acao==='ajustar'){
    if(!cur)return no('não há posição aberta em '+d.ativo);
    var long=cur.side==='long',upd={};
    if(isNum(d.stop)){
      if(long?!(d.stop>cur.stop&&d.stop<price):!(d.stop<cur.stop&&d.stop>price))return no('o stop só pode se aproximar do preço, sem cruzá-lo (nunca afrouxar)');
      upd.stop=d.stop;
    }
    if(isNum(d.alvo)){
      if(long?!(d.alvo>price):!(d.alvo<price))return no('alvo do lado errado do preço');
      upd.target=d.alvo;
    }
    if(!('stop' in upd)&&!('target' in upd))return no('nada para ajustar: informe "stop" e/ou "alvo"');
    return {ok:true,msg:'ajustada',trade:cur,upd:upd};
  }
  // abrir
  if(cur)return no('já existe posição em '+d.ativo);
  if(d.lado!=='long'&&d.lado!=='short')return no('"lado" deve ser long ou short');
  var isLong=d.lado==='long';
  if(!isNum(d.stop))return no('ordem sem stop é recusada');
  if(isLong?!(d.stop<price):!(d.stop>price))return no('stop do lado errado do preço');
  if(open.length>=rules.maxOpen)return no('limite de '+rules.maxOpen+' posições abertas');
  var eq=equity(a,ctx.prices);
  if(!(eq>0))return no('conta zerada');
  if(dayPnl(a,ctx.now)<=-a.capital*rules.dailyLossPct/100)return no('limite de perda do dia atingido ('+rules.dailyLossPct+'%): sem novas posições até amanhã (UTC)');
  var entry=isLong?price*(1+rules.slipPct/100):price*(1-rules.slipPct/100);
  var target=isNum(d.alvo)?d.alvo:(isLong?entry+2*(entry-d.stop):entry-2*(d.stop-entry)),notes=[];
  if(!isNum(d.alvo))notes.push('alvo definido em 2R');
  if(isLong?!(target>entry):!(target<entry))return no('alvo do lado errado do preço');
  var riskPct=isNum(d.riscoPct)&&d.riscoPct>0?d.riscoPct:1;
  if(riskPct>rules.riskMaxPct){notes.push('risco reduzido de '+riskPct+'% para '+rules.riskMaxPct+'%');riskPct=rules.riskMaxPct}
  var lev=isNum(d.alavancagem)&&d.alavancagem>=1?d.alavancagem:1;
  if(lev>rules.levMax){notes.push('alavancagem reduzida de '+lev+'x para '+rules.levMax+'x');lev=rules.levMax}
  var s=E.sizing(eq,riskPct,entry,d.stop,lev,rules.feePct);
  if(!(s.qty>0))return no('stop colado demais no preço');
  if(s.stopBeyondLiq)return no('stop além do preço de liquidação com '+lev+'x');
  var usedNotional=open.reduce(function(x,t){return x+t.qty*t.entry},0),room=eq*rules.levMax-usedNotional;
  var maxNotional=Math.min(eq*lev,room);
  if(!(maxNotional>0))return no('sem margem livre dentro da alavancagem máxima');
  var qty=s.qty;
  if(qty*entry>maxNotional){qty=maxNotional/entry;notes.push('tamanho reduzido para caber na alavancagem')}
  if(qty*entry<5)return no('posição pequena demais (menos de 5 USDT)');
  return {ok:true,msg:'aberta'+(notes.length?' ('+notes.join('; ')+')':''),open:{sym:d.ativo,side:d.lado,entry:entry,stop:d.stop,target:target,qty:qty,lev:lev,
    risk:Math.abs(entry-d.stop)*qty,motive:d.motivo}};
}

// Aplica as decisões na conta, passando cada uma pelo gestor de risco. Devolve os resultados e os eventos.
function applyDecisions(a,decisions,ctx){
  var results=[],events=[];
  decisions.forEach(function(d){
    var rc=riskCheck(a,d,ctx),res={acao:d.acao,ativo:d.ativo,ok:rc.ok,msg:rc.msg,motivo:d.motivo};
    if(rc.ok){
      if(d.acao==='fechar'){closeTrade(a,rc.trade,rc.price,'Fechada pela IA',ctx.now,ctx.rules);events.push({type:'close',trade:rc.trade})}
      else if(d.acao==='ajustar'){if('stop' in rc.upd)rc.trade.stop=rc.upd.stop;if('target' in rc.upd)rc.trade.target=rc.upd.target}
      else if(d.acao==='abrir'){
        var o=rc.open;
        var t={id:a.id+'-'+o.sym+'-'+ctx.now,sym:o.sym,side:o.side,entry:o.entry,stop:o.stop,target:o.target,qty:o.qty,lev:o.lev,risk:o.risk,
          openedAt:ctx.now,next:ctx.now,motive:o.motive,status:'open'};
        a.trades.push(t);events.push({type:'open',trade:t});
      }
    }
    results.push(res);
  });
  if(a.trades.length>KEEP.trades)a.trades=a.trades.slice(-KEEP.trades);
  return {results:results,events:events};
}

/* ---------- análise de mercado e briefing ---------- */
// data/dataHtf: velas cruas por moeda. Devolve {sym:{analysis, closes}} usando só velas fechadas.
function analyzeAll(cfg,data,dataHtf,now,params){
  var out={},mTf=D.macroTf(cfg.tf);
  cfg.syms.forEach(function(sym){
    if(!data[sym])return;
    var an=R.analyze({sym:sym,tf:cfg.tf,htfTf:mTf,base:data[sym],htf:dataHtf&&dataHtf[sym]||[],params:params,now:now});
    var cl=R.closedOnly(data[sym],D.TFS[cfg.tf],now);
    out[sym]={analysis:an,closed:cl};
  });
  return out;
}
function lineFor(sym,m,prices){
  var an=m.analysis,s=an.signal,cl=m.closed,n=cl.length,last=cl.slice(-8).map(function(c){return fmt(c.c)}).join(', ');
  var hi=-Infinity,lo=Infinity;cl.slice(-48).forEach(function(c){if(c.h>hi)hi=c.h;if(c.l<lo)lo=c.l});
  var parts=[sym+': preço '+fmt(prices[sym]),'fechamentos recentes ['+last+']','máx/mín 48 velas '+fmt(hi)+' / '+fmt(lo)];
  if(isNum(s.rsi))parts.push('RSI '+s.rsi.toFixed(0));
  if(isNum(s.adx))parts.push('ADX '+s.adx.toFixed(0));
  if(isNum(s.atr))parts.push('ATR '+fmt(s.atr));
  parts.push('regime '+s.regime);
  if(an.macro)parts.push('tendência maior ('+an.macro.tf+') '+(an.macro.bias===1?'alta':(an.macro.bias===-1?'baixa':'lateral')));
  parts.push('robô de regras: '+(s.dir==='wait'?'sem sinal':(s.dir==='long'?'COMPRA':'VENDA')+' (stop '+fmt(s.stop)+', alvo '+fmt(s.target)+')'));
  if(an.health&&an.health.stale)parts.push('ATENÇÃO: dados atrasados');
  return parts.join(' · ');
}
var SCHEMA='{"resumo":"uma frase com a leitura do mercado","decisoes":[{"acao":"abrir|fechar|ajustar|manter","ativo":"BTCUSDT","lado":"long|short","stop":0,"alvo":0,"riscoPct":1,"alavancagem":2,"motivo":"por que, em uma frase"}]}';
// Texto que a IA recebe. system = papel e regras; user = fotografia do mercado e da conta.
function briefing(a,agentCfg,ctx,markets){
  var rules=ctx.rules,open=openTrades(a),eq=equity(a,ctx.prices);
  var system='Você é "'+agentCfg.name+'", um trader de futuros perpétuos de cripto numa mesa de simulação (dinheiro de mentira, preços reais). '+
    'Seu objetivo é maximizar o saldo da SUA conta sem violar as regras. Preservar capital vale tanto quanto ganhar. Ficar de fora é uma decisão válida ("manter").\n'+
    (agentCfg.style?'Seu estilo: '+agentCfg.style+'\n':'')+
    'REGRAS DURAS (um gestor de risco em código recusa qualquer ordem que as viole): risco máximo por operação '+rules.riskMaxPct+'% da conta; alavancagem máxima '+rules.levMax+'x; '+
    'no máximo '+rules.maxOpen+' posições abertas, uma por ativo; toda ordem precisa de stop; perda diária máxima '+rules.dailyLossPct+'% do capital inicial; '+
    'stop só pode ser aproximado do preço (nunca afrouxado); taxas de '+rules.feePct+'% por lado.\n'+
    'Você decide uma vez por vela de '+ctx.tf+', olhando só velas FECHADAS. Responda APENAS com um JSON, sem texto fora dele, neste formato:\n'+SCHEMA+'\n'+
    'Use "abrir" com lado, stop e alvo; "fechar" com o ativo; "ajustar" com o ativo e novo stop e/ou alvo; "manter" quando não houver nada a fazer.';
  var lines=['Agora: '+new Date(ctx.now).toISOString()+' (UTC). Velas de '+ctx.tf+'.','','MERCADO'];
  ctx.syms.forEach(function(sym){if(markets[sym])lines.push('- '+lineFor(sym,markets[sym],ctx.prices))});
  lines.push('','SUA CONTA','Saldo atual (com posições abertas): '+eq.toFixed(2)+' USDT (inicial '+a.capital.toFixed(2)+'). Resultado do dia: '+dayPnl(a,ctx.now).toFixed(2)+' USDT.');
  if(!open.length)lines.push('Posições abertas: nenhuma.');
  else{lines.push('Posições abertas:');open.forEach(function(t){
    var u=unrealized(t,ctx.prices[t.sym]);
    lines.push('- '+t.sym+' '+(t.side==='long'?'COMPRADO':'VENDIDO')+' · entrada '+fmt(t.entry)+' · stop '+fmt(t.stop)+' · alvo '+fmt(t.target)+' · '+t.lev+'x · resultado agora '+u.toFixed(2)+' USDT');
  })}
  var recent=closedTrades(a).slice(-5);
  if(recent.length){lines.push('Últimas operações fechadas:');recent.forEach(function(t){lines.push('- '+t.sym+' '+t.side+' '+t.reason+' '+(t.pnl>=0?'+':'')+t.pnl.toFixed(2)+' USDT')})}
  return {system:system,user:lines.join('\n')};
}

// Agente de referência, sem IA: abre o sinal do robô de regras. Serve de régua para saber se as IAs agregam algo.
function rulesDecisions(a,markets,ctx){
  var out=[],seen=a.seen,open=openTrades(a);
  ctx.syms.forEach(function(sym){
    var m=markets[sym];if(!m)return;
    var an=m.analysis,s=an.signal;
    if(s.dir==='wait'||an.traffic.color!=='green'||!an.closedAt||seen[sym]===an.closedAt)return;
    seen[sym]=an.closedAt;
    if(open.some(function(t){return t.sym===sym}))return;
    out.push({acao:'abrir',ativo:sym,lado:s.dir,stop:s.stop,alvo:s.target,riscoPct:1,alavancagem:2,motivo:s.reasons.slice(0,3).join('; ')});
  });
  return {ok:true,resumo:out.length?'Sinal do robô de regras em '+out.map(function(d){return d.ativo}).join(', ')+'.':'Sem sinal pronto.',decisoes:out};
}

/* ---------- placar ---------- */
function stats(a,prices,now){
  var eq=equity(a,prices),cl=closedTrades(a),wins=cl.filter(function(t){return t.pnl>0}).length,peak=a.capital,dd=0,bal=a.capital;
  cl.slice().sort(function(x,y){return x.closedAt-y.closedAt}).forEach(function(t){bal+=t.pnl;if(bal>peak)peak=bal;if(peak>0)dd=Math.max(dd,(peak-bal)/peak*100)});
  return {id:a.id,name:a.name,provider:a.provider,model:a.model,status:a.status,equity:eq,pnl:eq-a.capital,pnlPct:(eq/a.capital-1)*100,
    trades:cl.length,open:openTrades(a).length,winRate:cl.length?wins/cl.length*100:0,maxDD:dd,today:dayPnl(a,now||Date.now()),error:a.error};
}
function leaderboard(st,prices,now){
  return Object.keys(st.agents).map(function(id){return stats(st.agents[id],prices,now)}).sort(function(x,y){return y.pnlPct-x.pnlPct});
}

return {PROVIDERS:PROVIDERS,RULE_RANGE:RULE_RANGE,defaultRules:defaultRules,parseConfig:parseConfig,newAgent:newAgent,sanitize:sanitize,sync:sync,
  closedTrades:closedTrades,openTrades:openTrades,balance:balance,equity:equity,dayPnl:dayPnl,unrealized:unrealized,markToMarket:markToMarket,
  extractJson:extractJson,parseDecision:parseDecision,riskCheck:riskCheck,applyDecisions:applyDecisions,analyzeAll:analyzeAll,briefing:briefing,
  rulesDecisions:rulesDecisions,stats:stats,leaderboard:leaderboard,r2:r2,KEEP:KEEP};
});
