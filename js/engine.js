// Motor do Radar de Futuros: indicadores, sinal, dimensionamento, backtest e leitura de CSV.
// Sem acesso ao DOM, para rodar no navegador e nos testes em Node.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RadarEngine=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

var MMR=0.5; // margem de manutenção aproximada, em %, usada na liquidação

// Recursos novos ficam desligados (0) por padrão, então a estratégia clássica continua igual:
// trendP: EMA longa de tendência (só opera a favor dela); beR: leva o stop para a entrada após esse lucro em R;
// trailAtr: stop que persegue o preço a essa distância em ATR; maxBars: sai por tempo; atrMinPct/atrMaxPct: filtro de volatilidade;
// cooldown: velas de pausa depois de uma operação perdedora; htf: só opera a favor da tendência do intervalo maior (15m confirma com 4h, 4h com 1d...).
var DEFAULTS={emaF:9,emaM:21,emaS:50,adxMin:20,minScore:4,stopAtr:1.5,rr:2,trendP:0,beR:0,trailAtr:0,maxBars:0,atrMinPct:0,atrMaxPct:0,cooldown:0,htf:0};
var PRESETS={
  padrao:{name:'Padrão',p:{emaF:9,emaM:21,emaS:50,adxMin:20,minScore:4,stopAtr:1.5,rr:2}},
  conservadora:{name:'Conservadora',p:{emaF:9,emaM:21,emaS:50,adxMin:25,minScore:5,stopAtr:1.5,rr:2}},
  agressiva:{name:'Agressiva',p:{emaF:9,emaM:21,emaS:50,adxMin:15,minScore:3,stopAtr:1.2,rr:1.5}},
  lenta:{name:'Tendência lenta',p:{emaF:20,emaM:50,emaS:100,adxMin:20,minScore:4,stopAtr:2,rr:2.5}}
};

