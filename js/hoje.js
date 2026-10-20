// Tela "Hoje": transforma o estado do robô em uma resposta simples (operar, esperar ou só simular),
// com tamanho de posição para o dinheiro do usuário. Puro, sem DOM.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./bot.js'),require('./data.js'));
  else root.RadarHoje=factory(root.RadarBot,root.RadarData);
})(typeof self!=='undefined'?self:this,function(Bot,D){
'use strict';

var H=3600000;
var LATE_UP=0.3,LATE_DOWN=-0.5; // em múltiplos da distância até o stop (R)

// Quanto comprar/vender com o dinheiro do usuário, arriscando riskPct do capital e respeitando a alavancagem máxima.
function sizeForUser(u,t){
  var dist=Math.abs(t.entry-t.stop);
  if(!(u.capital>0)||!(dist>0))return null;
  var riskWanted=u.capital*u.riskPct/100,qty=riskWanted/dist,notional=qty*t.entry,maxNotional=u.capital*u.maxLev,capped=notional>maxNotional;
  if(capped){notional=maxNotional;qty=notional/t.entry}
  var risk=qty*dist;
  return {qty:qty,notional:notional,riskUSD:risk,riskPct:risk/u.capital*100,lev:Math.max(1,notional/u.capital),capped:capped,
    rewardUSD:qty*Math.abs(t.target-t.entry),marginUSD:notional/Math.max(1,notional/u.capital)};
}

// O sinal ainda vale? Compara o preço de agora com o preço do sinal, em múltiplos do risco (R).
function entryStatus(t,price,now,tfMs){
  var long=t.side==='long',dist=t.dist0>0?t.dist0:Math.abs(t.entry-t.stop);
  var out={state:'valid',driftR:0,rr:NaN,ageMs:now-t.openedAt,lo:0,hi:0};
  var sgn=long?1:-1;
  out.lo=long?t.entry+LATE_DOWN*dist:t.entry-LATE_UP*dist;
  out.hi=long?t.entry+LATE_UP*dist:t.entry-LATE_DOWN*dist;
  if(!(price>0)){out.state='sem-preco';return out}
  out.driftR=(price-t.entry)*sgn/dist;
  var risk=Math.abs(price-t.stop),reward=Math.abs(t.target-price);
  out.rr=risk>0?reward/risk:NaN;
  if(long?price<=t.stop:price>=t.stop){out.state='stopped';return out}
  if(long?price>=t.target:price<=t.target){out.state='target';return out}
  if(t.moved||(t.mfe>0&&t.mfe>0.5*dist)){out.state='running';return out}
  if(out.ageMs>2*tfMs){out.state='old';return out}
  if(out.driftR>LATE_UP||out.driftR<LATE_DOWN)out.state='late';
  return out;
}

// Resposta do dia. prices: {SYM: preço ao vivo}. u: {capital, riskPct, maxLev} (capital em USDT, pode ser 0).
function advise(st,meta,prices,u,now){
  var tfMs=D.TFS[st.cfg.tf],rd=Bot.readiness(st,now),lastRun=meta&&meta.lastRun||0,staleMs=Math.max(3*H,3*tfMs);
  var signals=Bot.openTrades(st).map(function(t){
    var p=prices&&prices[t.sym]||st.prices[t.sym],es=entryStatus(t,p,now,tfMs);
    return {trade:t,price:p,status:es,size:u&&u.capital>0?sizeForUser(u,t):null};
  });
  var actionable=signals.filter(function(x){return x.status.state==='valid'});
  var dailyLoss=-Bot.dayPnl(st,now),dailyLimit=st.cfg.dailyPct/100*st.cfg.capital,hit=dailyLoss>=dailyLimit;
  var res={ready:rd.ready,rd:rd,signals:signals,actionable:actionable,stale:lastRun>0&&now-lastRun>staleMs,staleMs:now-lastRun,dailyHit:hit};
  if(!rd.ready){res.code='simular';res.reason='O robô ainda não provou a estratégia ('+rd.passed+' de '+rd.checks.length+' critérios). Acompanhe, mas não use dinheiro real.'}
  else if(res.stale){res.code='desatualizado';res.reason='O servidor não confere o mercado há muito tempo. Espere ele voltar antes de operar.'}
  else if(hit){res.code='parar';res.reason='O robô atingiu o limite de perda do dia. Quando isso acontece, o dia acaba.'}
  else if(actionable.length){res.code='oportunidade';res.reason=actionable.length===1?'Há um sinal dentro da janela de entrada.':'Há '+actionable.length+' sinais dentro da janela de entrada.'}
  else{res.code='esperar';res.reason='Nenhum sinal válido agora. Ficar de fora também é uma decisão.'}
  return res;
}

// Perda máxima aceitável para o capital do usuário (para ele mesmo parar).
function limits(capital,dailyPct,weeklyPct){return {daily:capital*dailyPct/100,weekly:capital*weeklyPct/100}}

// Texto do alerta (Telegram). Sempre deixa claro se ainda é simulação.
function alertText(ev,ready,fmt){
  var t=ev.trade,long=t.side==='long',dist=Math.abs(t.entry-t.stop),tag=ready?'(critérios do robô cumpridos; comece pequeno)':'(SIMULAÇÃO, não use dinheiro real)';
  var f=fmt||function(n){return String(n)};
  if(ev.type==='open'){
    var lo=long?t.entry+LATE_DOWN*dist:t.entry-LATE_UP*dist,hi=long?t.entry+LATE_UP*dist:t.entry-LATE_DOWN*dist;
    return (long?'🟢 COMPRAR ':'🔴 VENDER ')+t.sym+' '+tag+'\nEntrada perto de '+f(t.entry)+'\nStop '+f(t.stop)+'\nAlvo '+f(t.target)+
      '\nSó entre se o preço estiver entre '+f(Math.min(lo,hi))+' e '+f(Math.max(lo,hi))+'. Fora disso, espere o próximo sinal.'+(long?'':'\nVenda exige mercado de futuros; use margem isolada.');
  }
  return (t.reason==='Alvo'?'✅ Alvo em ':(t.reason==='Stop'?'🛑 Stop em ':'ℹ️ Encerrada em '))+t.sym+': '+(t.pnl>0?'+':'')+t.pnl.toFixed(2)+' USDT no robô '+tag;
}

return {sizeForUser:sizeForUser,entryStatus:entryStatus,advise:advise,limits:limits,alertText:alertText,LATE_UP:LATE_UP,LATE_DOWN:LATE_DOWN};
});
