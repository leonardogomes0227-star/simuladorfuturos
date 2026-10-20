// Dados de mercado reais: velas da Binance (API pública, sem chave) por REST e WebSocket.
// Resiliência: tentativas com espera crescente, respeito ao Retry-After, servidor reserva,
// "disjuntor" que para de bater num servidor que está falhando e validação das velas recebidas.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RadarData=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

var TFS={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
var HOSTS=['https://api.binance.com','https://data-api.binance.vision'];
var WS_HOST='wss://stream.binance.com:9443/ws/';
var MAX_CANDLES=1500;
var POPULAR=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','TRXUSDT','MATICUSDT',
  'LTCUSDT','BCHUSDT','ATOMUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','INJUSDT','FILUSDT','UNIUSDT','AAVEUSDT','ETCUSDT',
  'XLMUSDT','HBARUSDT','ICPUSDT','RUNEUSDT','PEPEUSDT','SHIBUSDT','WIFUSDT','TONUSDT','SEIUSDT','TIAUSDT'];
// Intervalo maior usado para confirmar a tendência de fundo de cada intervalo.
var MACRO={'1m':'15m','5m':'1h','15m':'4h','1h':'4h','4h':'1d','1d':'1w'};

function validSymbol(s){return /^[A-Z0-9]{4,20}$/.test(String(s||''))}
function normSymbol(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}
function macroTf(tf){return MACRO[tf]||null}

/* ---------- validação das velas ---------- */
function parseKlines(rows){
  if(!Array.isArray(rows))return [];
  var out=[];
  rows.forEach(function(k){
    if(!Array.isArray(k)||k.length<6)return;
    var c={t:Number(k[0]),o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4]),v:parseFloat(k[5])};
    if(![c.t,c.o,c.h,c.l,c.c].every(isFinite)||!(c.o>0&&c.h>0&&c.l>0&&c.c>0))return;
    if(!isFinite(c.v)||c.v<0)c.v=0;
    // máxima e mínima têm de conter abertura e fechamento
    c.h=Math.max(c.h,c.o,c.c,c.l);c.l=Math.min(c.l,c.o,c.c,c.h);
    out.push(c);
  });
  out.sort(function(a,b){return a.t-b.t});
  // vela repetida: vale a última recebida
  return out.filter(function(c,i){return i===out.length-1||out[i+1].t!==c.t});
}
// Mensagem de kline do WebSocket: {"k":{"t":...,"o":"..","h":"..","l":"..","c":"..","v":".."}}
function klineFromWs(msg){
  var m=msg;
  if(typeof m==='string'){try{m=JSON.parse(m)}catch(e){return null}}
  if(!m||!m.k)return null;
  var k=m.k,c={t:Number(k.t),o:parseFloat(k.o),h:parseFloat(k.h),l:parseFloat(k.l),c:parseFloat(k.c),v:parseFloat(k.v)};
  return [c.t,c.o,c.h,c.l,c.c].every(isFinite)?c:null;
}
// Atualiza a série com uma vela nova ou em formação. Devolve 'update', 'append' ou 'ignore'.
function applyKline(cs,c){
  if(!c)return 'ignore';
  var last=cs[cs.length-1];
  if(last&&c.t===last.t){cs[cs.length-1]=c;return 'update'}
  if(!last||c.t>last.t){cs.push(c);if(cs.length>MAX_CANDLES)cs.splice(0,cs.length-MAX_CANDLES);return 'append'}
  return 'ignore';
}
// A série acompanha o relógio? Mede o atraso da última vela FECHADA e conta buracos nas últimas 300 velas.
function dataHealth(cs,tfMs,now){
  var out={ok:false,stale:true,lagMs:Infinity,gaps:0,lastClosedT:null,reason:'sem dados'};
  if(!cs||!cs.length||!(tfMs>0))return out;
  var k=cs.length-1;
  while(k>=0&&cs[k].t+tfMs>now)k--;
  if(k<0){out.reason='nenhuma vela fechada ainda';return out}
  out.lastClosedT=cs[k].t;out.lagMs=now-(cs[k].t+tfMs);
  out.stale=out.lagMs>tfMs*1.5+60000;
  for(var i=Math.max(1,k-299);i<=k;i++)if(cs[i].t-cs[i-1].t>tfMs*1.5)out.gaps++;
  out.ok=!out.stale&&out.gaps===0;
  out.reason=out.stale?'a última vela fechada tem '+Math.round(out.lagMs/tfMs*10)/10+' intervalos de atraso':(out.gaps?out.gaps+' buraco(s) nas velas recentes':'em dia');
  return out;
}
function klinesUrl(host,sym,tf,limit){return host+'/api/v3/klines?symbol='+encodeURIComponent(sym)+'&interval='+encodeURIComponent(tf)+'&limit='+limit}
function wsUrl(sym,tf){return WS_HOST+sym.toLowerCase()+'@kline_'+tf}