function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function normParams(p){
  p=p||{};
  var o={},k;for(k in DEFAULTS){var v=parseFloat(p[k]);o[k]=isFinite(v)?v:DEFAULTS[k]}
  o.emaF=Math.round(clamp(o.emaF,3,50));
  o.emaM=Math.round(clamp(o.emaM,5,100));if(o.emaM<=o.emaF)o.emaM=o.emaF+1;
  o.emaS=Math.round(clamp(o.emaS,10,300));if(o.emaS<=o.emaM)o.emaS=o.emaM+1;
  o.adxMin=clamp(o.adxMin,0,50);
  o.minScore=Math.round(clamp(o.minScore,3,6));
  o.stopAtr=clamp(o.stopAtr,0.5,5);
  o.rr=clamp(o.rr,0.5,6);
  o.trendP=o.trendP>0?Math.round(clamp(o.trendP,50,400)):0;
  o.beR=o.beR>0?clamp(o.beR,0.3,3):0;
  o.trailAtr=o.trailAtr>0?clamp(o.trailAtr,1,6):0;
  o.maxBars=o.maxBars>0?Math.round(clamp(o.maxBars,4,500)):0;
  o.atrMinPct=o.atrMinPct>0?clamp(o.atrMinPct,0.05,5):0;
  o.atrMaxPct=o.atrMaxPct>0?clamp(Math.max(o.atrMaxPct,o.atrMinPct),0.1,20):0;
  o.cooldown=o.cooldown>0?Math.round(clamp(o.cooldown,1,50)):0;
  o.htf=o.htf>0?1:0;
  return o;
}

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function genCandles(seed,base,vol,n){
  var r=mulberry32(seed),price=base,out=[],drift=0,left=0,t0=Date.UTC(2026,5,1);
  for(var i=0;i<n;i++){
    if(left<=0){var m=r();drift=m<0.38?0.0006+r()*0.0008:m<0.76?-(0.0006+r()*0.0008):(r()-0.5)*0.0002;left=40+Math.floor(r()*60);}
    left--;
    var v=vol*(0.7+r()*0.8),ret=drift+(r()+r()+r()-1.5)*v,o=price,c=o*(1+ret);
    var h=Math.max(o,c)*(1+r()*v*0.6),l=Math.min(o,c)*(1-r()*v*0.6);
    var vo=(500+r()*500)*(1+Math.abs(ret)/v*0.8);
    out.push({t:t0+i*900000,o:o,h:h,l:l,c:c,v:vo});price=c;
  }
  return out;
}
function nanArr(n){var a=new Array(n);for(var i=0;i<n;i++)a[i]=NaN;return a}
function ema(v,p){
  var out=nanArr(v.length),k=2/(p+1),prev=0;
  for(var i=0;i<v.length;i++){
    if(i===p-1){var s=0;for(var j=0;j<p;j++)s+=v[j];prev=s/p;out[i]=prev;}
    else if(i>p-1){prev=v[i]*k+prev*(1-k);out[i]=prev;}
  }
  return out;
}
function sma(v,p){var out=nanArr(v.length),s=0;for(var i=0;i<v.length;i++){s+=v[i];if(i>=p)s-=v[i-p];if(i>=p-1)out[i]=s/p;}return out}
function rsi(cl,p){
  var out=nanArr(cl.length);if(cl.length<=p)return out;
  var g=0,l=0,i,d;
  for(i=1;i<=p;i++){d=cl[i]-cl[i-1];if(d>=0)g+=d;else l-=d;}
  g/=p;l/=p;out[p]=l===0?100:100-100/(1+g/l);
  for(i=p+1;i<cl.length;i++){d=cl[i]-cl[i-1];g=(g*(p-1)+(d>0?d:0))/p;l=(l*(p-1)+(d<0?-d:0))/p;out[i]=l===0?100:100-100/(1+g/l);}
  return out;
}
function trueRange(cs,i){var a=cs[i].h-cs[i].l;if(i===0)return a;var pc=cs[i-1].c;return Math.max(a,Math.abs(cs[i].h-pc),Math.abs(cs[i].l-pc))}
function atr(cs,p){
  var out=nanArr(cs.length);if(cs.length<=p)return out;
  var a=0,i;for(i=1;i<=p;i++)a+=trueRange(cs,i);a/=p;out[p]=a;
  for(i=p+1;i<cs.length;i++){a=(a*(p-1)+trueRange(cs,i))/p;out[i]=a;}
  return out;
}
function adx(cs,p){
  var n=cs.length,out=nanArr(n);if(n<2*p+1)return out;
  var pdm=[0],mdm=[0],tr=[0],i;
  for(i=1;i<n;i++){var up=cs[i].h-cs[i-1].h,dn=cs[i-1].l-cs[i].l;pdm.push(up>dn&&up>0?up:0);mdm.push(dn>up&&dn>0?dn:0);tr.push(trueRange(cs,i));}
  var sT=0,sP=0,sM=0;for(i=1;i<=p;i++){sT+=tr[i];sP+=pdm[i];sM+=mdm[i];}
  var dxs=nanArr(n);
  function dxAt(){var a=100*sP/sT,b=100*sM/sT,s=a+b;return s===0?0:100*Math.abs(a-b)/s}
  dxs[p]=dxAt();
  for(i=p+1;i<n;i++){sT=sT-sT/p+tr[i];sP=sP-sP/p+pdm[i];sM=sM-sM/p+mdm[i];dxs[i]=dxAt();}
  var a=0;for(i=p;i<2*p;i++)a+=dxs[i];a/=p;out[2*p-1]=a;
  for(i=2*p;i<n;i++){a=(a*(p-1)+dxs[i])/p;out[i]=a;}
  return out;
}
// ---- intervalo maior (confirmação macro) ----
function spacing(a){
  var d=[];for(var k=1;k<a.length&&d.length<60;k++)d.push(a[k].t-a[k-1].t);
  d.sort(function(x,y){return x-y});return d.length?d[Math.floor(d.length/2)]:NaN;
}
function tfName(ms){var m=ms/60000;if(m<60)return Math.round(m)+'m';if(m<1440)return Math.round(m/60)+'h';if(m<10080)return Math.round(m/1440)+'d';return Math.round(m/10080)+'sem'}
// Para cada vela base, a tendência da última vela do intervalo maior JÁ FECHADA naquele instante:
// 1 alta (preço e média 21 acima da 50), -1 baixa, 0 lateral/indefinida. Sem olhar o futuro.
function htfBiasSeries(cs,hc){
  var tfB=spacing(cs),tfH=spacing(hc);
  if(!(tfB>0)||!(tfH>0)||tfH<=tfB)return {missing:true};
  var cl=hc.map(function(c){return c.c}),e21=ema(cl,21),e50=ema(cl,50),ax=adx(hc,14),n=cs.length,bias=nanArr(n),hadx=nanArr(n),j=-1;
  for(var i=0;i<n;i++){
    var tc=cs[i].t+tfB;
    while(j+1<hc.length&&hc[j+1].t+tfH<=tc)j++;
    if(j>=0&&isFinite(e50[j])){
      var c=cl[j];
      bias[i]=c>e50[j]&&e21[j]>e50[j]?1:(c<e50[j]&&e21[j]<e50[j]?-1:0);
      hadx[i]=ax[j];
    }
  }
  return {bias:bias,adx:hadx,name:tfName(tfH),tf:tfH};
}
function computeIndicators(cs,params,htfCs){
  var P=normParams(params);
  var cl=cs.map(function(x){return x.c}),vo=cs.map(function(x){return x.v}),n=cs.length,hh=nanArr(n),ll=nanArr(n);
  for(var i=20;i<n;i++){var h=-Infinity,l=Infinity;for(var j=i-20;j<i;j++){if(cs[j].h>h)h=cs[j].h;if(cs[j].l<l)l=cs[j].l;}hh[i]=h;ll[i]=l;}
  var htf=P.htf>0?(htfCs&&htfCs.length>2?htfBiasSeries(cs,htfCs):{missing:true}):null;
  return {htf:htf,et:P.trendP>0?ema(cl,P.trendP):null,ef:ema(cl,P.emaF),em:ema(cl,P.emaM),es:ema(cl,P.emaS),rsi:rsi(cl,14),atr:atr(cs,14),adx:adx(cs,14),vavg:sma(vo,20),hh20:hh,ll20:ll};
}
function minBars(P){return Math.max(60,P.emaS+11,P.trendP>0?P.trendP+11:0)}
function signalAt(cs,ind,i,params){
  var P=normParams(params);
  var out={dir:'wait',score:0,reasons:[],blockers:[],entry:null,stop:null,target:null,risk:null,rr:P.rr,atr:null,regime:'indefinido',adx:null,rsi:null,volRatio:null,htfBias:null,htfName:null,checks:[]};
  if(i<minBars(P)){out.blockers.push('Poucas velas para analisar');return out}
  var b=cs[i],c=b.c,ef=ind.ef[i],em=ind.em[i],es=ind.es[i],r=ind.rsi[i],a=ind.atr[i],ad=ind.adx[i],va=ind.vavg[i];
  if([ef,em,es,r,a,ad,va,ind.hh20[i]].some(function(x){return !isFinite(x)})){out.blockers.push('Indicadores ainda sem dados suficientes');return out}
  var up=ef>em&&em>es&&c>em,dn=ef<em&&em<es&&c<em,score=0;
  var names=P.emaF+', '+P.emaM+' e '+P.emaS;
  if(up){score+=2;out.reasons.push('Médias '+names+' alinhadas para cima')}
  else if(dn){score-=2;out.reasons.push('Médias '+names+' alinhadas para baixo')}
  var slope=es-ind.es[i-10];
  if(up&&slope>0){score+=1;out.reasons.push('Média '+P.emaS+' subindo')}
  if(dn&&slope<0){score-=1;out.reasons.push('Média '+P.emaS+' caindo')}
  if(up&&r>=50&&r<=68){score+=1;out.reasons.push('RSI em '+r.toFixed(0)+', força sem exagero')}
  if(dn&&r<=50&&r>=32){score-=1;out.reasons.push('RSI em '+r.toFixed(0)+', fraqueza sem exagero')}
  if(c>ind.hh20[i]){score+=1;out.reasons.push('Fechou acima da máxima das últimas 20 velas')}
  else if(c<ind.ll20[i]){score-=1;out.reasons.push('Fechou abaixo da mínima das últimas 20 velas')}
  if(b.v>1.2*va){if(b.c>b.o){score+=1;out.reasons.push('Volume acima da média em vela de alta')}else if(b.c<b.o){score-=1;out.reasons.push('Volume acima da média em vela de baixa')}}
  out.score=score;out.atr=a;out.adx=ad;out.rsi=r;out.volRatio=b.v/va;
  out.regime=ad<P.adxMin?'lateral':(up?'alta':(dn?'baixa':'transição'));
  if(ad<P.adxMin)out.blockers.push('Mercado lateral (ADX '+ad.toFixed(0)+', abaixo de '+P.adxMin+')');
  if(score>=P.minScore){if(r>72)out.blockers.push('RSI esticado em '+r.toFixed(0)+', compra tardia')}
  else if(score<=-P.minScore){if(r<28)out.blockers.push('RSI esticado em '+r.toFixed(0)+', venda tardia')}
  else out.blockers.push('Tendência, força e volume sem alinhamento suficiente ('+score+' pontos de 6, mínimo '+P.minScore+')');
  var hb=NaN,macroTxt='';
  if(P.htf>0){
    if(!ind.htf||ind.htf.missing)macroTxt='sem dados do intervalo maior';
    else{hb=ind.htf.bias[i];out.htfName=ind.htf.name;out.htfBias=isFinite(hb)?hb:null;macroTxt=!isFinite(hb)?'poucas velas no intervalo maior':(hb===1?'em alta':(hb===-1?'em baixa':'lateral'))}
  }
  if(Math.abs(score)>=P.minScore){
    if(P.htf>0){
      if(!ind.htf||ind.htf.missing)out.blockers.push('Sem dados do intervalo maior para confirmar');
      else if(!isFinite(hb))out.blockers.push('Poucas velas no intervalo maior ('+ind.htf.name+')');
      else if(score>0&&hb!==1)out.blockers.push('Compra sem apoio da tendência maior ('+ind.htf.name+' '+macroTxt+')');
      else if(score<0&&hb!==-1)out.blockers.push('Venda sem apoio da tendência maior ('+ind.htf.name+' '+macroTxt+')');
    }
    if(P.trendP>0){
      var et=ind.et[i];
      if(!isFinite(et))out.blockers.push('Poucas velas para a tendência longa');
      else if(score>0&&c<et)out.blockers.push('Compra contra a tendência longa (abaixo da média '+P.trendP+')');
      else if(score<0&&c>et)out.blockers.push('Venda contra a tendência longa (acima da média '+P.trendP+')');
    }
    var ap=a/c*100;
    if(P.atrMinPct>0&&ap<P.atrMinPct)out.blockers.push('Volatilidade baixa demais ('+ap.toFixed(2)+'%)');
    if(P.atrMaxPct>0&&ap>P.atrMaxPct)out.blockers.push('Volatilidade alta demais ('+ap.toFixed(2)+'%)');
  }
  // lista de critérios, a base do semáforo na tela: cada um com resultado e uma frase curta
  var ck=out.checks,rsiBad=(score>=P.minScore&&r>72)||(score<=-P.minScore&&r<28);
  ck.push({id:'adx',required:true,ok:ad>=P.adxMin,label:'Mercado com tendência, não lateral',detail:'ADX '+ad.toFixed(0)+' (mínimo '+P.adxMin+')'});
  if(P.htf>0){
    var macroOk=isFinite(hb)&&(score>0?hb===1:(score<0?hb===-1:hb!==0));
    ck.push({id:'macro',required:true,ok:macroOk,label:'Alinhado com a tendência maior'+(out.htfName?' ('+out.htfName+')':''),detail:'Tendência maior '+macroTxt});
  }
  ck.push({id:'align',required:true,ok:up||dn,label:'Médias apontando para o mesmo lado',detail:up?'para cima':(dn?'para baixo':'misturadas')});
  ck.push({id:'score',required:true,ok:Math.abs(score)>=P.minScore,label:'Pontuação mínima ('+P.minScore+' de 6)',detail:Math.abs(score)+' pontos'});
  ck.push({id:'rsi',required:true,ok:!rsiBad,label:'Sem exagero de preço (RSI)',detail:'RSI '+r.toFixed(0)});
  ck.push({id:'volume',required:false,ok:b.v>1.2*va,label:'Volume confirmando',detail:(b.v/va).toFixed(1).replace('.',',')+'x da média'});
  ck.push({id:'rr',required:false,ok:P.rr>=2,label:'Retorno maior que o risco',detail:P.rr+' : 1'});
  if(!out.blockers.length){
    var long=score>=P.minScore,risk=P.stopAtr*a;
    out.dir=long?'long':'short';out.entry=c;out.risk=risk;
    out.stop=long?c-risk:c+risk;out.target=long?c+P.rr*risk:c-P.rr*risk;
  }
  return out;
}
// Stop e alvo a partir de uma entrada, para o plano manual e para sinais com preço já deslocado.
function levels(side,entry,atrVal,params){
  var P=normParams(params),risk=P.stopAtr*atrVal,long=side==='long';
  return {stop:long?entry-risk:entry+risk,target:long?entry+P.rr*risk:entry-P.rr*risk,risk:risk,rr:P.rr};
}
function sizing(bal,riskPct,entry,stop,lev,feePct){
  var dist=Math.abs(entry-stop),riskUSD=Math.max(0,bal)*riskPct/100,qty=dist>0?riskUSD/dist:0,notional=qty*entry;
  var margin=lev>0?notional/lev:Infinity,distPct=entry>0?dist/entry*100:0;
  var liqPct=lev>0?Math.max(0,100/lev-MMR):100,long=stop<entry;
  return {riskUSD:riskUSD,qty:qty,notional:notional,margin:margin,distPct:distPct,liqPct:liqPct,
    liqPrice:long?entry*(1-liqPct/100):entry*(1+liqPct/100),
    feesUSD:notional*feePct/100*2,marginOver:margin>Math.max(0,bal),
    nearLiq:distPct>=0.8*liqPct,stopBeyondLiq:distPct>=liqPct,dist:dist};
}
// Uma vela de vida de uma operação aberta (a mesma regra no backtest e no robô).
// Stop e alvo valem pela máxima e mínima da vela; se os dois caírem na mesma vela, vale o stop.
// Depois, com a vela já encerrada, o stop pode subir (breakeven e trailing) para valer a partir da próxima.
// t: {side, entry, stop, target, dist0, mfe, bars, moved}. Devolve {price, reason} ou null.
function stepTrade(t,c,atrVal,P){
  var long=t.side==='long';
  t.bars=(t.bars||0)+1;
  if(long?c.l<=t.stop:c.h>=t.stop)return {price:t.stop,reason:t.moved?'Stop móvel':'Stop'};
  if(long?c.h>=t.target:c.l<=t.target)return {price:t.target,reason:'Alvo'};
  var fav=long?c.h-t.entry:t.entry-c.l;
  if(!(fav<=(t.mfe||0)))t.mfe=fav;
  var d0=t.dist0||Math.abs(t.entry-t.stop);
  if(P.beR>0&&t.mfe>=P.beR*d0&&(long?t.entry>t.stop:t.entry<t.stop)){t.stop=t.entry;t.moved=true}
  if(P.trailAtr>0&&isFinite(atrVal)&&t.mfe>=(P.beR>0?P.beR:1)*d0){
    var tr=long?c.h-P.trailAtr*atrVal:c.l+P.trailAtr*atrVal;
    if(long?tr>t.stop:tr<t.stop){t.stop=tr;t.moved=true}
  }
  if(P.maxBars>0&&t.bars>=P.maxBars)return {price:c.c,reason:'Tempo'};
  return null;
}
// from/to (opcionais) limitam o teste a um trecho da série; os indicadores continuam vindo da série inteira (são causais).
function backtest(cs,ind,feePct,params,slipPct,from,to){
  var P=normParams(params),trades=[],i=Math.max(minBars(P),from||0),end=to||cs.length,cost=2*((feePct||0)+(slipPct||0))/100;
  while(i<end-1){
    var s=signalAt(cs,ind,i,P);
    if(s.dir==='wait'){i++;continue}
    var long=s.dir==='long',dist=Math.abs(s.entry-s.stop),exitIdx=-1,price=0,why='',j;
    var t={side:s.dir,entry:s.entry,stop:s.stop,target:s.target,dist0:dist,mfe:0,bars:0,moved:false};
    for(j=i+1;j<end;j++){var r=stepTrade(t,cs[j],ind.atr[j],P);if(r){exitIdx=j;price=r.price;why=r.reason;break}}
    if(exitIdx<0){exitIdx=end-1;price=cs[exitIdx].c;why='fim dos dados'}
    var R=(price-s.entry)*(long?1:-1)/dist-cost*s.entry/dist;
    trades.push({i:i,j:exitIdx,dir:s.dir,R:R,why:why.toLowerCase()});
    i=exitIdx+(R<0&&P.cooldown>0?P.cooldown:1);
  }
  var wins=0,gw=0,gl=0,cum=0,peak=0,dd=0,curve=[0];
  trades.forEach(function(t){if(t.R>0){wins++;gw+=t.R}else gl+=-t.R;cum+=t.R;curve.push(cum);if(cum>peak)peak=cum;if(peak-cum>dd)dd=peak-cum;});
  return {n:trades.length,wins:wins,winRate:trades.length?wins/trades.length*100:0,totalR:cum,avgR:trades.length?cum/trades.length:0,
    pf:gl>0?gw/gl:(gw>0?Infinity:0),maxDD:dd,curve:curve,trades:trades};
}
// Decide se uma operação aberta já bateu stop ou alvo. Velas depois da abertura valem pela máxima e mínima;
// a vela da abertura só vale pelo fechamento, porque a máxima e a mínima dela podem ser anteriores à entrada.
function resolveTrade(t,cs){
  if(!cs.length)return null;
  var long=t.side==='long';
  function test(hi,lo){
    var hitS=long?lo<=t.stop:hi>=t.stop,hitT=long?hi>=t.target:lo<=t.target;
    if(hitS)return {price:t.stop,reason:'Stop'};
    if(hitT)return {price:t.target,reason:'Alvo'};
    return null;
  }
  var s=cs.length;while(s>0&&cs[s-1].t>t.openT)s--;
  var r;
  if(s>0){r=test(cs[s-1].c,cs[s-1].c);if(r)return r}
  for(var k=s;k<cs.length;k++){r=test(cs[k].h,cs[k].l);if(r)return r}
  return null;
}
function parseCSV(text){
  var lines=String(text).split(/\r?\n/).map(function(s){return s.trim()}).filter(Boolean);
  if(lines.length<2)return {error:'O arquivo tem poucas linhas.'};
  var sep=lines[0].indexOf(';')>=0?';':(lines[0].indexOf('\t')>=0?'\t':',');
  var rows=lines.map(function(l){return l.split(sep).map(function(s){return s.trim().replace(/^"|"$/g,'')})});
  function num(s){if(s==null||s==='')return NaN;var t=String(s);if(t.indexOf(',')>=0)t=t.replace(/\./g,'').replace(',','.');return parseFloat(t)}
  var idx={t:0,o:1,h:2,l:3,c:4,v:5},start=0,first=rows[0];
  if(first.some(function(x){return /[a-zA-Z]{3,}/.test(x)})){
    var find=function(re){return first.findIndex(function(h){return re.test(h.toLowerCase())})};
    var t=find(/time|date|data|hora|timestamp/),o=find(/^open|abertura/),h=find(/^high|m[aá]x/),l=find(/^low|m[ií]n/),c=find(/^close|fecha/),v=find(/vol/);
    if([o,h,l,c].some(function(x){return x<0}))return {error:'Não achei as colunas open, high, low e close no cabeçalho.'};
    idx={t:t,o:o,h:h,l:l,c:c,v:v};start=1;
  }
  var cs=[];
  for(var k=start;k<rows.length;k++){
    var r=rows[k],o2=num(r[idx.o]),h2=num(r[idx.h]),l2=num(r[idx.l]),c2=num(r[idx.c]);
    if(![o2,h2,l2,c2].every(isFinite))continue;
    var tt=NaN;
    if(idx.t>=0&&r[idx.t]!=null){var raw=r[idx.t];if(/^\d+$/.test(raw)){var x=Number(raw);tt=x>1e14?x/1000:(x>1e11?x:x*1000)}else tt=Date.parse(raw.replace(' ','T'))}
    var vv=idx.v>=0?num(r[idx.v]):0;
    cs.push({t:tt,o:o2,h:Math.max(o2,h2,l2,c2),l:Math.min(o2,h2,l2,c2),c:c2,v:isFinite(vv)?vv:0});
  }
  if(cs.every(function(x){return isFinite(x.t)}))cs.sort(function(a,b){return a.t-b.t});
  else cs.forEach(function(x,i){x.t=Date.UTC(2026,0,1)+i*60000});
  if(cs.length<80)return {error:'Preciso de pelo menos 80 velas (o ideal é 300 ou mais). Achei '+cs.length+'.'};
  return {candles:cs};
}

return {MMR:MMR,DEFAULTS:DEFAULTS,PRESETS:PRESETS,normParams:normParams,mulberry32:mulberry32,genCandles:genCandles,
  ema:ema,sma:sma,rsi:rsi,atr:atr,adx:adx,computeIndicators:computeIndicators,signalAt:signalAt,levels:levels,
  sizing:sizing,stepTrade:stepTrade,minBars:minBars,htfBiasSeries:htfBiasSeries,tfName:tfName,backtest:backtest,resolveTrade:resolveTrade,parseCSV:parseCSV};
});
