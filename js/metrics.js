// Métricas de desempenho do diário, exportação e limites de risco. Funções puras, sem DOM.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RadarMetrics=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

function sortedClosed(trades){
  return trades.filter(function(t){return t.status==='closed'}).slice().sort(function(a,b){return a.closedAt-b.closedAt});
}
function summarize(trades,capital){
  var cl=sortedClosed(trades),n=cl.length;
  var wins=cl.filter(function(t){return t.pnl>0}),loss=cl.filter(function(t){return t.pnl<=0});
  var gw=wins.reduce(function(a,t){return a+t.pnl},0),gl=-loss.reduce(function(a,t){return a+t.pnl},0),total=gw-gl;
  var avgWin=wins.length?gw/wins.length:0,avgLoss=loss.length?gl/loss.length:0,wr=n?wins.length/n:0;
  var bal=capital,peak=capital,dd=0,ddPct=0,curve=[capital],mw=0,ml=0,cw=0,cL=0;
  cl.forEach(function(t){
    bal+=t.pnl;curve.push(bal);if(bal>peak)peak=bal;
    var d=peak-bal;if(d>dd){dd=d;ddPct=peak>0?d/peak*100:0}
    if(t.pnl>0){cw++;cL=0;if(cw>mw)mw=cw}else{cL++;cw=0;if(cL>ml)ml=cL}
  });
  var withR=cl.filter(function(t){return t.risk>0}),avgR=withR.length?withR.reduce(function(a,t){return a+t.pnl/t.risk},0)/withR.length:NaN;
  return {n:n,wins:wins.length,losses:loss.length,winRate:wr*100,total:total,avg:n?total/n:0,avgWin:avgWin,avgLoss:avgLoss,
    expectancy:wr*avgWin-(1-wr)*avgLoss,pf:gl>0?gw/gl:(gw>0?Infinity:0),
    best:n?Math.max.apply(null,cl.map(function(t){return t.pnl})):0,worst:n?Math.min.apply(null,cl.map(function(t){return t.pnl})):0,
    maxDD:dd,maxDDPct:ddPct,maxWinStreak:mw,maxLossStreak:ml,avgR:avgR,curve:curve};
}
function groupBy(trades,keyFn){
  var map={},order=[];
  sortedClosed(trades).forEach(function(t){
    var ks=keyFn(t);if(!Array.isArray(ks))ks=[ks];
    ks.forEach(function(k){
      if(k==null||k==='')return;
      if(!map[k]){map[k]={key:k,n:0,wins:0,pnl:0};order.push(k)}
      var g=map[k];g.n++;g.pnl+=t.pnl;if(t.pnl>0)g.wins++;
    });
  });
  return order.map(function(k){var g=map[k];g.winRate=g.n?g.wins/g.n*100:0;g.avg=g.n?g.pnl/g.n:0;return g});
}
var WEEK=['dom','seg','ter','qua','qui','sex','sáb'];
var by={
  side:function(t){return t.side==='long'?'Compra':'Venda'},
  reason:function(t){return t.reason},
  sym:function(t){return t.sym},
  tag:function(t){return t.tags||[]},
  hour:function(t){var h=new Date(t.openedAt).getHours();return String(h).padStart(2,'0')+'h'},
  weekday:function(t){return WEEK[new Date(t.openedAt).getDay()]}
};
function lossStreak(trades){
  var cl=sortedClosed(trades),n=0;
  for(var i=cl.length-1;i>=0;i--){if(cl[i].pnl<=0)n++;else break}
  return {count:n,lastAt:cl.length?cl[cl.length-1].closedAt:0};
}
function pnlSince(trades,since){
  return trades.filter(function(t){return t.status==='closed'&&t.closedAt>=since}).reduce(function(a,t){return a+t.pnl},0);
}
function startOfDay(ms){var d=new Date(ms);d.setHours(0,0,0,0);return d.getTime()}
function startOfWeek(ms){var d=new Date(ms);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d.getTime()}

// Exposição das operações abertas: valor, margem, risco até o stop e alertas de concentração.
function exposure(open,bal){
  var notional=0,margin=0,risk=0,sides={long:{},short:{}};
  open.forEach(function(t){
    notional+=t.qty*t.entry;margin+=t.qty*t.entry/(t.lev||1);risk+=t.risk||Math.abs(t.entry-t.stop)*t.qty;
    sides[t.side][t.sym]=true;
  });
  var corr=[];
  ['long','short'].forEach(function(s){var syms=Object.keys(sides[s]);if(syms.length>1)corr.push({side:s,syms:syms})});
  return {notional:notional,margin:margin,risk:risk,leverage:bal>0?notional/bal:0,marginPct:bal>0?margin/bal*100:0,riskPct:bal>0?risk/bal*100:0,corr:corr};
}

function csvCell(v){
  if(v==null)return '';
  var s=String(v);
  return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function toCSV(trades){
  var head=['id','ativo','modo','lado','abertura','fechamento','entrada','saida','stop','alvo','quantidade','alavancagem','risco_usdt','resultado_usdt','resultado_R','saida_por','tags','motivo_entrada','nota_pos_trade'];
  var rows=sortedClosed(trades).map(function(t){
    return [t.id,t.sym,t.mode,t.side==='long'?'compra':'venda',new Date(t.openedAt).toISOString(),new Date(t.closedAt).toISOString(),
      t.entry,t.exit,t.stop,t.target,t.qty,t.lev,t.risk,t.pnl,t.risk>0?(t.pnl/t.risk).toFixed(3):'',t.reason,(t.tags||[]).join('|'),t.note,t.review].map(csvCell).join(',');
  });
  return [head.join(',')].concat(rows).join('\n')+'\n';
}
function parseTags(s){
  var seen={};
  return String(s||'').split(/[,;]/).map(function(x){return x.trim().toLowerCase().slice(0,24)}).filter(function(x){if(!x||seen[x])return false;seen[x]=1;return true}).slice(0,6);
}

return {summarize:summarize,groupBy:groupBy,by:by,lossStreak:lossStreak,pnlSince:pnlSince,startOfDay:startOfDay,startOfWeek:startOfWeek,
  exposure:exposure,toCSV:toCSV,parseTags:parseTags};
});