/* ---------- requisições resilientes ---------- */
var BREAKER={}; // servidor -> {fails, openUntil}
function resetBreaker(){BREAKER={}}
function breakerState(){return JSON.parse(JSON.stringify(BREAKER))}
function isOpen(host,now){var b=BREAKER[host];return !!(b&&b.openUntil>now)}
function noteOk(host){BREAKER[host]={fails:0,openUntil:0}}
function noteFail(host,now,blockMs){
  var b=BREAKER[host]||(BREAKER[host]={fails:0,openUntil:0});
  b.fails++;
  if(blockMs)b.openUntil=now+blockMs;                       // bloqueio regional: não adianta insistir
  else if(b.fails>=3){b.openUntil=now+60000;b.fails=0}      // falhas seguidas: dá um tempo ao servidor
}
function httpError(status,retryAfterMs){var e=new Error('HTTP '+status);e.status=status;e.retryAfterMs=retryAfterMs||0;return e}
// O que fazer com o erro: 'fatal' (pedido ruim), 'blocked' (servidor nos recusa), 'retry' (tentar de novo) ou 'next' (outro servidor)
function classify(e){
  var s=e&&e.status;
  if(!s)return 'retry';
  if(s===400||s===404)return 'fatal';
  if(s===451||s===403)return 'blocked';
  if(s===429||s===418||s>=500)return 'retry';
  return 'next';
}
function sleepMs(ms){return new Promise(function(r){setTimeout(r,ms)})}
function fetchJson(url,fetchImpl,timeoutMs){
  var ctl=typeof AbortController!=='undefined'?new AbortController():null,timer=null;
  if(ctl)timer=setTimeout(function(){ctl.abort()},timeoutMs||10000);
  return fetchImpl(url,ctl?{signal:ctl.signal}:undefined).then(function(r){
    if(timer)clearTimeout(timer);
    if(!r.ok){
      var ra=0;try{ra=(parseFloat(r.headers&&r.headers.get&&r.headers.get('retry-after'))||0)*1000}catch(e){}
      throw httpError(r.status,ra);
    }
    return r.json();
  },function(e){if(timer)clearTimeout(timer);throw e});
}
// Faz o pedido percorrendo os servidores: tenta de novo com espera crescente, respeita Retry-After e pula servidor bloqueado.
function request(buildUrl,fetchImpl,o){
  o=Object.assign({tries:3,baseMs:400,maxMs:4000,timeoutMs:10000,sleep:sleepMs,now:Date.now},o||{});
  var hosts=HOSTS.filter(function(h){return !isOpen(h,o.now())});
  if(!hosts.length)hosts=HOSTS.slice();
  var lastErr=null;
  function tryHost(hi){
    if(hi>=hosts.length)return Promise.reject(lastErr||new Error('Sem resposta'));
    var h=hosts[hi],attempt=0;
    function go(){
      attempt++;
      return fetchJson(buildUrl(h),fetchImpl,o.timeoutMs).then(function(v){noteOk(h);return v},function(e){
        lastErr=e;
        var kind=classify(e);
        if(kind==='fatal')throw e;
        if(kind==='retry'&&attempt<o.tries){
          var wait=Math.min(o.maxMs,Math.max(e.retryAfterMs||0,o.baseMs*Math.pow(2,attempt-1)));
          return o.sleep(wait).then(go);
        }
        noteFail(h,o.now(),kind==='blocked'?600000:0);
        return tryHost(hi+1);
      });
    }
    return go();
  }
  return tryHost(0);
}

