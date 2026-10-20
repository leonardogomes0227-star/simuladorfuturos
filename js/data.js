// Dados de mercado reais: velas da Binance (API pública, sem chave) por REST e WebSocket.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RadarData=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

var TFS={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
var HOSTS=['https://api.binance.com','https://data-api.binance.vision'];
var WS_HOST='wss://stream.binance.com:9443/ws/';
var MAX_CANDLES=1500;
var POPULAR=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','DOTUSDT','TRXUSDT','MATICUSDT',
  'LTCUSDT','BCHUSDT','ATOMUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','INJUSDT','FILUSDT','UNIUSDT','AAVEUSDT','ETCUSDT',
  'XLMUSDT','HBARUSDT','ICPUSDT','RUNEUSDT','PEPEUSDT','SHIBUSDT','WIFUSDT','TONUSDT','SEIUSDT','TIAUSDT'];

function validSymbol(s){return /^[A-Z0-9]{4,20}$/.test(String(s||''))}
function normSymbol(s){return String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')}

function parseKlines(rows){
  if(!Array.isArray(rows))return [];
  var out=[];
  rows.forEach(function(k){
    if(!Array.isArray(k)||k.length<6)return;
    var c={t:Number(k[0]),o:parseFloat(k[1]),h:parseFloat(k[2]),l:parseFloat(k[3]),c:parseFloat(k[4]),v:parseFloat(k[5])};
    if([c.t,c.o,c.h,c.l,c.c].every(isFinite)&&c.o>0&&c.h>0&&c.l>0&&c.c>0){if(!isFinite(c.v))c.v=0;out.push(c)}
  });
  out.sort(function(a,b){return a.t-b.t});
  return out;
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
function klinesUrl(host,sym,tf,limit){return host+'/api/v3/klines?symbol='+encodeURIComponent(sym)+'&interval='+encodeURIComponent(tf)+'&limit='+limit}
function wsUrl(sym,tf){return WS_HOST+sym.toLowerCase()+'@kline_'+tf}

function fetchJson(url,fetchImpl,timeoutMs){
  var ctl=typeof AbortController!=='undefined'?new AbortController():null,timer=null;
  if(ctl)timer=setTimeout(function(){ctl.abort()},timeoutMs||10000);
  return fetchImpl(url,ctl?{signal:ctl.signal}:undefined).then(function(r){
    if(timer)clearTimeout(timer);
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  },function(e){if(timer)clearTimeout(timer);throw e});
}
function fetchKlines(sym,tf,limit,fetchImpl){
  fetchImpl=fetchImpl||fetch;
  if(!validSymbol(sym))return Promise.reject(new Error('Símbolo inválido'));
  if(!TFS[tf])return Promise.reject(new Error('Intervalo inválido'));
  var i=0;
  function next(err){
    if(i>=HOSTS.length)return Promise.reject(err||new Error('Sem resposta'));
    var h=HOSTS[i++];
    return fetchJson(klinesUrl(h,sym,tf,limit||500),fetchImpl).then(function(rows){
      var cs=parseKlines(rows);
      if(cs.length<2)throw new Error('Ativo sem velas');
      return cs;
    }).catch(function(e){if(/HTTP 400/.test(e.message))throw new Error('Ativo não encontrado na Binance');return next(e)});
  }
  return next();
}
// Histórico longo: busca em páginas de 1000 velas entre startMs e endMs.
function fetchKlinesRange(sym,tf,startMs,endMs,fetchImpl){
  fetchImpl=fetchImpl||fetch;
  if(!validSymbol(sym))return Promise.reject(new Error('Símbolo inválido'));
  if(!TFS[tf])return Promise.reject(new Error('Intervalo inválido'));
  var all=[],cursor=startMs,step=TFS[tf];
  function page(){
    if(cursor>=endMs)return Promise.resolve(all);
    var i=0;
    function host(err){
      if(i>=HOSTS.length)return Promise.reject(err||new Error('Sem resposta'));
      var url=klinesUrl(HOSTS[i++],sym,tf,1000)+'&startTime='+cursor+'&endTime='+endMs;
      return fetchJson(url,fetchImpl,20000).then(parseKlines).catch(host);
    }
    return host().then(function(cs){
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
function fetchPrices(symbols,fetchImpl){
  fetchImpl=fetchImpl||fetch;
  var list=symbols.filter(validSymbol);
  if(!list.length)return Promise.resolve({});
  var q='symbols='+encodeURIComponent(JSON.stringify(list)),i=0;
  function next(err){
    if(i>=HOSTS.length)return Promise.reject(err||new Error('Sem resposta'));
    return fetchJson(HOSTS[i++]+'/api/v3/ticker/price?'+q,fetchImpl,8000).then(function(rows){
      if(!Array.isArray(rows))throw new Error('Resposta inesperada');
      var out={};rows.forEach(function(r){var p=r&&parseFloat(r.price);if(r&&validSymbol(r.symbol)&&p>0)out[r.symbol]=p});
      return out;
    }).catch(next);
  }
  return next();
}
function fetchSymbols(fetchImpl){
  fetchImpl=fetchImpl||fetch;
  var i=0;
  function next(err){
    if(i>=HOSTS.length)return Promise.reject(err||new Error('Sem resposta'));
    return fetchJson(HOSTS[i++]+'/api/v3/ticker/price',fetchImpl,15000).then(function(rows){
      if(!Array.isArray(rows))throw new Error('Resposta inesperada');
      var list=rows.map(function(r){return r&&r.symbol}).filter(function(s){return typeof s==='string'&&/USDT$/.test(s)&&validSymbol(s)&&!/(UP|DOWN|BULL|BEAR)USDT$/.test(s)});
      list.sort();
      return list;
    }).catch(next);
  }
  return next();
}

return {TFS:TFS,POPULAR:POPULAR,MAX_CANDLES:MAX_CANDLES,validSymbol:validSymbol,normSymbol:normSymbol,parseKlines:parseKlines,klineFromWs:klineFromWs,
  applyKline:applyKline,wsUrl:wsUrl,klinesUrl:klinesUrl,fetchKlines:fetchKlines,fetchKlinesRange:fetchKlinesRange,fetchPrices:fetchPrices,fetchSymbols:fetchSymbols};
});
