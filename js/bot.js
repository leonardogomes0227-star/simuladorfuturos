// Robô de simulação: opera sozinho no papel, vela a vela, com a mesma regra do sinal.
// Puro e determinístico: a mesma série de velas dá sempre as mesmas operações, seja em tempo real
// ou ao recuperar o que passou enquanto a aba estava fechada.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine.js'),require('./metrics.js'),require('./data.js'));
  else root.RadarBot=factory(root.RadarEngine,root.RadarMetrics,root.RadarData);
})(typeof self!=='undefined'?self:this,function(E,M,D){
'use strict';

var DAY=86400000;
var CFG_RANGE={capital:[10,1e7],riskPct:[0.1,5],lev:[1,20],maxOpen:[1,10],dailyPct:[0.5,20],feePct:[0,0.5],slipPct:[0,1]};

function defaults(){
  return {cfg:{capital:1000,riskPct:1,lev:3,maxOpen:3,dailyPct:3,feePct:0.05,slipPct:0.02,tf:'15m',syms:['BTCUSDT','ETHUSDT','SOLUSDT'],presetId:'padrao',notify:false},
    params:E.normParams(E.PRESETS.padrao.p),running:false,startedAt:0,lastRun:0,cursor:{},prices:{},trades:[],gaps:0,log:[]};
}
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function isNum(v){return typeof v==='number'&&isFinite(v)}

function sanitizeTrade(t){
  if(!t||typeof t!=='object'||(t.status!=='open'&&t.status!=='closed')||(t.side!=='long'&&t.side!=='short'))return null;
  if(![t.entry,t.stop,t.target,t.qty,t.openT,t.openedAt].every(isNum)||t.qty<=0||!D.validSymbol(t.sym))return null;
  if(t.status==='closed'&&![t.exit,t.pnl,t.closedAt].every(isNum))return null;
  var o={id:String(t.id||''),sym:t.sym,side:t.side,entry:t.entry,stop:t.stop,target:t.target,qty:t.qty,lev:isNum(t.lev)?t.lev:1,
    risk:isNum(t.risk)?t.risk:Math.abs(t.entry-t.stop)*t.qty,openedAt:t.openedAt,openT:t.openT,score:isNum(t.score)?t.score:0,
    reasons:Array.isArray(t.reasons)?t.reasons.map(String).slice(0,8):[],status:t.status};
  if(t.status==='closed'){o.exit=t.exit;o.pnl=t.pnl;o.closedAt=t.closedAt;o.reason=String(t.reason||'')}
  return o;
}
// Reconstrói o estado salvo, descartando o que estiver inválido.
function sanitize(raw){
  var st=defaults();
  if(!raw||typeof raw!=='object')return st;
  var c=raw.cfg||{};
  Object.keys(CFG_RANGE).forEach(function(k){var v=parseFloat(c[k]);if(isFinite(v))st.cfg[k]=clamp(v,CFG_RANGE[k][0],CFG_RANGE[k][1])});
  st.cfg.maxOpen=Math.round(st.cfg.maxOpen);
  if(D.TFS[c.tf])st.cfg.tf=c.tf;
  if(Array.isArray(c.syms)){var seen={};st.cfg.syms=c.syms.filter(function(s){if(!D.validSymbol(s)||seen[s])return false;seen[s]=1;return true}).slice(0,10)}
  if(!st.cfg.syms.length)st.cfg.syms=['BTCUSDT'];
  if(typeof c.presetId==='string')st.cfg.presetId=c.presetId.slice(0,40);
  st.cfg.notify=!!c.notify;
  if(raw.params)st.params=E.normParams(raw.params);
  st.running=!!raw.running;
  ['startedAt','lastRun','gaps'].forEach(function(k){if(isNum(raw[k])&&raw[k]>=0)st[k]=raw[k]});
  if(raw.cursor&&typeof raw.cursor==='object')Object.keys(raw.cursor).forEach(function(k){if(D.validSymbol(k)&&isNum(raw.cursor[k]))st.cursor[k]=raw.cursor[k]});
  if(raw.prices&&typeof raw.prices==='object')Object.keys(raw.prices).forEach(function(k){if(D.validSymbol(k)&&isNum(raw.prices[k])&&raw.prices[k]>0)st.prices[k]=raw.prices[k]});
  if(Array.isArray(raw.trades))st.trades=raw.trades.map(sanitizeTrade).filter(Boolean).slice(-3000);
  if(Array.isArray(raw.log))st.log=raw.log.map(String).slice(-40);
  return st;
}

function closedOnly(cs,tfMs,now){var n=cs.length;return n&&cs[n-1].t+tfMs>now?cs.slice(0,n-1):cs}
function dayKey(ms){var d=new Date(ms);return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate()}
function closedTrades(st){return st.trades.filter(function(t){return t.status==='closed'})}
function openTrades(st){return st.trades.filter(function(t){return t.status==='open'})}
function balance(st){return st.cfg.capital+closedTrades(st).reduce(function(a,t){return a+t.pnl},0)}
function dayPnl(st,ms){var k=dayKey(ms);return closedTrades(st).filter(function(t){return dayKey(t.closedAt)===k}).reduce(function(a,t){return a+t.pnl},0)}
function pushLog(st,msg){st.log.push(msg);if(st.log.length>40)st.log.shift()}

function closeTrade(st,t,price,reason,at){
  var long=t.side==='long',fee=st.cfg.feePct/100;
  t.exit=price;t.status='closed';t.reason=reason;t.closedAt=at;
  t.pnl=(price-t.entry)*t.qty*(long?1:-1)-(t.entry+price)*t.qty*fee;
}
function nextId(st,sym,t){return sym+'-'+t+'-'+st.trades.length}

// Processa as velas fechadas novas de cada ativo, em ordem cronológica.
// data: {BTCUSDT:[velas...]}. Devolve os eventos {type:'open'|'close',trade}.
function step(st,data,now){
  var tfMs=D.TFS[st.cfg.tf],events=[],queue=[],slip=st.cfg.slipPct/100,ctx={};
  st.cfg.syms.forEach(function(sym,order){
    var raw=data[sym];if(!raw||!raw.length)return;
    var cs=closedOnly(raw,tfMs,now);if(!cs.length)return;
    var last=cs[cs.length-1];
    if(st.cursor[sym]==null){st.cursor[sym]=last.t;return}
    var s=0;while(s<cs.length&&cs[s].t<=st.cursor[sym])s++;
    if(s===0&&cs[0].t>st.cursor[sym]+tfMs){st.gaps++;pushLog(st,sym+': faltou histórico entre as checagens, algumas velas não foram analisadas')}
    if(s>=cs.length)return;
    ctx[sym]={cs:cs,ind:E.computeIndicators(cs,st.params)};
    for(var i=s;i<cs.length;i++)queue.push({t:cs[i].t,sym:sym,i:i,order:order});
  });
  queue.sort(function(a,b){return a.t-b.t||a.order-b.order});
  queue.forEach(function(ev){
    var c=ctx[ev.sym],cand=c.cs[ev.i],at=cand.t+tfMs,open=null;
    st.trades.forEach(function(t){if(t.status==='open'&&t.sym===ev.sym)open=t});
    if(open){
      var long=open.side==='long',hitS=long?cand.l<=open.stop:cand.h>=open.stop,hitT=long?cand.h>=open.target:cand.l<=open.target;
      if(hitS){closeTrade(st,open,long?open.stop*(1-slip):open.stop*(1+slip),'Stop',at);events.push({type:'close',trade:open})}
      else if(hitT){closeTrade(st,open,open.target,'Alvo',at);events.push({type:'close',trade:open})}
    }else{
      var sig=E.signalAt(c.cs,c.ind,ev.i,st.params);
      if(sig.dir!=='wait'&&openTrades(st).length<st.cfg.maxOpen&&dayPnl(st,at)>-st.cfg.dailyPct/100*st.cfg.capital){
        var bal=balance(st),long2=sig.dir==='long',entry=long2?sig.entry*(1+slip):sig.entry*(1-slip),dist=Math.abs(entry-sig.stop);
        var qty=dist>0?bal*st.cfg.riskPct/100/dist:0;
        qty=Math.min(qty,bal*st.cfg.lev/entry);
        if(qty>0&&bal>0){
          var t={id:nextId(st,ev.sym,cand.t),sym:ev.sym,side:sig.dir,entry:entry,stop:sig.stop,target:sig.target,qty:qty,lev:st.cfg.lev,risk:qty*dist,
            openedAt:at,openT:cand.t,score:sig.score,reasons:sig.reasons.slice(0,8),status:'open'};
          st.trades.push(t);events.push({type:'open',trade:t});
        }
      }
    }
    st.cursor[ev.sym]=cand.t;
  });
  st.lastRun=now;
  return events;
}

// Encerra tudo ao último preço conhecido (com a taxa, sem derrapagem de stop).
function closeAll(st,prices,now){
  var out=[];
  openTrades(st).forEach(function(t){
    var p=prices[t.sym]||st.prices[t.sym];if(!(p>0))return;
    closeTrade(st,t,p,'Manual',now);out.push(t);
  });
  return out;
}
function unrealized(st,t){
  var p=st.prices[t.sym];if(!(p>0))return NaN;
  return (p-t.entry)*t.qty*(t.side==='long'?1:-1);
}

// Junta backtests de vários ativos numa linha só.
function aggregate(results){
  var rs=[];results.forEach(function(r){r.trades.forEach(function(t){rs.push(t.R)})});
  var wins=rs.filter(function(x){return x>0}),gw=wins.reduce(function(a,b){return a+b},0),gl=-rs.filter(function(x){return x<=0}).reduce(function(a,b){return a+b},0);
  return {n:rs.length,wins:wins.length,winRate:rs.length?wins.length/rs.length*100:0,totalR:gw-gl,avgR:rs.length?(gw-gl)/rs.length:0,pf:gl>0?gw/gl:(gw>0?Infinity:0)};
}

// Placar de prontidão: o que o histórico do robô precisa mostrar antes de alguém pensar em dinheiro real.
function readiness(st,now){
  var sm=M.summarize(st.trades,st.cfg.capital),days=st.startedAt?(now-st.startedAt)/DAY:0;
  var pf=sm.pf===Infinity?'sem perdas':sm.pf.toFixed(2).replace('.',','),c2=function(n){return n.toFixed(2).replace('.',',')};
  var checks=[
    {ok:days>=14,label:'Rodou por 14 dias ou mais',detail:Math.floor(days)+' dias'},
    {ok:sm.n>=30,label:'Pelo menos 30 operações fechadas',detail:sm.n+' operações'},
    {ok:sm.n>0&&sm.total>0,label:'Resultado positivo depois das taxas',detail:sm.n?(sm.total>0?'+':'')+c2(sm.total)+' USDT':'sem operações'},
    {ok:sm.n>0&&sm.pf>=1.3,label:'Fator de lucro de 1,3 ou mais',detail:sm.n?pf:'sem operações'},
    {ok:sm.n>0&&sm.maxDDPct<=20,label:'Maior queda de até 20%',detail:sm.n?sm.maxDDPct.toFixed(1).replace('.',',')+'%':'sem operações'},
    {ok:st.gaps===0,label:'Sem buracos de dados',detail:st.gaps?st.gaps+' ocorrência(s)':'nenhum'}
  ];
  var passed=checks.filter(function(c){return c.ok}).length;
  return {checks:checks,passed:passed,ready:passed===checks.length};
}

return {CFG_RANGE:CFG_RANGE,defaults:defaults,sanitize:sanitize,step:step,closeAll:closeAll,unrealized:unrealized,aggregate:aggregate,readiness:readiness,
  balance:balance,openTrades:openTrades,closedTrades:closedTrades,dayPnl:dayPnl,closedOnly:closedOnly};
});
