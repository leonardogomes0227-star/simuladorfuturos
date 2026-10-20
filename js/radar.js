// Radar: junta o intervalo base com o intervalo maior, usa SÓ velas fechadas e devolve o semáforo de cada moeda.
// Verde = pronto para operar; amarelo = mercado lateral ou atenção; vermelho = fora dos critérios.
// Sem DOM: roda no navegador, no servidor e nos testes.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine.js'),require('./data.js'));
  else root.RadarRadar=factory(root.RadarEngine,root.RadarData);
})(typeof self!=='undefined'?self:this,function(E,D){
'use strict';

function closedOnly(cs,tfMs,now){
  var n=cs.length;
  while(n>0&&cs[n-1].t+tfMs>now)n--;
  return n===cs.length?cs:cs.slice(0,n);
}
// Quando fecha a vela atual: a partir da última vela conhecida, sem depender do alinhamento do relógio.
function nextClose(cs,tfMs,now){
  if(!cs||!cs.length)return now+tfMs;
  var last=cs[cs.length-1].t;
  return last+tfMs*Math.max(1,Math.ceil((now-last)/tfMs));
}
function check(sig,id){for(var i=0;i<sig.checks.length;i++)if(sig.checks[i].id===id)return sig.checks[i];return null}
function pt(n,d){return n.toFixed(d==null?0:d).replace('.',',')}

// Traduz o resultado do motor + a saúde dos dados em verde, amarelo ou vermelho, com a razão em uma frase.
function semaphore(sig,P,hBase,hMacro){
  function mk(color,title,reason){return {color:color,title:title,reason:reason}}
  if(hBase&&hBase.stale)return mk('red','Dados desatualizados','Os dados da Binance estão atrasados ('+hBase.reason+'). Espere normalizar antes de confiar em qualquer sinal.');
  if(P.htf>0&&hMacro&&hMacro.stale)return mk('red','Dados do intervalo maior atrasados','Não consegui dados recentes para confirmar a tendência maior. Por segurança, sem sinal.');
  if(!sig.checks.length)return mk('yellow','Poucos dados','Ainda há poucas velas para analisar este ativo com segurança.');
  if(sig.dir!=='wait')return mk('green','Pronto para operar','Todos os critérios de segurança passaram na última vela fechada'+(hBase&&hBase.gaps?', mas há buracos nos dados recentes: confira o preço':'')+'.');
  var adx=check(sig,'adx'),macro=check(sig,'macro'),rsi=check(sig,'rsi'),strong=Math.abs(sig.score)>=P.minScore;
  if(!adx.ok)return mk('yellow','Mercado lateral','A força da tendência está baixa ('+adx.detail+'). Em mercado travado os sinais costumam ser falsos, então o robô espera.');
  if(strong&&macro&&!macro.ok)return mk('red','Contra a tendência maior','O gráfico menor sugere '+(sig.score>0?'compra':'venda')+', mas a tendência maior está '+(sig.htfBias===1?'em alta':(sig.htfBias===-1?'em baixa':'lateral'))+'. Operar contra ela é arriscado.');
  if(strong&&!rsi.ok)return mk('yellow','Atenção: preço esticado','O movimento já foi longe ('+rsi.detail+'). Entrar agora seria tarde; espere um recuo.');
  if(Math.abs(sig.score)>=P.minScore-1&&sig.score!==0)return mk('yellow','Atenção: quase lá','Faltou pouco para os critérios fecharem ('+Math.abs(sig.score)+' de '+P.minScore+' pontos). Vale acompanhar a próxima vela.');
  return mk('red','Fora dos critérios','Sem alinhamento suficiente entre tendência, força e volume. Ficar de fora também é uma decisão.');
}

// Análise de uma moeda. base/htf: velas cruas da Binance (a última pode estar em formação, e é ignorada no cálculo).
function analyze(o){
  var P=E.normParams(o.params),tfMs=o.tfMs||D.TFS[o.tf],hMs=o.htfMs||(o.htfTf?D.TFS[o.htfTf]:0),now=o.now||Date.now();
  var base=o.base||[],htf=o.htf||[];
  var hBase=D.dataHealth(base,tfMs,now),hMacro=P.htf>0?D.dataHealth(htf,hMs,now):null;
  var closed=closedOnly(base,tfMs,now),closedH=hMs?closedOnly(htf,hMs,now):[];
  var ind=E.computeIndicators(closed,P,closedH),i=closed.length-1;
  var sig=i>=0?E.signalAt(closed,ind,i,P):{dir:'wait',score:0,reasons:[],blockers:['Sem velas'],checks:[]};
  // tendência do intervalo maior, sempre informada (mesmo com o filtro desligado), para a tela mostrar o contexto
  var macro=null;
  if(closedH.length>2&&closed.length){
    var bs=E.htfBiasSeries(closed,closedH);
    if(!bs.missing){var bb=bs.bias[closed.length-1];macro={tf:o.htfTf||bs.name,bias:isFinite(bb)?bb:null,adx:isFinite(bs.adx[closed.length-1])?bs.adx[closed.length-1]:null}}
  }
  var last=base.length?base[base.length-1]:null;
  return {sym:o.sym,macro:macro,tf:o.tf,htfTf:o.htfTf||null,signal:sig,traffic:semaphore(sig,P,hBase,hMacro),
    health:hBase,healthMacro:hMacro,price:last?last.c:null,
    closedAt:i>=0?closed[i].t+tfMs:null,nextCloseAt:nextClose(base,tfMs,now),onlyClosed:true};
}
// Resumo para o semáforo geral da tela: o melhor cenário entre as moedas.
function summary(list){
  var by={green:[],yellow:[],red:[]};
  list.forEach(function(a){by[a.traffic.color].push(a)});
  var color=by.green.length?'green':(by.yellow.length?'yellow':'red');
  var title={green:'Pronto para operar',yellow:'Mercado lateral ou atenção',red:'Fora dos critérios'}[color];
  var n=list.length,text;
  if(!n)text='Aguardando a análise das moedas.';
  else if(color==='green')text=by.green.map(function(a){return a.sym.replace(/USDT$/,'')}).join(', ')+' com todos os critérios de segurança aprovados.';
  else if(color==='yellow')text=by.yellow.length+' de '+n+' moeda'+(n>1?'s':'')+' em mercado lateral ou pedindo atenção. Nenhuma pronta ainda.';
  else text='Nenhuma das '+n+' moeda'+(n>1?'s':'')+' atende os critérios agora. Esperar é o melhor movimento.';
  return {color:color,title:title,text:text,counts:{green:by.green.length,yellow:by.yellow.length,red:by.red.length}};
}
// Frase de contagem regressiva até a vela fechar, para a tela mostrar "só depois do fechamento".
function countdown(ms){
  if(!(ms>0))return 'agora';
  var s=Math.round(ms/1000);
  if(s<60)return s+' s';
  var m=Math.floor(s/60);if(m<60)return m+' min';
  var h=Math.floor(m/60),r=m%60;if(h<48)return h+' h'+(r?' '+r+' min':'');
  return Math.round(h/24)+' dias';
}

return {closedOnly:closedOnly,nextClose:nextClose,semaphore:semaphore,analyze:analyze,summary:summary,countdown:countdown};
});