function fetchKlines(sym,tf,limit,fetchImpl,opts){
  fetchImpl=fetchImpl||fetch;
  if(!validSymbol(sym))return Promise.reject(new Error('Símbolo inválido'));
  if(!TFS[tf])return Promise.reject(new Error('Intervalo inválido'));
  return request(function(h){return klinesUrl(h,sym,tf,limit||500)},fetchImpl,opts).then(function(rows){
    var cs=parseKlines(rows);
    if(cs.length<2)throw new Error('Ativo sem velas');
    return cs;
  },function(e){if(e&&e.status===400)throw new Error('Ativo não encontrado na Binance');throw e});
}
// Preço e variação das últimas 24h de vários pares: {BTCUSDT: {price, change}} (change em %).
function fetchTicker24h(symbols,fetchImpl,opts){
  fetchImpl=fetchImpl||fetch;
  var list=symbols.filter(validSymbol);
  if(!list.length)return Promise.resolve({});
  var q='symbols='+encodeURIComponent(JSON.stringify(list));
  return request(function(h){return h+'/api/v3/ticker/24hr?type=MINI&'+q},fetchImpl,Object.assign({timeoutMs:8000},opts)).then(function(rows){
    if(!Array.isArray(rows))throw new Error('Resposta inesperada');
    var out={};
    rows.forEach(function(r){
      var p=r&&parseFloat(r.lastPrice),o=r&&parseFloat(r.openPrice);
      if(r&&validSymbol(r.symbol)&&p>0)out[r.symbol]={price:p,change:o>0?(p/o-1)*100:0};
    });
    return out;
  });
}
// Histórico longo: busca em páginas de 1000 velas entre startMs e endMs.
function fetchKlinesRange(sym,tf,startMs,endMs,fetchImpl,opts){
  fetchImpl=fetchImpl||fetch;
  if(!validSymbol(sym))return Promise.reject(new Error('Símbolo inválido'));
  if(!TFS[tf])return Promise.reject(new Error('Intervalo inválido'));
  var all=[],cursor=startMs,step=TFS[tf];
  function page(){
    if(cursor>=endMs)return Promise.resolve(all);
    return request(function(h){return klinesUrl(h,sym,tf,1000)+'&startTime='+cursor+'&endTime='+endMs},fetchImpl,Object.assign({timeoutMs:20000},opts)).then(parseKlines).then(function(cs){
      if(!cs.length)return all;
      all=all.concat(cs.filter(function(c){return !all.length||c.t>all[all.length-1].t}));
      var next=cs[cs.length-1].t+step;
      if(next<=cursor)return all;
      cursor=next;
      return cs.length<1000?all:page();
    });
  }
  return page();
}
// Preço atual de vários pares de uma vez: {BTCUSDT: 81234.5, ...}
function fetchPrices(symbols,fetchImpl,opts){
  fetchImpl=fetchImpl||fetch;
  var list=symbols.filter(validSymbol);
  if(!list.length)return Promise.resolve({});
  var q='symbols='+encodeURIComponent(JSON.stringify(list));
  return request(function(h){return h+'/api/v3/ticker/price?'+q},fetchImpl,Object.assign({timeoutMs:8000},opts)).then(function(rows){
    if(!Array.isArray(rows))throw new Error('Resposta inesperada');
    var out={};rows.forEach(function(r){var p=r&&parseFloat(r.price);if(r&&validSymbol(r.symbol)&&p>0)out[r.symbol]=p});
    return out;
  });
}
function fetchSymbols(fetchImpl,opts){
  fetchImpl=fetchImpl||fetch;
  return request(function(h){return h+'/api/v3/ticker/price'},fetchImpl,Object.assign({timeoutMs:15000},opts)).then(function(rows){
    if(!Array.isArray(rows))throw new Error('Resposta inesperada');
    var list=rows.map(function(r){return r&&r.symbol}).filter(function(s){return typeof s==='string'&&/USDT$/.test(s)&&validSymbol(s)&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(s)});
    list.sort();
    return list;
  });
}

return {TFS:TFS,POPULAR:POPULAR,MAX_CANDLES:MAX_CANDLES,HOSTS:HOSTS,validSymbol:validSymbol,normSymbol:normSymbol,macroTf:macroTf,
  parseKlines:parseKlines,klineFromWs:klineFromWs,applyKline:applyKline,dataHealth:dataHealth,wsUrl:wsUrl,klinesUrl:klinesUrl,
  request:request,classify:classify,resetBreaker:resetBreaker,breakerState:breakerState,
  fetchKlines:fetchKlines,fetchKlinesRange:fetchKlinesRange,fetchPrices:fetchPrices,fetchTicker24h:fetchTicker24h,fetchSymbols:fetchSymbols};
});
