// Interface do Radar de Futuros. Usa RadarEngine (cálculo), RadarMetrics (diário e risco) e RadarData (Binance).
(function(){
'use strict';
var E=window.RadarEngine,M=window.RadarMetrics,D=window.RadarData,Rd=window.RadarRadar,Narr=window.RadarNarrativa;
var $=function(id){return document.getElementById(id)};

var KEY='radar-futuros-v2',OLD_KEY='radar-futuros-v1',MODE_KEY='radar-modo',THEME_KEY='radar-tema',USE_KEY='radar-uso';
var SYMS={BTCUSDT:{seed:11,base:95000,vol:0.0035},ETHUSDT:{seed:23,base:3400,vol:0.0045},SOLUSDT:{seed:37,base:180,vol:0.006}};
var CFG_RANGE={capital:[10,1e7],riskPct:[0.1,5],lev:[1,20],dailyPct:[0.5,20],weeklyPct:[1,50],openRiskPct:[0.5,30],streakN:[0,10],cooldownMin:[1,1440],feePct:[0,0.5]};
var PARAM_IN={pEmaF:'emaF',pEmaM:'emaM',pEmaS:'emaS',pAdx:'adxMin',pScore:'minScore',pStop:'stopAtr',pRR:'rr'};
var LINE_COLORS=['#8fb4d9','#e8c46a','#38b48b','#b48bd9','#e0605c','#d9a441','#6fb1e6','#9aa5b1'];

var S={src:'demo',demoSym:'BTCUSDT',liveSym:'BTCUSDT',csvSym:'CSV',csvName:'',tf:'15m',
  all:[],candles:[],base:[],ind:null,sig:null,bt:null,
  viewN:110,off:0,hover:null,hoverY:null,hit:[],drag:null,pan:null,layout:null,
  auto:false,timer:null,speed:1,advanced:{},blind:false,cursor:0,
  trades:[],undo:[],plan:null,
  cfg:{capital:1000,riskPct:1,lev:5,dailyPct:3,weeklyPct:8,openRiskPct:3,streakN:3,cooldownMin:30,feePct:0.05,closedOnly:true},
  params:E.normParams(),presetId:'padrao',custom:{},
  live:{tok:0,ws:null,poll:null,retry:null,state:'off'},
  f:{sym:'',res:'',side:'',reason:'',tag:''},diaryN:25,
  view:'hoje',wantLive:false,resetArm:null,cancelArm:null,msgTimer:null,cmpCache:{},renderQueued:false,tickPending:false,installEvt:null};

/* ---------- formatação ---------- */
function fmtPrice(p){if(!isFinite(p))return '–';var a=Math.abs(p),d=a>=1000?2:(a>=10?3:(a>=1?4:(a>=0.01?5:8)));return p.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})}
function fmt2(n){return isFinite(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'–'}
function fmtSigned(n){return (n>0?'+':'')+fmt2(n)}
function fmtQty(q){return q.toLocaleString('pt-BR',{maximumFractionDigits:q>=100?2:(q>=1?3:5)})}
function f1(n){return n.toFixed(1).replace('.',',')}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function fmtDate(t){if(!isFinite(t))return '';var d=new Date(t),p=function(n){return String(n).padStart(2,'0')};return p(d.getDate())+'/'+p(d.getMonth()+1)+' '+p(d.getHours())+':'+p(d.getMinutes())}
function sgn(n){return n>0?'pos':(n<0?'neg':'')}
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function say(t){var m=$('msg');m.textContent=t;m.classList.toggle('show',!!t);clearTimeout(S.msgTimer);if(t)S.msgTimer=setTimeout(function(){m.classList.remove('show');setTimeout(function(){if(!m.classList.contains('show'))m.textContent=''},250)},6000)}
function rawPrice(p){return String(+p.toPrecision(8))}

/* ---------- uso local ---------- */
function track(name){
  try{var u=JSON.parse(localStorage.getItem(USE_KEY)||'{}');u[name]=(u[name]||0)+1;localStorage.setItem(USE_KEY,JSON.stringify(u))}catch(e){}
  try{var url=window.RADAR_ANALYTICS_URL;if(url&&navigator.sendBeacon)navigator.sendBeacon(url,JSON.stringify({e:name,t:Date.now()}))}catch(e){}
}
function usageText(){
  try{var u=JSON.parse(localStorage.getItem(USE_KEY)||'{}'),names={open:'operações abertas',live:'sessões ao vivo',csv:'arquivos importados',export:'exportações',undo:'desfazer'};
    var parts=Object.keys(names).filter(function(k){return u[k]}).map(function(k){return names[k]+': '+u[k]});
    return parts.length?'Seu uso neste aparelho (contado só localmente, nada é enviado): '+parts.join(' · ')+'.':''}catch(e){return ''}
}

/* ---------- persistência ---------- */
function snapshot(){return {cfg:S.cfg,params:S.params,presetId:S.presetId,custom:S.custom,trades:S.trades,advanced:S.advanced,
  demoSym:S.demoSym,liveSym:S.liveSym,tf:S.tf,src:S.src==='csv'?'demo':S.src,speed:S.speed,viewN:S.viewN}}
function num(v){return typeof v==='number'&&isFinite(v)}
function sanitizeTrade(t){
  if(!t||typeof t!=='object')return null;
  if(t.status!=='open'&&t.status!=='closed')return null;
  if(t.side!=='long'&&t.side!=='short')return null;
  if(![t.entry,t.stop,t.target,t.qty].every(num)||t.qty<=0)return null;
  if(t.status==='closed'&&(!num(t.pnl)||!num(t.closedAt)||!num(t.exit)))return null;
  var o={id:String(t.id||Date.now()+'-'+Math.floor(Math.random()*1e5)),sym:String(t.sym||'').slice(0,20),mode:t.mode==='live'||t.mode==='csv'?t.mode:'demo',tf:t.tf||'',
    side:t.side,entry:t.entry,stop:t.stop,target:t.target,qty:t.qty,lev:num(t.lev)?t.lev:1,risk:num(t.risk)?t.risk:Math.abs(t.entry-t.stop)*t.qty,
    openedAt:num(t.openedAt)?t.openedAt:Date.now(),note:String(t.note||'').slice(0,120),review:String(t.review||'').slice(0,300),
    tags:Array.isArray(t.tags)?t.tags.map(String).slice(0,6):[],status:t.status};
  if(num(t.openT))o.openT=t.openT;
  if(t.status==='closed'){o.exit=t.exit;o.pnl=t.pnl;o.closedAt=t.closedAt;o.reason=String(t.reason||'Manual')}
  return o;
}
function applyData(d){
  if(!d||typeof d!=='object')return;
  if(d.cfg&&typeof d.cfg==='object'){Object.keys(CFG_RANGE).forEach(function(k){var v=parseFloat(d.cfg[k]);if(isFinite(v))S.cfg[k]=clamp(v,CFG_RANGE[k][0],CFG_RANGE[k][1])});
    if(typeof d.cfg.closedOnly==='boolean')S.cfg.closedOnly=d.cfg.closedOnly}
  if(Array.isArray(d.trades))S.trades=d.trades.map(sanitizeTrade).filter(Boolean);
  if(d.advanced&&typeof d.advanced==='object')S.advanced=d.advanced;
  if(d.custom&&typeof d.custom==='object'){S.custom={};Object.keys(d.custom).slice(0,20).forEach(function(k){var c=d.custom[k];if(c&&c.p)S.custom[k]={name:String(c.name||'Minha estratégia').slice(0,24),p:E.normParams(c.p)}})}
  if(d.params)S.params=E.normParams(d.params);
  if(typeof d.presetId==='string')S.presetId=d.presetId;
  if(SYMS[d.demoSym||d.sym])S.demoSym=d.demoSym||d.sym;
  if(D.validSymbol(d.liveSym))S.liveSym=d.liveSym;
  if(D.TFS[d.tf])S.tf=d.tf;
  if(isFinite(d.speed)&&d.speed>0)S.speed=d.speed;
  if(isFinite(d.viewN))S.viewN=clamp(Math.round(d.viewN),20,600);
}
function load(){
  try{var raw=localStorage.getItem(KEY),first=!raw;if(first)raw=localStorage.getItem(OLD_KEY);
    if(!raw)return {first:true};
    var d=JSON.parse(raw);applyData(d);return {first:false,src:d.src}}
  catch(e){return {first:true}}
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(snapshot()))}catch(e){}}

/* ---------- contas do diário ---------- */
function inst(){return S.src==='live'?S.liveSym:(S.src==='demo'?S.demoSym:S.csvSym)}
function mine(t){return t.mode===S.src&&t.sym===inst()}
function closed(){return S.trades.filter(function(t){return t.status==='closed'})}
function openTrades(){return S.trades.filter(function(t){return t.status==='open'})}
function realized(){return closed().reduce(function(a,t){return a+t.pnl},0)}
function balance(){return S.cfg.capital+realized()}
function todayPnl(){return M.pnlSince(S.trades,M.startOfDay(Date.now()))}
function weekPnl(){return M.pnlSince(S.trades,M.startOfWeek(Date.now()))}
function dailyLimitUSD(){return S.cfg.dailyPct/100*S.cfg.capital}
function weeklyLimitUSD(){return S.cfg.weeklyPct/100*S.cfg.capital}
function last(){return S.candles[S.candles.length-1]}
function pauseLeft(){
  if(S.cfg.streakN<1)return 0;
  var ls=M.lossStreak(S.trades);if(ls.count<S.cfg.streakN)return 0;
  return Math.max(0,ls.lastAt+S.cfg.cooldownMin*60000-Date.now());
}
function tradeBlock(){
  if(todayPnl()<=-dailyLimitUSD())return 'Limite de perda do dia atingido. Pare por hoje.';
  if(weekPnl()<=-weeklyLimitUSD())return 'Limite de perda da semana atingido. Volte na próxima segunda-feira.';
  var left=pauseLeft();
  if(left>0)return 'Pausa depois de '+S.cfg.streakN+' perdas seguidas. Respire e volte em '+fmtDur(left)+'.';
  return '';
}
function fmtDur(ms){var min=Math.max(1,Math.round(ms/60000));if(min<60)return min+' min';var h=Math.floor(min/60),r=min%60;if(h<48)return h+' h'+(r?' '+r+' min':'');return Math.round(h/24)+' dias'}

function pushUndo(){S.undo.push(JSON.stringify(S.trades));if(S.undo.length>20)S.undo.shift();$('undo').disabled=false}
function undo(){
  if(!S.undo.length){say('Nada para desfazer.');return}
  S.trades=JSON.parse(S.undo.pop());$('undo').disabled=!S.undo.length;
  evaluateOpen();save();renderAll();say('Última ação desfeita.');track('undo');
}
function closeTrade(t,price,reason){
  var long=t.side==='long',fee=S.cfg.feePct/100;
  t.exit=price;t.status='closed';t.reason=reason;t.closedAt=Date.now();
  t.pnl=(price-t.entry)*t.qty*(long?1:-1)-(t.entry+price)*t.qty*fee;
}
function evaluateOpen(){
  var changed=false;
  S.trades.forEach(function(t){
    if(t.status!=='open'||!mine(t)||!S.candles.length)return;
    if(t.openT==null)t.openT=S.src==='live'?t.openedAt:last().t;
    var r=E.resolveTrade(t,S.candles);
    if(r){closeTrade(t,r.price,r.reason);changed=true}
  });
  if(changed)save();
  return changed;
}

/* ---------- plano de operação (sinal ou manual) ---------- */
function atrNow(){var a=S.ind&&S.ind.atr[S.base.length-1];return isFinite(a)?a:last().c*0.005}
function plan(){
  var c=last();if(!c)return null;
  if(S.plan)return {side:S.plan.side,entry:c.c,stop:S.plan.stop,target:S.plan.target,custom:true};
  var s=S.sig;if(!s||s.dir==='wait')return null;
  var l=E.levels(s.dir,c.c,s.atr,S.params);
  return {side:s.dir,entry:c.c,stop:l.stop,target:l.target,custom:false};
}
function validLevels(side,price,stop,target){
  return isFinite(stop)&&isFinite(target)&&(side==='long'?stop<price&&target>price:stop>price&&target<price);
}
function planError(p){
  if(!p)return 'Sem plano de operação.';
  if(!validLevels(p.side,p.entry,p.stop,p.target))return p.side==='long'?'Na compra, o stop fica abaixo do preço atual e o alvo acima.':'Na venda, o stop fica acima do preço atual e o alvo abaixo.';
  return '';
}
function startPlan(side){
  if(!last())return;
  var l=E.levels(side,last().c,atrNow(),S.params);
  S.plan={side:side,stop:l.stop,target:l.target};
  renderAll();
}
function planSizing(p){return E.sizing(balance(),S.cfg.riskPct,p.entry,p.stop,S.cfg.lev,S.cfg.feePct)}
function planWarnings(p,z){
  var w=[];
  if(z.marginOver)w.push('A margem necessária passa do saldo. Reduza o risco por operação.');
  if(z.stopBeyondLiq)w.push('O stop fica além do preço de liquidação. A posição seria liquidada antes do stop.');
  else if(z.nearLiq)w.push('O stop fica perto da liquidação. Considere alavancagem menor.');
  openTrades().forEach(function(t){if(t.side===p.side&&t.sym!==inst()){w.push('Você já tem '+(t.side==='long'?'compra':'venda')+' aberta em '+t.sym+'. Cripto costuma andar junta, então os riscos se somam.')}});
  return w.filter(function(x,i,a){return a.indexOf(x)===i});
}
function openPlan(){
  var p=plan(),err=planError(p);
  if(err){say(err);return}
  var b=tradeBlock();if(b){say(b);return}
  if(S.trades.some(function(t){return t.status==='open'&&mine(t)})){say('Já existe uma operação aberta neste ativo. Encerre antes de abrir outra.');return}
  var z=planSizing(p);
  if(z.qty<=0){say('Saldo insuficiente para abrir operação.');return}
  if(z.marginOver){say('A margem necessária passa do saldo. Reduza o risco por operação.');return}
  var ex=M.exposure(openTrades(),balance());
  if(ex.risk+z.riskUSD>S.cfg.openRiskPct/100*balance()+1e-9){say('O risco aberto total passaria de '+f1(S.cfg.openRiskPct)+'% do saldo. Encerre uma operação ou reduza o risco.');return}
  pushUndo();
  S.trades.push({id:Date.now()+'-'+Math.floor(Math.random()*1e5),sym:inst(),mode:S.src,tf:S.src==='live'?S.tf:'',side:p.side,entry:p.entry,stop:p.stop,target:p.target,
    qty:z.qty,lev:S.cfg.lev,risk:z.riskUSD,openedAt:Date.now(),openT:S.src==='live'?Date.now():last().t,
    note:$('tkNote').value.trim(),review:'',tags:M.parseTags($('tkTags').value),status:'open'});
  $('tkNote').value='';$('tkTags').value='';S.plan=null;
  save();renderAll();say('Operação simulada aberta.');track('open');
}
function closeAllHere(){
  var mineOpen=S.trades.filter(function(t){return t.status==='open'&&mine(t)});
  if(!mineOpen.length){say('Nenhuma operação aberta neste ativo.');return}
  pushUndo();mineOpen.forEach(function(t){closeTrade(t,last().c,'Manual')});
  save();renderAll();say('Operações encerradas ao preço atual.');
}

/* ---------- dados: simulado, CSV e ao vivo ---------- */
function applyView(){S.candles=(S.src==='csv'&&S.blind)?S.all.slice(0,S.cursor):S.all}
function buildDemo(){var s=SYMS[S.demoSym];S.all=E.genCandles(s.seed,s.base,s.vol,320+(S.advanced[S.demoSym]||0));S.candles=S.all}
function refresh(){
  var cs=S.candles;
  S.base=(S.src==='live'&&S.cfg.closedOnly&&cs.length>80)?cs.slice(0,-1):cs;
  S.ind=E.computeIndicators(S.base,S.params);
  S.sig=E.signalAt(S.base,S.ind,S.base.length-1,S.params);
  S.bt=E.backtest(S.base,S.ind,S.cfg.feePct,S.params);
}
function canReplay(){return S.src==='demo'||(S.src==='csv'&&S.blind)}
function advance(){
  if(!canReplay())return;
  if(S.src==='demo'){S.advanced[S.demoSym]=(S.advanced[S.demoSym]||0)+1;buildDemo()}
  else{if(S.cursor>=S.all.length){say('Fim do arquivo.');setAuto(false);return}S.cursor++;applyView()}
  if(S.off>0)S.off++;
  evaluateOpen();refresh();save();renderAll();
}
function setAuto(on){
  if(on&&!canReplay())on=false;
  S.auto=on;clearInterval(S.timer);S.timer=null;
  if(on)S.timer=setInterval(advance,Math.round(1200/S.speed));
  $('auto').setAttribute('aria-pressed',String(on));$('auto').textContent=on?'Pausar':'Reproduzir';
}
function resetView(){S.hover=null;S.hoverY=null;S.off=0;S.plan=null;S.drag=null;S.pan=null}

function setLiveStatus(state,txt){
  S.live.state=state;
  var cls={live:'live',poll:'poll',off:'off',loading:''}[state]||'';
  $('liveStatus').innerHTML=txt?'<span class="dot '+cls+'"></span>'+esc(txt):'';
}
function stopLive(){
  var l=S.live;
  if(l.ws){l.ws.onopen=l.ws.onmessage=l.ws.onerror=l.ws.onclose=null;try{l.ws.close()}catch(e){}l.ws=null}
  clearInterval(l.poll);l.poll=null;clearTimeout(l.retry);l.retry=null;clearInterval(l.recon);l.recon=null;
}
function leaveLive(){S.live.tok++;stopLive();setLiveStatus('','')}
function onTick(){
  if(S.tickPending)return;
  S.tickPending=true;
  setTimeout(function(){
    S.tickPending=false;
    if(S.src!=='live')return;
    S.candles=S.all;evaluateOpen();refresh();
    if(!document.hidden)renderAll();
  },400);
}
function mergeKlines(cs){cs.forEach(function(k){if(D.applyKline(S.all,k)==='append'&&S.off>0)S.off++})}
function pollOnce(limit){
  var tok=S.live.tok,sym=S.liveSym,tf=S.tf;
  D.fetchKlines(sym,tf,limit||3).then(function(cs){if(tok!==S.live.tok)return;mergeKlines(cs);if(S.live.state==='off')setLiveStatus('poll','Atualizando a cada 5 s');onTick()})
   .catch(function(e){if(tok===S.live.tok)setLiveStatus('off',Narr.friendlyError(e&&e.message).kind==='blocked'?'Binance recusou o acesso':'Sem conexão com a Binance')});
}
function startPoll(){
  if(S.live.poll)return;
  setLiveStatus('poll','Atualizando a cada 5 s');
  S.live.poll=setInterval(function(){pollOnce(3)},5000);pollOnce(3);
}
function openWs(){
  var tok=S.live.tok,ws;
  clearTimeout(S.live.retry);S.live.retry=null;
  try{ws=new WebSocket(D.wsUrl(S.liveSym,S.tf))}catch(e){startPoll();return}
  S.live.ws=ws;
  ws.onopen=function(){if(tok!==S.live.tok)return;var gap=!!S.live.poll;clearInterval(S.live.poll);S.live.poll=null;setLiveStatus('live','Ao vivo');if(gap)pollOnce(100)};
  ws.onmessage=function(ev){
    if(tok!==S.live.tok)return;
    var k=D.klineFromWs(ev.data);if(!k)return;
    var prev=S.all[S.all.length-1];
    if(D.applyKline(S.all,k)==='append'){
      if(S.off>0)S.off++;
      if(prev&&k.t-prev.t>D.TFS[S.tf]*1.5)pollOnce(200); // pulou velas (conexão caiu e voltou): busca o que faltou
    }
    onTick();
  };
  ws.onerror=function(){};
  ws.onclose=function(){
    if(tok!==S.live.tok)return;
    S.live.ws=null;startPoll();
    S.live.retry=setTimeout(function(){if(tok===S.live.tok)openWs()},15000);
  };
}
function connectLive(sym,tf,boot){
  setAuto(false);
  var tok=++S.live.tok;
  setLiveStatus('loading','Carregando '+sym+'…');
  D.fetchKlines(sym,tf,500).then(function(cs){
    if(tok!==S.live.tok)return;
    stopLive();
    S.src='live';S.liveSym=sym;S.tf=tf;S.all=cs;S.candles=cs;resetView();
    refresh();evaluateOpen();save();renderAll();openWs();
    // a cada minuto confere as últimas velas com a Binance, mesmo com o WebSocket ligado (corrige mensagem perdida)
    S.live.recon=setInterval(function(){if(S.src==='live'&&!document.hidden)pollOnce(3)},60000);
    say(boot?'':'Dados ao vivo de '+sym+' carregados.');track('live');
  }).catch(function(err){
    if(tok!==S.live.tok)return;
    $('symLive').value=S.liveSym;$('tf').value=S.tf;
    if(S.src==='live'){setLiveStatus(S.live.ws?'live':'poll',S.live.ws?'Ao vivo':'Atualizando a cada 5 s');say('Não consegui carregar '+sym+'. '+Narr.friendlyError(err.message).text)}
    else{setLiveStatus('off','Sem dados ao vivo');say('Não consegui acessar a Binance. '+Narr.friendlyError(err.message).text+' Seguindo com dados simulados.');renderAll()}
  });
}
function useDemo(){
  setAuto(false);leaveLive();S.src='demo';resetView();buildDemo();refresh();evaluateOpen();save();renderAll();
}
function loadCsvFile(f){
  if(f.size>8*1024*1024){say('Arquivo grande demais. Use até 8 MB.');return}
  var fr=new FileReader();
  fr.onload=function(){
    var r=E.parseCSV(fr.result);if(r.error){say(r.error);return}
    setAuto(false);leaveLive();
    S.src='csv';S.csvName=f.name;S.csvSym=f.name.replace(/\.[^.]+$/,'').toUpperCase().slice(0,16)||'CSV';
    S.all=r.candles;S.cursor=S.blind?Math.min(r.candles.length,Math.max(120,Math.floor(r.candles.length*0.5))):r.candles.length;
    applyView();resetView();refresh();evaluateOpen();save();renderAll();say('Arquivo carregado.');track('csv');
  };
  fr.onerror=function(){say('Não consegui ler o arquivo.')};
  fr.readAsText(f);
}

/* ---------- cabeçalho e textos ---------- */
function renderHeader(){
  var c=last(),p=S.candles[S.candles.length-2],ch=p?(c.c/p.c-1)*100:0;
  $('price').textContent=fmtPrice(c.c);
  var e=$('chg');e.textContent=(ch>=0?'+':'')+ch.toFixed(2).replace('.',',')+'%';e.className='num '+sgn(ch);
  var n=$('srcNote');
  if(S.src==='demo')n.textContent='Preços fictícios gerados aqui para você treinar. Para mercado real, use "Ao vivo" ou importe um CSV de velas.';
  else if(S.src==='live')n.textContent='Preços reais da Binance (mercado à vista em USDT), atualizados em tempo real'+(S.cfg.closedOnly?'. O sinal usa a última vela fechada':'. O sinal usa a vela em formação')+'. Nenhuma ordem real é enviada.';
  else{var a=S.candles[0];n.textContent='Arquivo '+S.csvName+': '+S.all.length.toLocaleString('pt-BR')+' velas'+(isFinite(a.t)&&a.t>1e11?' de '+fmtDate(S.all[0].t)+' a '+fmtDate(last().t):'')+(S.blind?'. Treino cego: mostrando '+S.candles.length.toLocaleString('pt-BR')+' velas, o resto está escondido.':'. Dados estáticos, sem atualização ao vivo.')}
  ['Live','Demo','Csv'].forEach(function(k){$('src'+k).classList.toggle('on',S.src===k.toLowerCase())});
  $('symLiveWrap').hidden=S.src!=='live';$('symWrap').hidden=S.src!=='demo';$('tfWrap').hidden=S.src!=='live';
  $('replayWrap').hidden=!canReplay();$('blindWrap').hidden=S.src!=='csv';
  $('blind').checked=S.blind;
  if(document.activeElement!==$('symLive'))$('symLive').value=S.liveSym;
  $('sym').value=S.demoSym;$('tf').value=S.tf;$('speed').value=String(S.speed);
  $('auto').setAttribute('aria-pressed',String(S.auto));$('auto').textContent=S.auto?'Pausar':'Reproduzir';
  document.title=S.view==='manual'?fmtPrice(c.c)+' · '+inst()+' · Radar de Futuros':'Radar de Futuros';
}

function renderReading(){
  var cs=S.base,i=cs.length-1,ind=S.ind,c=cs[i].c;
  var ef=ind.ef[i],em=ind.em[i],es=ind.es[i],r=ind.rsi[i],a=ind.atr[i],ad=ind.adx[i],va=ind.vavg[i];
  var trend='Sem direção clara',cls='wait';
  if(ef>em&&em>es&&c>em){trend='Alta';cls='long'}else if(ef<em&&em<es&&c<em){trend='Baixa';cls='short'}
  if(isFinite(ad)&&ad<S.params.adxMin){trend='Lateral';cls='wait'}
  var hi=-Infinity,lo=Infinity;for(var k=Math.max(0,cs.length-50);k<cs.length;k++){if(cs[k].h>hi)hi=cs[k].h;if(cs[k].l<lo)lo=cs[k].l}
  var vr=isFinite(va)&&va>0?cs[i].v/va:NaN,s=S.sig;
  var verdict=s.dir==='long'?'Há setup de compra. Veja o sinal abaixo.':s.dir==='short'?'Há setup de venda. Veja o sinal abaixo.':'Aguardar. '+(s.blockers[0]||'');
  $('reading').innerHTML=
   '<div class="big '+cls+'">'+trend+'</div>'+
   '<dl class="kv">'+
   '<dt>Força da tendência (ADX)</dt><dd class="num">'+(isFinite(ad)?ad.toFixed(0)+(ad>=25?' forte':(ad>=20?' moderada':' fraca')):'–')+'</dd>'+
   '<dt>RSI (14)</dt><dd class="num">'+(isFinite(r)?r.toFixed(0):'–')+'</dd>'+
   '<dt>Volume vs média</dt><dd class="num">'+(isFinite(vr)?vr.toFixed(2).replace('.',',')+'x':'–')+'</dd>'+
   '<dt>Volatilidade (ATR)</dt><dd class="num">'+(isFinite(a)?fmtPrice(a)+' ('+(a/c*100).toFixed(2).replace('.',',')+'%)':'–')+'</dd>'+
   '<dt>Resistência (50 velas)</dt><dd class="num">'+fmtPrice(hi)+'</dd>'+
   '<dt>Suporte (50 velas)</dt><dd class="num">'+fmtPrice(lo)+'</dd></dl>'+
   (isFinite(r)?'<div class="gauge" aria-hidden="true"><b style="left:30%"></b><b style="left:70%"></b><i style="left:calc('+Math.min(100,Math.max(0,r)).toFixed(1)+'% - 1px)"></i></div>':'')+
   '<div class="verdict">'+esc(verdict)+'</div>';
}

function renderSignal(){
  var s=S.sig,word=s.dir==='long'?'COMPRA':(s.dir==='short'?'VENDA':'AGUARDAR');
  var h='<div class="big '+(s.dir==='wait'?'wait':s.dir)+'">'+word+'</div>';
  if(s.dir!=='wait'){
    var p=plan(),z=planSizing(p),loss=z.dist*z.qty+z.feesUSD,gain=Math.abs(p.target-p.entry)*z.qty-z.feesUSD;
    h+='<dl class="kv"><dt>Entrada (preço atual)</dt><dd class="num">'+fmtPrice(p.entry)+'</dd>'+
      '<dt>Stop</dt><dd class="num neg">'+fmtPrice(p.stop)+'</dd>'+
      '<dt>Alvo</dt><dd class="num pos">'+fmtPrice(p.target)+'</dd>'+
      '<dt>Retorno para risco</dt><dd class="num">'+f1(Math.abs(p.target-p.entry)/z.dist)+' : 1</dd>'+
      '<dt>Se bater o stop</dt><dd class="num neg">−'+fmt2(loss)+' USDT</dd>'+
      '<dt>Se bater o alvo</dt><dd class="num pos">+'+fmt2(gain)+' USDT</dd></dl>';
  }
  if(s.reasons.length)h+='<ul class="list">'+s.reasons.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>';
  if(s.blockers.length)h+='<ul class="list block">'+s.blockers.map(function(x){return '<li>'+esc(x)+'</li>'}).join('')+'</ul>';
  if(s.dir!=='wait'){
    var b=tradeBlock();
    h+='<button class="btn primary" type="button" data-act="open"'+(b?' disabled':'')+'>Abrir operação simulada</button>'+(b?'<div class="warnbox">'+esc(b)+'</div>':'');
  }
  $('signal').innerHTML=h;
}

function holdInfo(){
  var tr=S.bt.trades.filter(function(t){return t.why!=='fim dos dados'});if(tr.length<3)return null;
  var d=tr.map(function(t){return t.j-t.i}).sort(function(a,b){return a-b}),m=d[Math.floor(d.length/2)];
  var cs=S.candles,dts=[];for(var k=Math.max(1,cs.length-50);k<cs.length;k++){var x=cs[k].t-cs[k-1].t;if(isFinite(x)&&x>0)dts.push(x)}
  dts.sort(function(a,b){return a-b});var dt=dts.length?dts[Math.floor(dts.length/2)]:NaN;
  return {bars:m,n:tr.length,ms:isFinite(dt)?m*dt:NaN};
}
function renderQuick(){
  var p=plan(),el=$('quick'),s=S.sig,h;
  var long=p&&p.side==='long',word=!p?'AGUARDAR':(long?'COMPRAR':'VENDER'),cls=!p?'wait':p.side,txt;
  if(p&&!p.custom)txt=(long?'Tendência de alta':'Tendência de baixa')+' com força e volume a favor. '+(long?'Compre':'Venda')+' perto de '+fmtPrice(p.entry)+'. Se o preço '+(long?'cair':'subir')+' até '+fmtPrice(p.stop)+', encerre a operação para limitar a perda. Realize o lucro em '+fmtPrice(p.target)+'.';
  else if(p)txt='Plano manual: '+(long?'compra':'venda')+' perto de '+fmtPrice(p.entry)+', stop em '+fmtPrice(p.stop)+' e alvo em '+fmtPrice(p.target)+'. Ajuste as linhas no gráfico se quiser.';
  else txt='Sem boa oportunidade agora. '+(s.blockers[0]?s.blockers[0]+'. ':'')+'Ficar de fora também é uma decisão válida.';
  h='<div class="qtop"><div class="qword '+cls+'">'+word+(p&&p.custom?' <span class="note">(manual)</span>':'')+'</div><span class="note">'+esc(inst())+' · '+fmtPrice(last().c)+'</span></div><p class="qtext">'+esc(txt)+'</p>';
  if(p){
    var z=planSizing(p),hi=holdInfo(),b=tradeBlock(),err=planError(p);
    h+='<div class="qgrid">'+
      '<div class="stat"><span>Entrada</span><b>'+fmtPrice(p.entry)+'</b></div>'+
      '<div class="stat"><span>Stop (limite da perda)</span><b class="neg">'+fmtPrice(p.stop)+'</b></div>'+
      '<div class="stat"><span>Alvo (lucro)</span><b class="pos">'+fmtPrice(p.target)+'</b></div>'+
      '<div class="stat"><span>Valor da posição</span><b>'+fmt2(z.notional)+' USDT</b></div>'+
      '<div class="stat"><span>Você arrisca</span><b>'+fmt2(z.riskUSD)+' USDT</b></div></div>';
    if(!p.custom)h+='<p class="qtime">'+(hi?'Quanto tempo: neste histórico, operações parecidas terminaram (no stop ou no alvo) em geral em '+hi.bars+' velas'+(isFinite(hi.ms)?', cerca de '+fmtDur(hi.ms):'')+', com base em '+hi.n+' casos. Se passar do dobro disso sem chegar perto do alvo, reavalie.':'Quanto tempo: o histórico carregado é curto para estimar a duração.')+'</p>';
    if(err)h+='<div class="warnbox">'+esc(err)+'</div>';
    planWarnings(p,z).forEach(function(w){h+='<div class="warnbox">'+esc(w)+'</div>'});
    if(b)h+='<div class="warnbox">'+esc(b)+'</div>';
    h+='<div><button class="btn primary" type="button" data-act="open"'+(b||err||z.marginOver?' disabled':'')+'>Abrir operação simulada</button></div>';
  }else h+='<p class="qtime">Quanto tempo: volte a olhar a cada vela nova. Quando surgir um sinal, ele aparece aqui com entrada, stop, alvo e duração típica. Prefere decidir sozinho? Use Comprar ou Vender no cartão Ordem.</p>';
  h+='<p class="qfoot">É uma estimativa por regras, não uma certeza de resultado. Use sempre o stop.</p>';
  el.innerHTML=h;
}

function renderTicket(){
  var p=plan(),c=last();
  var buy=$('tkBuy'),sell=$('tkSell');
  buy.classList.toggle('on',!!(S.plan&&S.plan.side==='long'));sell.classList.toggle('on',!!(S.plan&&S.plan.side==='short'));
  $('tkFollow').disabled=!S.plan;
  $('tkEntry').value=fmtPrice(c.c);
  [['tkStop','stop'],['tkTarget','target']].forEach(function(a){var el=$(a[0]);el.disabled=!p;if(document.activeElement!==el)el.value=p?rawPrice(p[a[1]]):''});
  $('tkHint').textContent=p?(p.custom?'Plano manual de '+(p.side==='long'?'compra':'venda')+'. "Seguir o sinal" volta ao plano automático.':'Seguindo o sinal de '+(p.side==='long'?'compra':'venda')+'. Ajuste stop e alvo se quiser.'):'Sem sinal agora. Use Comprar ou Vender para montar uma operação manual com stop e alvo.';
  var h='',b=tradeBlock(),err=p?planError(p):'';
  if(p){var z=planSizing(p);
    h+='<dl class="kv"><dt>Você arrisca</dt><dd class="num">'+fmt2(z.riskUSD)+' USDT</dd><dt>Posição</dt><dd class="num">'+fmtQty(z.qty)+' ('+fmt2(z.notional)+' USDT)</dd><dt>Liquidação aprox.</dt><dd class="num">'+fmtPrice(z.liqPrice)+'</dd></dl>';
    if(err)h+='<div class="warnbox">'+esc(err)+'</div>';
    planWarnings(p,z).forEach(function(w){h+='<div class="warnbox">'+esc(w)+'</div>'});
  }
  if(b)h+='<div class="warnbox">'+esc(b)+'</div>';
  $('tkInfo').innerHTML=h;
  $('tkOpen').disabled=!p||!!err||!!b;
}

function meter(label,used,lim){
  var pct=Math.min(100,Math.max(0,lim>0?used/lim*100:0));
  return '<div><div class="note">'+label+'</div><div class="meter" role="img" aria-label="'+esc(label)+'"><span style="width:'+pct.toFixed(0)+'%"></span></div></div>';
}
function renderSizing(){
  var p=plan(),c=last().c,entry,stop,ex=false;
  if(p){entry=p.entry;stop=p.stop}else{entry=c;stop=c-S.params.stopAtr*atrNow();ex=true}
  var z=E.sizing(balance(),S.cfg.riskPct,entry,stop,S.cfg.lev,S.cfg.feePct);
  var h='<dl class="kv"><dt>Saldo simulado</dt><dd class="num">'+fmt2(balance())+' USDT</dd>'+
    '<dt>Risco nesta operação</dt><dd class="num">'+fmt2(z.riskUSD)+' USDT</dd>'+
    '<dt>Tamanho</dt><dd class="num">'+fmtQty(z.qty)+'</dd>'+
    '<dt>Valor da posição</dt><dd class="num">'+fmt2(z.notional)+' USDT</dd>'+
    '<dt>Margem necessária</dt><dd class="num">'+fmt2(z.margin)+' USDT</dd>'+
    '<dt>Distância até o stop</dt><dd class="num">'+z.distPct.toFixed(2).replace('.',',')+'%</dd>'+
    '<dt>Preço de liquidação aprox.</dt><dd class="num">'+fmtPrice(z.liqPrice)+' ('+f1(z.liqPct)+'% contra você)</dd></dl>';
  if(ex)h+='<p class="note">Exemplo de compra com stop de '+f1(S.params.stopAtr)+' ATR, já que não há plano agora.</p>';
  if(z.marginOver)h+='<div class="warnbox">A margem passa do saldo. Reduza o risco por operação.</div>';
  if(z.stopBeyondLiq)h+='<div class="warnbox">O stop fica além da liquidação. A posição seria liquidada antes do stop.</div>';
  else if(z.nearLiq)h+='<div class="warnbox">O stop fica perto da liquidação. Com essa alavancagem a posição pode ser liquidada antes do stop.</div>';
  if(S.cfg.lev>10)h+='<div class="warnbox">Alavancagem alta. Uma oscilação pequena já liquida a posição.</div>';
  $('sizing').innerHTML=h;
}
function renderRisk(){
  var ex=M.exposure(openTrades(),balance()),d=-todayPnl(),w=-weekPnl(),left=pauseLeft(),ls=M.lossStreak(S.trades),h='';
  h+='<dl class="kv"><dt>Valor aberto</dt><dd class="num">'+fmt2(ex.notional)+' USDT ('+f1(ex.leverage)+'x do saldo)</dd>'+
    '<dt>Margem usada</dt><dd class="num">'+fmt2(ex.margin)+' USDT ('+f1(ex.marginPct)+'%)</dd>'+
    '<dt>Risco até os stops</dt><dd class="num">'+fmt2(ex.risk)+' USDT ('+f1(ex.riskPct)+'%)</dd>'+
    '<dt>Perdas seguidas</dt><dd class="num">'+ls.count+'</dd></dl>';
  h+=meter('Risco aberto: '+f1(ex.riskPct)+'% de '+f1(S.cfg.openRiskPct)+'%',ex.risk,S.cfg.openRiskPct/100*balance());
  if(ex.riskPct>S.cfg.openRiskPct)h+='<div class="warnbox">Risco aberto acima do limite de '+f1(S.cfg.openRiskPct)+'%.</div>';
  ex.corr.forEach(function(c){h+='<div class="warnbox">Várias '+(c.side==='long'?'compras':'vendas')+' abertas ('+esc(c.syms.join(', '))+'). Cripto costuma andar junta, então na prática é uma aposta maior só.</div>'});
  h+=meter('Perda de hoje: '+fmt2(Math.max(0,d))+' de '+fmt2(dailyLimitUSD())+' USDT',Math.max(0,d),dailyLimitUSD());
  h+=meter('Perda da semana: '+fmt2(Math.max(0,w))+' de '+fmt2(weeklyLimitUSD())+' USDT',Math.max(0,w),weeklyLimitUSD());
  if(left>0)h+='<div class="warnbox">Em pausa por '+ls.count+' perdas seguidas. Volta em '+fmtDur(left)+'.</div>';
  $('riskStatus').innerHTML=h;
}

/* ---------- operações abertas e diário ---------- */
function renderTrades(){
  var c=last(),open=openTrades(),h='';
  if(!open.length)h='<div class="empty">Nenhuma operação aberta.</div>';
  else{
    h='<div class="tablewrap"><table><thead><tr><th class="l">Ativo</th><th class="l">Lado</th><th class="r">Entrada</th><th class="r">Stop</th><th class="r">Alvo</th><th class="r">Resultado agora</th><th></th></tr></thead><tbody>'+
    open.map(function(t){
      var here=mine(t),u=(c.c-t.entry)*t.qty*(t.side==='long'?1:-1),arm=S.cancelArm===t.id;
      return '<tr><td class="l">'+esc(t.sym)+(t.mode==='live'?' <span class="tag">ao vivo</span>':'')+'</td><td class="l '+t.side+'">'+(t.side==='long'?'Compra':'Venda')+'</td><td class="r">'+fmtPrice(t.entry)+'</td><td class="r">'+fmtPrice(t.stop)+'</td><td class="r">'+fmtPrice(t.target)+'</td>'+
      '<td class="r '+(here?sgn(u):'')+'">'+(here?fmtSigned(u):'aguardando este ativo')+'</td><td class="r acts">'+(here?'<button class="btn" type="button" data-close="'+esc(t.id)+'" title="Fecha ao preço atual e registra o resultado">Encerrar</button> ':'')+'<button class="btn danger" type="button" data-cancel="'+esc(t.id)+'" title="Desfaz a operação como se nunca tivesse aberto, sem registrar resultado">'+(arm?'Confirmar?':'Cancelar')+'</button></td></tr>';
    }).join('')+'</tbody></table></div>';
  }
  if(open.some(mine))h+='<div class="trade-actions"><button id="closeAll" class="btn" type="button" title="E">Encerrar todas deste ativo</button><span class="note">Encerrar = fecha ao preço atual e registra o resultado. Cancelar = desfaz sem registrar nada.</span></div>';
  $('openWrap').innerHTML=h;
  var cl=closed(),n=cl.length,sm=M.summarize(S.trades,S.cfg.capital),tot=sm.total;
  var pf=sm.pf>0&&isFinite(sm.pf)?sm.pf.toFixed(2).replace('.',','):(sm.pf===Infinity?'∞':'–');
  $('stats').innerHTML=
   '<div class="stat"><span>Operações fechadas</span><b>'+n+'</b></div>'+
   '<div class="stat"><span>Taxa de acerto</span><b>'+(n?sm.winRate.toFixed(0)+'%':'–')+'</b></div>'+
   '<div class="stat"><span>Resultado total</span><b class="'+sgn(tot)+'">'+(n?fmtSigned(tot):'–')+'</b></div>'+
   '<div class="stat"><span>Média por operação</span><b class="'+sgn(tot)+'">'+(n?fmtSigned(sm.avg):'–')+'</b></div>'+
   '<div class="stat"><span>Fator de lucro</span><b>'+(n?pf:'–')+'</b></div>';
}

function uniq(list){var s={};return list.filter(function(x){if(!x||s[x])return false;s[x]=1;return true}).sort()}
function setOptions(sel,first,vals,cur){
  var key=vals.join('|');
  if(sel.getAttribute('data-k')===key)return;
  sel.setAttribute('data-k',key);
  sel.innerHTML='<option value="">'+first+'</option>'+vals.map(function(v){return '<option>'+esc(v)+'</option>'}).join('');
  sel.value=vals.indexOf(cur)>=0?cur:'';
}
function filteredClosed(){
  var f=S.f;
  return closed().filter(function(t){
    return (!f.sym||t.sym===f.sym)&&(!f.res||(f.res==='win'?t.pnl>0:t.pnl<=0))&&(!f.side||t.side===f.side)&&(!f.reason||t.reason===f.reason)&&(!f.tag||(t.tags||[]).indexOf(f.tag)>=0);
  }).sort(function(a,b){return b.closedAt-a.closedAt});
}
function renderDiary(force){
  var wrap=$('histWrap');
  if(!force&&wrap.contains(document.activeElement)&&document.activeElement.tagName==='INPUT')return;
  var all=closed(),tags=uniq([].concat.apply([],all.map(function(t){return t.tags||[]})));
  setOptions($('fSym'),'Todos',uniq(all.map(function(t){return t.sym})),S.f.sym);
  setOptions($('fTag'),'Todas',tags,S.f.tag);
  $('tagList').innerHTML=tags.map(function(t){return '<option value="'+esc(t)+'">'}).join('');
  var list=filteredClosed(),shown=list.slice(0,S.diaryN);
  if(!all.length){wrap.innerHTML='<div class="empty">O diário aparece aqui. Com menos de 30 operações, o resultado ainda diz pouco sobre a estratégia.</div>';return}
  if(!list.length){wrap.innerHTML='<div class="empty">Nenhuma operação com esses filtros.</div>';return}
  wrap.innerHTML='<div class="tablewrap"><table><thead><tr><th class="l">Fechada em</th><th class="l">Ativo</th><th class="l">Lado</th><th class="r">Entrada</th><th class="r">Saída</th><th class="r">Resultado</th><th class="r">R</th><th class="l">Saída por</th><th class="l">Tags</th><th class="l">Motivo da entrada</th><th class="l">Nota pós-trade</th></tr></thead><tbody>'+
   shown.map(function(t){
     var id=esc(t.id);
     return '<tr><td class="l">'+fmtDate(t.closedAt)+'</td><td class="l">'+esc(t.sym)+'</td><td class="l '+t.side+'">'+(t.side==='long'?'Compra':'Venda')+'</td><td class="r">'+fmtPrice(t.entry)+'</td><td class="r">'+fmtPrice(t.exit)+'</td><td class="r '+sgn(t.pnl)+'">'+fmtSigned(t.pnl)+'</td><td class="r">'+(t.risk>0?fmtSigned(t.pnl/t.risk):'–')+'</td><td class="l">'+esc(t.reason)+'</td>'+
      '<td class="l"><input type="text" data-tags="'+id+'" value="'+esc((t.tags||[]).join(', '))+'" maxlength="60" aria-label="Tags"></td>'+
      '<td class="l"><input type="text" data-note="'+id+'" value="'+esc(t.note)+'" maxlength="120" aria-label="Motivo da entrada"></td>'+
      '<td class="l"><input type="text" data-review="'+id+'" value="'+esc(t.review)+'" maxlength="300" placeholder="O que aprendi?" aria-label="Nota pós-trade"></td></tr>';
   }).join('')+'</tbody></table></div>'+
   '<div class="toolrow"><span class="note">Mostrando '+shown.length+' de '+list.length+'.</span>'+(list.length>shown.length?'<button class="btn" type="button" data-more="1">Mostrar mais</button>':'')+'</div>';
}

/* ---------- desempenho ---------- */
function sparkSVG(series,opts){
  opts=opts||{};
  var w=600,h=opts.h||90,pad=6,all=[].concat.apply([],series.map(function(s){return s.v}));
  if(opts.base!=null)all.push(opts.base);
  var mn=Math.min.apply(null,all),mx=Math.max.apply(null,all);if(mx===mn){mx+=1;mn-=1}
  var len=Math.max.apply(null,series.map(function(s){return s.v.length}));
  var X=function(i){return pad+i/(len-1||1)*(w-2*pad)},Y=function(v){return pad+(mx-v)/(mx-mn)*(h-2*pad)};
  var out='<svg class="spark" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(opts.label||'Curva')+'">';
  if(opts.base!=null)out+='<line x1="'+pad+'" x2="'+(w-pad)+'" y1="'+Y(opts.base).toFixed(1)+'" y2="'+Y(opts.base).toFixed(1)+'" stroke="var(--line)" stroke-dasharray="4 4" fill="none"/>';
  series.forEach(function(s){
    var d=s.v.map(function(v,i){return (i?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1)}).join(' ');
    out+='<path d="'+d+'" fill="none" stroke="'+s.color+'" stroke-width="'+(s.w||2)+'" stroke-linejoin="round"'+(s.dim?' opacity=".7"':'')+'/>';
    if(s.dot)out+='<circle cx="'+X(s.v.length-1).toFixed(1)+'" cy="'+Y(s.v[s.v.length-1]).toFixed(1)+'" r="3.5" fill="'+s.color+'"/>';
  });
  return out+'</svg>';
}
function breakTable(title,groups,sortKey){
  if(!groups.length)return '';
  if(sortKey==='key')groups.sort(function(a,b){return a.key<b.key?-1:1});else groups.sort(function(a,b){return b.pnl-a.pnl});
  var mx=Math.max.apply(null,groups.map(function(g){return Math.abs(g.pnl)}))||1;
  return '<div><h2>'+title+'</h2><div class="tablewrap"><table><thead><tr><th class="l"></th><th class="r">Ops</th><th class="r">Acerto</th><th class="r">Resultado</th></tr></thead><tbody>'+
   groups.slice(0,12).map(function(g){return '<tr><td class="l">'+esc(g.key)+'</td><td class="r">'+g.n+'</td><td class="r">'+g.winRate.toFixed(0)+'%</td><td class="r bar-cell"><i class="'+(g.pnl>=0?'p':'n')+'" style="width:'+(Math.abs(g.pnl)/mx*100).toFixed(0)+'%"></i><span class="'+sgn(g.pnl)+'">'+fmtSigned(g.pnl)+'</span></td></tr>'}).join('')+'</tbody></table></div></div>';
}
function renderPerf(){
  var sm=M.summarize(S.trades,S.cfg.capital),n=sm.n;
  if(!n){$('perfStats').innerHTML='<div class="empty">As métricas aparecem depois da primeira operação fechada.</div>';$('perfCurve').innerHTML='';$('perfBreak').innerHTML='';return}
  var st=function(l,v,c){return '<div class="stat"><span>'+l+'</span><b'+(c?' class="'+c+'"':'')+'>'+v+'</b></div>'};
  var pf=sm.pf===Infinity?'∞':fmt2(sm.pf);
  $('perfStats').innerHTML=
    st('Resultado total',fmtSigned(sm.total),sgn(sm.total))+st('Expectativa por operação',fmtSigned(sm.expectancy),sgn(sm.expectancy))+
    st('Taxa de acerto',sm.winRate.toFixed(0)+'%')+st('Fator de lucro',pf)+
    st('Ganho médio',fmtSigned(sm.avgWin),'pos')+st('Perda média','−'+fmt2(sm.avgLoss),'neg')+
    st('Maior queda',fmt2(sm.maxDD)+' ('+f1(sm.maxDDPct)+'%)')+st('R médio',isFinite(sm.avgR)?fmtSigned(sm.avgR):'–')+
    st('Melhor / pior',fmtSigned(sm.best)+' / '+fmtSigned(sm.worst))+st('Maiores sequências',sm.maxWinStreak+' ganhos · '+sm.maxLossStreak+' perdas');
  $('perfCurve').innerHTML=(n<30?'<p class="note">Com '+n+' operações a amostra ainda é pequena. Evite concluir muito.</p>':'')+
    sparkSVG([{v:sm.curve,color:'var(--accent)',dot:true}],{base:S.cfg.capital,h:110,label:'Curva de saldo simulado'});
  var G=M.groupBy;
  $('perfBreak').innerHTML=breakTable('Por lado',G(S.trades,M.by.side))+breakTable('Por saída',G(S.trades,M.by.reason))+breakTable('Por ativo',G(S.trades,M.by.sym))+
    breakTable('Por tag (setup)',G(S.trades,M.by.tag))+breakTable('Por hora de entrada',G(S.trades,M.by.hour),'key')+breakTable('Por dia da semana',G(S.trades,M.by.weekday));
}

/* ---------- estratégia, backtest e comparação ---------- */
function presetList(){
  var list=Object.keys(E.PRESETS).map(function(k){return {id:k,name:E.PRESETS[k].name,p:E.normParams(E.PRESETS[k].p),builtin:true}});
  Object.keys(S.custom).forEach(function(k){list.push({id:k,name:S.custom[k].name,p:S.custom[k].p})});
  return list;
}
function sameParams(a,b){return Object.keys(E.DEFAULTS).every(function(k){return a[k]===b[k]})}
function matchPreset(){var m=presetList().filter(function(x){return sameParams(x.p,S.params)})[0];S.presetId=m?m.id:'edit'}
function cachedBacktest(p){
  var key=JSON.stringify(p)+'|'+S.cfg.feePct+'|'+S.base.length+'|'+(S.base.length?S.base[S.base.length-1].t:0)+'|'+S.src+inst();
  if(S.cmpCache[key])return S.cmpCache[key];
  if(Object.keys(S.cmpCache).length>60)S.cmpCache={};
  var ind=E.computeIndicators(S.base,p);return (S.cmpCache[key]=E.backtest(S.base,ind,S.cfg.feePct,p));
}
function renderStrategy(){
  var b=S.bt,f=function(x){return x.toFixed(2).replace('.',',')};
  $('btNote').textContent=S.src==='demo'
    ?'Dados simulados servem para testar o painel, não a estratégia. Use "Ao vivo" ou importe um CSV de mercado real para um teste de verdade. Resultado passado não garante resultado futuro.'
    :'Teste das regras ativas sobre as velas carregadas, com a taxa informada. Resultado passado não garante resultado futuro.';
  var sel=$('preset'),opts=presetList().map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>'}).join('')+(S.presetId==='edit'?'<option value="edit">Editada (não salva)</option>':'');
  if(sel.getAttribute('data-k')!==opts){sel.setAttribute('data-k',opts);sel.innerHTML=opts}
  sel.value=S.presetId;
  Object.keys(PARAM_IN).forEach(function(id){var el=$(id);if(document.activeElement!==el)el.value=S.params[PARAM_IN[id]]});
  $('presetDel').disabled=!S.custom[S.presetId];
  $('lgF').textContent='Média '+S.params.emaF;$('lgM').textContent='Média '+S.params.emaM;$('lgS').textContent='Média '+S.params.emaS;
  if(!b.n){$('btStats').innerHTML='<div class="empty">Nenhum sinal nas velas carregadas.</div>';$('btSpark').innerHTML=''}
  else{
    $('btStats').innerHTML=
     '<div class="stat"><span>Operações</span><b>'+b.n+'</b></div>'+
     '<div class="stat"><span>Taxa de acerto</span><b>'+b.winRate.toFixed(0)+'%</b></div>'+
     '<div class="stat"><span>Resultado (em R)</span><b class="'+sgn(b.totalR)+'">'+(b.totalR>0?'+':'')+f(b.totalR)+'</b></div>'+
     '<div class="stat"><span>Média por operação (R)</span><b class="'+sgn(b.avgR)+'">'+(b.avgR>0?'+':'')+f(b.avgR)+'</b></div>'+
     '<div class="stat"><span>Fator de lucro</span><b>'+(isFinite(b.pf)?f(b.pf):'∞')+'</b></div>'+
     '<div class="stat"><span>Maior queda (R)</span><b>'+f(b.maxDD)+'</b></div>';
    $('btSpark').innerHTML=sparkSVG([{v:b.curve,color:'var(--accent)',dot:true}],{base:0,label:'Curva de resultado acumulado em R'});
  }
  var vis=$('stratCard').open&&!document.body.classList.contains('simple');
  if(!vis){return}
  var list=presetList();if(S.presetId==='edit')list.push({id:'edit',name:'Editada',p:S.params});
  var rows=list.map(function(x,i){return {x:x,r:cachedBacktest(x.p),color:LINE_COLORS[i%LINE_COLORS.length]}});
  $('cmpWrap').innerHTML='<div class="legend2">'+rows.map(function(o){return '<span><i style="background:'+o.color+'"></i>'+esc(o.x.name)+'</span>'}).join('')+'</div>'+
   sparkSVG(rows.map(function(o){return {v:o.r.curve,color:o.color,w:o.x.id===S.presetId?2.6:1.4,dim:o.x.id!==S.presetId}}),{base:0,h:120,label:'Comparação das curvas de resultado em R'})+
   '<div class="tablewrap"><table><thead><tr><th class="l">Estratégia</th><th class="r">Ops</th><th class="r">Acerto</th><th class="r">Resultado (R)</th><th class="r">Fator de lucro</th><th class="r">Maior queda (R)</th></tr></thead><tbody>'+
   rows.map(function(o){var r=o.r;return '<tr class="'+(o.x.id===S.presetId?'activeRow':'')+'"><td class="l">'+esc(o.x.name)+'</td><td class="r">'+r.n+'</td><td class="r">'+(r.n?r.winRate.toFixed(0)+'%':'–')+'</td><td class="r '+sgn(r.totalR)+'">'+(r.n?fmtSigned(r.totalR):'–')+'</td><td class="r">'+(r.n?(isFinite(r.pf)?f(r.pf):'∞'):'–')+'</td><td class="r">'+f(r.maxDD)+'</td></tr>'}).join('')+'</tbody></table></div>';
}
function renderHow(){
  var P=S.params;
  $('howList').innerHTML=
   '<li>Tendência (2 pontos): médias exponenciais de '+P.emaF+', '+P.emaM+' e '+P.emaS+' velas alinhadas e preço do lado certo da média de '+P.emaM+'.</li>'+
   '<li>Inclinação (1 ponto): média de '+P.emaS+' subindo ou caindo em relação a 10 velas atrás.</li>'+
   '<li>RSI (1 ponto): entre 50 e 68 para compra, entre 32 e 50 para venda.</li>'+
   '<li>Rompimento (1 ponto): fechamento acima da máxima ou abaixo da mínima das 20 velas anteriores.</li>'+
   '<li>Volume (1 ponto): vela com volume 20% acima da média de 20 velas, a favor da direção.</li>'+
   '<li>Só há sinal com '+P.minScore+' pontos ou mais, ADX de 14 períodos a partir de '+P.adxMin+' e RSI sem exagero (compra até 72, venda a partir de 28).</li>'+
   '<li>Stop a '+f1(P.stopAtr)+' ATR da entrada e alvo a '+f1(P.stopAtr*P.rr)+' ATR, retorno de '+f1(P.rr)+' para 1. A operação simulada fecha no que vier primeiro. Se stop e alvo caírem na mesma vela, vale o stop.</li>'+
   '<li>São regras de partida para você testar e ajustar. Elas não garantem resultado.</li>';
}

/* ---------- gráfico ---------- */
function drawChart(){
  var cv=$('chart'),w=cv.clientWidth,h=cv.clientHeight;if(!w||!h||!S.candles.length||!S.ind)return;
  var dpr=window.devicePixelRatio||1;cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);
  var g=cv.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,w,h);
  var cs=S.candles,ind=S.ind,css=getComputedStyle(document.documentElement),col=function(n){return css.getPropertyValue(n).trim()};
  var maxOff=Math.max(0,cs.length-20);S.off=clamp(S.off,0,maxOff);
  var end=cs.length-S.off,N=Math.min(S.viewN,end),start=end-N;
  var padL=6,padR=78,padT=10,padB=22,pw=w-padL-padR,ph=h-padT-padB,volH=ph*0.14,priceH=ph-volH-6;
  var lo=Infinity,hi=-Infinity,vmax=0,i;
  for(i=start;i<end;i++){if(cs[i].l<lo)lo=cs[i].l;if(cs[i].h>hi)hi=cs[i].h;if(cs[i].v>vmax)vmax=cs[i].v}
  var p=plan(),pz=p?planSizing(p):null,mineOpen=S.trades.filter(function(t){return t.status==='open'&&mine(t)});
  if(S.off===0){
    if(p){lo=Math.min(lo,p.stop,p.target);hi=Math.max(hi,p.stop,p.target)}
    mineOpen.forEach(function(t){lo=Math.min(lo,t.stop,t.target);hi=Math.max(hi,t.stop,t.target)});
  }
  var pad=(hi-lo)*0.05||1;lo-=pad;hi+=pad;
  var y=function(v){return padT+(hi-v)/(hi-lo)*priceH},step=pw/N,x=function(i){return padL+(i-start+0.5)*step};
  S.layout={start:start,end:end,N:N,padL:padL,padT:padT,priceH:priceH,lo:lo,hi:hi,step:step,pw:pw,maxOff:maxOff};
  S.hit=[];
  g.font='11px "IBM Plex Mono",ui-monospace,monospace';g.textBaseline='middle';g.textAlign='left';
  var k;for(k=0;k<=5;k++){var pr=lo+(hi-lo)*k/5,yy=Math.round(y(pr))+0.5;g.strokeStyle=col('--grid');g.lineWidth=1;g.beginPath();g.moveTo(padL,yy);g.lineTo(padL+pw,yy);g.stroke();g.fillStyle=col('--muted');g.fillText(fmtPrice(pr),padL+pw+6,yy)}
  var rh=-Infinity,rl=Infinity;for(i=Math.max(0,cs.length-50);i<cs.length;i++){if(cs[i].h>rh)rh=cs[i].h;if(cs[i].l<rl)rl=cs[i].l}
  g.setLineDash([2,4]);g.strokeStyle=col('--muted');g.fillStyle=col('--muted');g.textBaseline='bottom';
  [[rh,'Resistência'],[rl,'Suporte']].forEach(function(a){if(a[0]<lo||a[0]>hi)return;var yy=Math.round(y(a[0]))+0.5;g.beginPath();g.moveTo(padL,yy);g.lineTo(padL+pw,yy);g.stroke();g.fillText(a[1],padL+4,yy-3)});
  g.setLineDash([]);
  var vb=padT+priceH+6+volH;g.globalAlpha=0.35;
  for(i=start;i<end;i++){g.fillStyle=cs[i].c>=cs[i].o?col('--up'):col('--down');var vh=vmax?cs[i].v/vmax*volH:0;g.fillRect(x(i)-step*0.31,vb-vh,step*0.62,vh)}
  g.globalAlpha=1;
  [['ef','--ema9'],['em','--ema21'],['es','--ema50']].forEach(function(m){var arr=ind[m[0]],on=false;g.strokeStyle=col(m[1]);g.lineWidth=1.4;g.beginPath();
    for(var j=start;j<end;j++){if(j>=arr.length||!isFinite(arr[j])){on=false;continue}if(!on){g.moveTo(x(j),y(arr[j]));on=true}else g.lineTo(x(j),y(arr[j]))}g.stroke()});
  var bw=Math.max(1,step*0.62);g.lineWidth=1;
  for(i=start;i<end;i++){var c=cs[i],up=c.c>=c.o,cc=up?col('--up'):col('--down');g.strokeStyle=cc;g.fillStyle=cc;
    g.beginPath();g.moveTo(Math.round(x(i))+0.5,y(c.h));g.lineTo(Math.round(x(i))+0.5,y(c.l));g.stroke();
    var yo=y(c.o),yc=y(c.c);g.fillRect(x(i)-bw/2,Math.min(yo,yc),bw,Math.max(1,Math.abs(yo-yc)))}
  function hline(price,label,color,dash,drag){
    if(!isFinite(price)||price<lo||price>hi)return;
    var yy=Math.round(y(price))+0.5;
    g.setLineDash(dash);g.strokeStyle=col(color);g.fillStyle=col(color);g.lineWidth=1;g.beginPath();g.moveTo(padL,yy);g.lineTo(padL+pw,yy);g.stroke();
    g.textAlign='right';g.textBaseline='bottom';g.fillText(label,padL+pw-(drag?20:4),yy-3);
    if(drag){g.setLineDash([]);g.fillRect(padL+pw-15,yy-4,11,8);S.hit.push({y:yy,kind:drag.kind,id:drag.id,field:drag.field})}
    g.setLineDash([]);
  }
  if(p){
    hline(p.entry,'Entrada','--fg',[6,4]);
    hline(p.stop,'Stop','--down',[6,4],{kind:'plan',field:'stop'});
    hline(p.target,'Alvo','--up',[6,4],{kind:'plan',field:'target'});
    hline(pz.liqPrice,'Liquidação','--warn',[2,3]);
  }
  mineOpen.forEach(function(t){
    hline(t.entry,'Op. entrada','--accent',[]);
    hline(t.stop,'Op. stop','--down',[],{kind:'trade',id:t.id,field:'stop'});
    hline(t.target,'Op. alvo','--up',[],{kind:'trade',id:t.id,field:'target'});
  });
  g.textAlign='left';g.textBaseline='middle';
  var lc=cs[cs.length-1];
  if(S.off===0&&lc.c>=lo&&lc.c<=hi){var yl=y(lc.c);g.fillStyle=lc.c>=lc.o?col('--up'):col('--down');g.fillRect(padL+pw+1,yl-9,padR-2,18);g.fillStyle=col('--tag-ink');g.fillText(fmtPrice(lc.c),padL+pw+5,yl)}
  g.fillStyle=col('--muted');g.textBaseline='alphabetic';g.textAlign='center';
  if(isFinite(cs[start].t)){for(k=0;k<5;k++){var ix=start+Math.round((N-1)*k/4);var tx=Math.min(Math.max(x(ix),padL+36),padL+pw-36);g.fillText(fmtDate(cs[ix].t),tx,h-5)}}
  var hv=S.hover;
  if(hv!=null&&hv>=start&&hv<end){
    g.strokeStyle=col('--muted');g.setLineDash([3,3]);g.lineWidth=1;
    g.beginPath();g.moveTo(Math.round(x(hv))+0.5,padT);g.lineTo(Math.round(x(hv))+0.5,padT+priceH+6+volH);g.stroke();
    if(S.hoverY!=null&&S.hoverY>=padT&&S.hoverY<=padT+priceH){
      var hy=Math.round(S.hoverY)+0.5,hp=hi-(S.hoverY-padT)/priceH*(hi-lo);
      g.beginPath();g.moveTo(padL,hy);g.lineTo(padL+pw,hy);g.stroke();g.setLineDash([]);
      g.fillStyle=col('--panel2');g.fillRect(padL+pw+1,hy-9,padR-2,18);g.strokeStyle=col('--line');g.strokeRect(padL+pw+1.5,hy-8.5,padR-3,17);
      g.fillStyle=col('--fg');g.textAlign='left';g.textBaseline='middle';g.fillText(fmtPrice(hp),padL+pw+5,hy);
    }
    g.setLineDash([]);
  }
  $('viewInfo').textContent=N+' velas'+(S.off?' · '+S.off+' atrás':'')+(S.src==='live'?' · '+S.tf:'');
  renderReadout();
}
function renderReadout(){
  var i=S.hover!=null?S.hover:S.candles.length-1,c=S.candles[i];if(!c)return;
  var f=function(a){return a&&i<a.length&&isFinite(a[i])?fmtPrice(a[i]):'–'};
  $('readout').textContent=(isFinite(c.t)?fmtDate(c.t)+'  ':'')+'A '+fmtPrice(c.o)+'  M '+fmtPrice(c.h)+'  m '+fmtPrice(c.l)+'  F '+fmtPrice(c.c)+'  Vol '+c.v.toLocaleString('pt-BR',{maximumFractionDigits:0})+'  |  MM'+S.params.emaF+' '+f(S.ind.ef)+'  MM'+S.params.emaM+' '+f(S.ind.em)+'  MM'+S.params.emaS+' '+f(S.ind.es);
}

function renderAll(){
  if(!S.candles.length||!S.ind)return;
  renderHeader();renderQuick();renderReading();renderSignal();renderTicket();renderSizing();renderRisk();renderTrades();renderDiary();renderPerf();renderStrategy();renderHow();drawChart();
  $('undo').disabled=!S.undo.length;$('usage').textContent=usageText();
}
function queueRender(){
  if(S.renderQueued)return;
  S.renderQueued=true;
  requestAnimationFrame(function(){S.renderQueued=false;renderAll()});
}

/* ---------- gráfico: ponteiro, zoom, arrastar linhas ---------- */
function priceAt(py){var L=S.layout;return L.hi-(py-L.padT)/L.priceH*(L.hi-L.lo)}
function hitAt(py){
  var best=null,bd=8;
  S.hit.forEach(function(h){var d=Math.abs(h.y-py);if(d<bd){bd=d;best=h}});
  return best;
}
function dragTo(price){
  var d=S.drag,c=last().c;if(!d)return;
  if(d.kind==='plan'){
    var p=plan();if(!p)return;
    var nv={stop:p.stop,target:p.target};nv[d.field]=price;
    if(validLevels(p.side,c,nv.stop,nv.target))S.plan={side:p.side,stop:nv.stop,target:nv.target};
  }else{
    var t=S.trades.find(function(x){return x.id===d.id&&x.status==='open'});if(!t)return;
    var s=t.stop,tg=t.target;if(d.field==='stop')s=price;else tg=price;
    if(validLevels(t.side,c,s,tg)){t.stop=s;t.target=tg}
  }
}
function zoom(f){
  var n=Math.round(S.viewN*f);if(n===S.viewN)n+=f<1?-1:1;
  S.viewN=clamp(n,20,Math.min(600,Math.max(20,S.candles.length)));save();drawChart();
}
function bindChart(){
  var cv=$('chart');
  function pos(e){var r=cv.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top}}
  cv.addEventListener('pointerdown',function(e){
    if(!S.layout)return;
    var p=pos(e),h=hitAt(p.y);
    if(h)S.drag=h;else S.pan={x:e.clientX,off:S.off};
    if(S.drag&&S.drag.kind==='trade')pushUndo();
    try{cv.setPointerCapture(e.pointerId)}catch(x){}
  });
  cv.addEventListener('pointermove',function(e){
    var L=S.layout;if(!L)return;var p=pos(e);
    if(S.drag){dragTo(priceAt(p.y));cv.className='ns';queueRender();return}
    if(S.pan){S.off=clamp(S.pan.off+Math.round((e.clientX-S.pan.x)/L.step),0,L.maxOff);cv.className='grab';S.hover=null;drawChart();return}
    var i=L.start+Math.floor((p.x-L.padL)/L.step);
    S.hover=clamp(i,L.start,L.end-1);S.hoverY=p.y;cv.className=hitAt(p.y)?'ns':'';
    drawChart();
  });
  function end(){
    var wasTrade=S.drag&&S.drag.kind==='trade';
    S.drag=null;S.pan=null;$('chart').className='';
    if(wasTrade){save();renderAll()}
  }
  cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
  cv.addEventListener('pointerleave',function(){if(!S.drag&&!S.pan){S.hover=null;S.hoverY=null;drawChart()}});
  cv.addEventListener('wheel',function(e){e.preventDefault();zoom(e.deltaY>0?1.12:0.89)},{passive:false});
  $('zoomIn').addEventListener('click',function(){zoom(0.8)});
  $('zoomOut').addEventListener('click',function(){zoom(1.25)});
  $('toEnd').addEventListener('click',function(){S.off=0;drawChart()});
  $('fsBtn').addEventListener('click',toggleFull);
}
function toggleFull(force){
  var box=$('chartbox'),on=typeof force==='boolean'?force:!box.classList.contains('full');
  box.classList.toggle('full',on);document.body.classList.toggle('nofs-lock',on);
  $('fsBtn').textContent=on?'Sair da tela cheia':'Tela cheia';
  setTimeout(drawChart,0);
}

/* ---------- tema, modo, PWA, backup ---------- */
function applyTheme(t){
  var root=document.documentElement;
  if(t==='dark'||t==='light')root.setAttribute('data-theme',t);else root.removeAttribute('data-theme');
  $('themeBtn').innerHTML=t==='dark'?ICON.moon:(t==='light'?ICON.sun:ICON.auto);
  $('themeBtn').title='Tema: '+(t==='dark'?'escuro':(t==='light'?'claro':'automático'))+' (T)';
}
function cycleTheme(){
  var cur;try{cur=localStorage.getItem(THEME_KEY)}catch(e){}
  var next={auto:'dark',dark:'light',light:'auto'}[cur||'auto'];
  try{localStorage.setItem(THEME_KEY,next)}catch(e){}
  applyTheme(next);
}
function applyMode(simple){
  document.body.classList.toggle('simple',simple);
  $('modeSimple').classList.toggle('on',simple);$('modeAdv').classList.toggle('on',!simple);
  $('modeHint').textContent=simple?'Modo iniciante: veja o gráfico, o sinal e treine abrindo operações simuladas. Use "Avançado" para ver risco, estratégia e detalhes.':'';
  if(S.candles.length&&S.ind){renderStrategy();drawChart()}
}
function downloadFile(name,text,type){
  var a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:type}));
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
function stamp(){var d=new Date(),p=function(n){return String(n).padStart(2,'0')};return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())}
function exportBackup(){
  downloadFile('radar-backup-'+stamp()+'.json',JSON.stringify({app:'radar-futuros',version:2,exportedAt:new Date().toISOString(),data:snapshot(),bot:L},null,1),'application/json');
  say('Backup exportado.');track('export');
}
function importBackup(file){
  if(file.size>5*1024*1024){say('Arquivo de backup grande demais.');return}
  var fr=new FileReader();
  fr.onload=function(){
    var d;try{d=JSON.parse(fr.result)}catch(e){say('Esse arquivo não é um backup válido.');return}
    if(!d||d.app!=='radar-futuros'||!d.data||!Array.isArray(d.data.trades)){say('Esse arquivo não é um backup do Radar de Futuros.');return}
    var n=d.data.trades.length;
    if(!window.confirm('Importar o backup vai substituir o diário e as configurações atuais ('+n+' operações no arquivo). Continuar?'))return;
    pushUndo();
    S.trades=[];S.custom={};applyData(d.data);matchPreset();S.cmpCache={};
    if(d.bot){L=Bot.sanitize(d.bot);L.running=false;B=L;stopBotTimer();saveBot();renderBot()}
    useDemo();syncInputs();say('Backup importado: '+S.trades.length+' operações.');
  };
  fr.onerror=function(){say('Não consegui ler o arquivo.')};
  fr.readAsText(file);
}
function syncInputs(){
  Object.keys(CFG_RANGE).forEach(function(k){var el=$(k==='openRiskPct'?'openRiskPct':k);if(el)el.value=S.cfg[k]});
  $('closedOnly').checked=S.cfg.closedOnly;
}

/* ---------- eventos ---------- */
function bind(){
  $('srcLive').addEventListener('click',function(){if(S.src!=='live')connectLive(S.liveSym,S.tf,false)});
  $('srcDemo').addEventListener('click',useDemo);
  $('srcCsv').addEventListener('click',function(){$('file').click()});
  $('file').addEventListener('change',function(e){var f=e.target.files&&e.target.files[0];e.target.value='';if(f)loadCsvFile(f)});
  $('symLive').addEventListener('change',function(e){
    var s=D.normSymbol(e.target.value);
    if(/^[A-Z0-9]{2,10}$/.test(s)&&!/^[A-Z0-9]+(USDT|USDC|BUSD|FDUSD|TUSD|BTC|ETH|BNB)$/.test(s))s+='USDT';
    e.target.value=s;
    if(!D.validSymbol(s)){say('Símbolo inválido. Exemplo: BTCUSDT.');e.target.value=S.liveSym;return}
    if(s!==S.liveSym||S.src!=='live')connectLive(s,S.tf,false);
  });
  $('tf').addEventListener('change',function(e){connectLive(S.liveSym,e.target.value,false)});
  $('sym').addEventListener('change',function(e){S.demoSym=e.target.value;useDemo()});
  $('adv').addEventListener('click',advance);
  $('auto').addEventListener('click',function(){setAuto(!S.auto)});
  $('speed').addEventListener('change',function(e){S.speed=parseFloat(e.target.value)||1;save();if(S.auto)setAuto(true)});
  $('blind').addEventListener('change',function(e){
    S.blind=e.target.checked;
    if(S.src==='csv'){S.cursor=S.blind?Math.min(S.all.length,Math.max(120,Math.floor(S.all.length*0.5))):S.all.length;if(!S.blind)setAuto(false);applyView();resetView();refresh();evaluateOpen();renderAll()}
  });
  $('modeSimple').addEventListener('click',function(){try{localStorage.setItem(MODE_KEY,'simple')}catch(e){}applyMode(true)});
  $('modeAdv').addEventListener('click',function(){try{localStorage.setItem(MODE_KEY,'adv')}catch(e){}applyMode(false)});
  $('themeBtn').addEventListener('click',cycleTheme);
  $('helpBtn').addEventListener('click',function(){$('helpDlg').showModal()});

  Object.keys(CFG_RANGE).forEach(function(k){
    var el=$(k),r=CFG_RANGE[k];el.value=S.cfg[k];
    el.addEventListener('change',function(){var v=parseFloat(String(el.value).replace(',','.'));if(!isFinite(v))v=S.cfg[k];v=clamp(v,r[0],r[1]);S.cfg[k]=v;el.value=v;save();refresh();renderAll()});
  });
  $('closedOnly').checked=S.cfg.closedOnly;
  $('closedOnly').addEventListener('change',function(e){S.cfg.closedOnly=e.target.checked;save();refresh();renderAll()});

  Object.keys(PARAM_IN).forEach(function(id){
    var el=$(id);
    el.addEventListener('change',function(){
      var p=Object.assign({},S.params),v=parseFloat(String(el.value).replace(',','.'));
      if(isFinite(v))p[PARAM_IN[id]]=v;
      S.params=E.normParams(p);matchPreset();save();refresh();renderAll();
    });
  });
  $('preset').addEventListener('change',function(e){
    var m=presetList().filter(function(x){return x.id===e.target.value})[0];
    if(m){S.params=E.normParams(m.p);S.presetId=m.id;save();refresh();renderAll()}
  });
  $('presetSave').addEventListener('click',function(){
    var name=$('presetName').value.trim();if(!name){say('Dê um nome para a estratégia.');return}
    if(Object.keys(S.custom).length>=10){say('Limite de 10 estratégias salvas. Exclua alguma.');return}
    var id='c'+Date.now();S.custom[id]={name:name.slice(0,24),p:E.normParams(S.params)};S.presetId=id;$('presetName').value='';save();renderAll();say('Estratégia salva.');
  });
  $('presetDel').addEventListener('click',function(){
    if(!S.custom[S.presetId])return;
    delete S.custom[S.presetId];matchPreset();save();renderAll();say('Estratégia excluída.');
  });
  $('stratCard').addEventListener('toggle',function(){if(S.ind)renderStrategy()});

  $('tkBuy').addEventListener('click',function(){startPlan('long')});
  $('tkSell').addEventListener('click',function(){startPlan('short')});
  $('tkFollow').addEventListener('click',function(){S.plan=null;renderAll()});
  $('tkOpen').addEventListener('click',openPlan);
  ['tkStop','tkTarget'].forEach(function(id){
    $(id).addEventListener('change',function(e){
      var p=plan(),v=parseFloat(String(e.target.value).replace(',','.'));if(!p)return;
      var nv={stop:p.stop,target:p.target};nv[id==='tkStop'?'stop':'target']=v;
      if(!validLevels(p.side,p.entry,nv.stop,nv.target)){say(planError({side:p.side,entry:p.entry,stop:nv.stop,target:nv.target})||'Preço inválido.');renderTicket();return}
      S.plan={side:p.side,stop:nv.stop,target:nv.target};renderAll();
    });
  });
  ['quick','signal'].forEach(function(id){$(id).addEventListener('click',function(e){var b=e.target.closest('button[data-act="open"]');if(b)openPlan()})});

  $('openWrap').addEventListener('click',function(e){
    var b=e.target.closest('button');if(!b)return;
    if(b.id==='closeAll'){closeAllHere();return}
    var cid=b.getAttribute('data-close'),xid=b.getAttribute('data-cancel');
    if(cid){
      var t=S.trades.find(function(x){return x.id===cid&&x.status==='open'});if(!t||!mine(t))return;
      pushUndo();closeTrade(t,last().c,'Manual');save();renderAll();
    }else if(xid){
      if(S.cancelArm!==xid){S.cancelArm=xid;renderTrades();setTimeout(function(){if(S.cancelArm===xid){S.cancelArm=null;renderTrades()}},3000);return}
      S.cancelArm=null;pushUndo();
      S.trades=S.trades.filter(function(x){return !(x.id===xid&&x.status==='open')});save();renderAll();say('Operação cancelada. Nada foi registrado no diário.');
    }
  });
  $('undo').addEventListener('click',undo);
  $('reset').addEventListener('click',function(){
    var b=$('reset');
    if(!S.resetArm){b.textContent='Confirmar: apagar tudo?';S.resetArm=setTimeout(function(){S.resetArm=null;b.textContent='Zerar simulação'},4000);return}
    clearTimeout(S.resetArm);S.resetArm=null;b.textContent='Zerar simulação';
    pushUndo();S.trades=[];save();renderAll();say('Simulação zerada. Use Desfazer se foi sem querer.');
  });

  [['fSym','sym'],['fRes','res'],['fSide','side'],['fReason','reason'],['fTag','tag']].forEach(function(a){
    $(a[0]).addEventListener('change',function(e){S.f[a[1]]=e.target.value;S.diaryN=25;renderDiary(true)});
  });
  $('exportCsv').addEventListener('click',function(){
    var list=filteredClosed();if(!list.length){say('Nada para exportar com esses filtros.');return}
    downloadFile('radar-diario-'+stamp()+'.csv',M.toCSV(list),'text/csv;charset=utf-8');say('Diário exportado ('+list.length+' operações).');track('export');
  });
  $('histWrap').addEventListener('click',function(e){if(e.target.closest('[data-more]')){S.diaryN+=25;renderDiary(true)}});
  $('histWrap').addEventListener('change',function(e){
    var el=e.target,id=el.getAttribute('data-tags')||el.getAttribute('data-note')||el.getAttribute('data-review');if(!id)return;
    var t=S.trades.find(function(x){return x.id===id});if(!t)return;
    if(el.hasAttribute('data-tags')){t.tags=M.parseTags(el.value);el.value=t.tags.join(', ')}
    else if(el.hasAttribute('data-note'))t.note=el.value.trim().slice(0,120);
    else t.review=el.value.trim().slice(0,300);
    save();renderPerf();
    $('tagList').innerHTML=uniq([].concat.apply([],closed().map(function(x){return x.tags||[]}))).map(function(x){return '<option value="'+esc(x)+'">'}).join('');
  });

  $('bkExport').addEventListener('click',exportBackup);
  $('bkImport').addEventListener('click',function(){$('bkFile').click()});
  $('bkFile').addEventListener('change',function(e){var f=e.target.files&&e.target.files[0];e.target.value='';if(f)importBackup(f)});

  bindChart();bindBot();bindHoje();
  $('bmServer').addEventListener('click',function(){setBotMode('server')});
  $('bmLocal').addEventListener('click',function(){setBotMode('local')});
  $('tabHoje').addEventListener('click',function(){setView('hoje')});
  $('tabBot').addEventListener('click',function(){setView('bot')});
  $('tabManual').addEventListener('click',function(){setView('manual')});
  window.addEventListener('resize',drawChart);
  try{new ResizeObserver(drawChart).observe($('chart'))}catch(e){}
  try{new MutationObserver(drawChart).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']})}catch(e){}
  try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',drawChart)}catch(e){}
  try{document.fonts.ready.then(drawChart)}catch(e){}
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&S.ind)renderAll()});
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();S.installEvt=e;$('installBtn').hidden=false});
  $('installBtn').addEventListener('click',function(){var ev=S.installEvt;if(!ev)return;ev.prompt();S.installEvt=null;$('installBtn').hidden=true});
  window.addEventListener('appinstalled',function(){$('installBtn').hidden=true});
  document.addEventListener('keydown',onKey);
  document.addEventListener('change',function(e){if(e.target.tagName==='SELECT'||e.target.type==='checkbox')e.target.blur()});
}
function onKey(e){
  var tg=e.target,tag=tg&&tg.tagName;
  if(e.key==='Escape'&&$('chartbox').classList.contains('full')){toggleFull(false);return}
  if((tag==='INPUT'&&!/^(checkbox|radio|button|file)$/.test(tg.type))||tag==='SELECT'||tag==='TEXTAREA'||$('helpDlg').open)return;
  var k=e.key,ctrl=e.ctrlKey||e.metaKey;
  if(tag==='BUTTON'&&(k===' '||k==='Enter'))return;
  if(S.view==='bot'&&k!=='?'&&k!=='t'&&k!=='T')return;
  if(ctrl&&(k==='z'||k==='Z')){e.preventDefault();undo();return}
  if(ctrl||e.altKey)return;
  switch(k){
    case ' ':case 'n':case 'N':if(canReplay()){e.preventDefault();advance()}break;
    case 'p':case 'P':setAuto(!S.auto);break;
    case 'b':case 'B':startPlan('long');break;
    case 'v':case 'V':startPlan('short');break;
    case 'o':case 'O':openPlan();break;
    case 'e':case 'E':closeAllHere();break;
    case 'z':case 'Z':undo();break;
    case '+':case '=':zoom(0.8);break;
    case '-':case '_':zoom(1.25);break;
    case 'ArrowLeft':e.preventDefault();S.off=clamp(S.off+5,0,S.layout?S.layout.maxOff:0);drawChart();break;
    case 'ArrowRight':e.preventDefault();S.off=clamp(S.off-5,0,S.layout?S.layout.maxOff:0);drawChart();break;
    case 'End':S.off=0;drawChart();break;
    case 't':case 'T':cycleTheme();break;
    case '?':$('helpDlg').showModal();break;
  }
}

/* ---------- robô de simulação ---------- */
var Bot=window.RadarBot,BOT_KEY='radar-robo-v1',VIEW_KEY='radar-aba';
var L=Bot.defaults(),B=L,R=null,remoteErr='',remoteBusy=false,remoteTimer=null,botMode='server',MODE_KEY2='radar-robo-modo';
var botBusy=false,botTimer=null,botTestBusy=false,botResetArm=null,botNet='';
var BOT_IN={bCapital:'capital',bRisk:'riskPct',bLev:'lev',bMaxOpen:'maxOpen',bDaily:'dailyPct',bFee:'feePct',bSlip:'slipPct'};

function loadBot(){try{var r=localStorage.getItem(BOT_KEY);if(r)L=Bot.sanitize(JSON.parse(r))}catch(e){}B=L}
function saveBot(){try{localStorage.setItem(BOT_KEY,JSON.stringify(L))}catch(e){}}
function botLocked(){return B.running||Bot.openTrades(B).length>0}
function presetName(id){var m=presetList().filter(function(x){return x.id===id})[0];return m?m.name:'Personalizada'}
function symInput(v){
  var s=D.normSymbol(v);
  if(/^[A-Z0-9]{2,10}$/.test(s)&&!/^[A-Z0-9]+(USDT|USDC|BUSD|FDUSD|TUSD|BTC|ETH|BNB)$/.test(s))s+='USDT';
  return s;
}

function botEvery(){return clamp(D.TFS[L.cfg.tf]/4,30000,300000)}
function startBotTimer(){clearInterval(botTimer);botTimer=setInterval(botTick,botEvery())}
function stopBotTimer(){clearInterval(botTimer);botTimer=null}
function botStart(){
  if(L.running)return;
  if(!L.startedAt)L.startedAt=Date.now();
  if(!Bot.openTrades(L).length)L.cursor={};
  L.running=true;saveBot();startBotTimer();renderBot();botTick();track('bot');
}
function botStop(){
  L.running=false;stopBotTimer();saveBot();renderBot();
  if(Bot.openTrades(L).length)say('Robô pausado. As posições abertas continuam valendo: ao religar, ele recupera o que aconteceu com elas.');
}
function botTick(){
  if(!L.running||botBusy)return;
  botBusy=true;
  var tf=L.cfg.tf,syms=L.cfg.syms.slice();
  Promise.all(syms.map(function(sym){
    return D.fetchKlines(sym,tf,500).then(function(cs){return {sym:sym,cs:cs}}).catch(function(){return null});
  })).then(function(res){
    botBusy=false;
    if(!L.running||tf!==L.cfg.tf)return;
    var data={},ok=0;
    res.forEach(function(r){if(r){data[r.sym]=r.cs;ok++;L.prices[r.sym]=r.cs[r.cs.length-1].c}});
    if(!ok){botNet='off';if(botMode==='local')renderBotHero();return}
    botNet=ok<syms.length?'part':'ok';
    var ev=Bot.step(L,data,Date.now());
    saveBot();if(botMode==='local')renderBot();notifyBot(ev);
  });
}
function notifyBot(ev){
  if(!L.cfg.notify||!ev.length||typeof Notification==='undefined'||Notification.permission!=='granted')return;
  ev.slice(0,4).forEach(function(e){
    var t=e.trade,open=e.type==='open';
    try{new Notification(open?'Robô abriu '+(t.side==='long'?'compra':'venda')+' em '+t.sym:'Robô fechou '+t.sym+' ('+t.reason+')',
      {body:open?'Entrada '+fmtPrice(t.entry)+' · stop '+fmtPrice(t.stop)+' · alvo '+fmtPrice(t.target):fmtSigned(t.pnl)+' USDT',icon:'icons/icon-192.png',tag:t.id+e.type})}catch(x){}
  });
}

function botSummary(){
  var sm=M.summarize(B.trades,B.cfg.capital),unreal=0;
  Bot.openTrades(B).forEach(function(t){var u=Bot.unrealized(B,t);if(isFinite(u))unreal+=u});
  return {sm:sm,unreal:unreal,equity:Bot.balance(B)+unreal};
}
function renderBotHero(){
  if(botMode==='server'){renderServerHero();return}
  var run=B.running,h='<div class="state"><div class="qword '+(run?'long':'wait')+'">'+(run?'ROBÔ LIGADO':'ROBÔ DESLIGADO')+'</div>'+
    '<button id="bToggle" class="btn big '+(run?'':'primary')+'" type="button">'+(run?'Pausar robô':'Ligar robô')+'</button></div>';
  if(run){
    h+='<p class="qtext">'+esc(B.cfg.syms.join(', '))+' · velas de '+esc(B.cfg.tf)+' · checou '+(B.lastRun?'há '+fmtDur(Date.now()-B.lastRun):'nunca')+'</p>';
    if(botNet==='off')h+='<div class="warnbox">Sem conexão com a Binance. Tentando de novo.</div>';
    else if(botNet==='part')h+='<div class="warnbox">Algumas moedas sem dados. Tentando de novo.</div>';
  }
  $('botHero').className='card botstate'+(run?' on':'');$('botHero').innerHTML=h;
}
function renderBot(){
  B=botMode==='server'?(R?R.st:Bot.defaults()):L;
  $('botCfgCard').hidden=botMode==='server';$('botSrv').hidden=botMode!=='server';
  renderBotHero();
  var bs=botSummary(),sm=bs.sm,cap=B.cfg.capital,open=Bot.openTrades(B),total=bs.equity-cap;
  var pf=sm.pf===Infinity?'∞':fmt2(sm.pf),st=function(l,v,c){return '<div class="stat"><span>'+l+'</span><b'+(c?' class="'+c+'"':'')+'>'+v+'</b></div>'};
  $('botStats').innerHTML=
    st('Saldo do robô',fmt2(bs.equity)+' USDT')+
    st('Resultado',fmtSigned(total)+' ('+(total>=0?'+':'')+f1(total/cap*100)+'%)',sgn(total))+
    st('Operações fechadas',String(sm.n))+st('Em aberto',String(open.length))+
    st('Taxa de acerto',sm.n?sm.winRate.toFixed(0)+'%':'–')+st('Fator de lucro',sm.n?pf:'–')+
    st('Maior queda',sm.n?fmt2(sm.maxDD)+' ('+f1(sm.maxDDPct)+'%)':'–');
  $('botCurve').innerHTML=sm.n>=2?sparkSVG([{v:sm.curve,color:'var(--accent)',dot:true}],{base:cap,h:150,label:'Curva de saldo do robô'}):'<div class="empty">A curva aparece depois das primeiras operações fechadas.</div>';

  if(!open.length)$('botOpen').innerHTML='<div class="empty">'+(B.running?'Nenhuma posição aberta. O robô está esperando um sinal.':'Nenhuma posição aberta.')+'</div>';
  else $('botOpen').innerHTML='<div class="tablewrap"><table><thead><tr><th class="l">Ativo</th><th class="l">Lado</th><th class="r">Entrada</th><th class="r">Stop</th><th class="r">Alvo</th><th class="r">Preço</th><th class="r">Resultado agora</th><th class="l">Por que entrou</th></tr></thead><tbody>'+
    open.map(function(t){var u=Bot.unrealized(B,t);return '<tr><td class="l">'+esc(t.sym)+'</td><td class="l '+t.side+'">'+(t.side==='long'?'Compra':'Venda')+'</td><td class="r">'+fmtPrice(t.entry)+'</td><td class="r neg">'+fmtPrice(t.stop)+'</td><td class="r pos">'+fmtPrice(t.target)+'</td><td class="r">'+fmtPrice(B.prices[t.sym])+'</td><td class="r '+sgn(u)+'">'+(isFinite(u)?fmtSigned(u):'–')+'</td><td class="l why">'+esc(t.reasons.join('; '))+'</td></tr>'}).join('')+'</tbody></table></div>';

  $('botHist').innerHTML=botHistHtml();
  if(botMode==='local')renderBotCfg();
  else renderServerCfg();
  renderBotReady();
}
// "O que o robô fez": cada entrada e saída contada em frases simples; a tabela técnica fica atrás de um botão.
function botHistHtml(){
  var tl=Narr.timeline(B.trades,14),now=Date.now(),h='';
  if(!tl.length)h='<div class="empty">'+(B.running?'Nenhuma operação ainda. O robô está vigiando o mercado e só entra quando todos os critérios de segurança passam.':'Quando o robô entrar ou sair de uma operação, a história aparece aqui em linguagem simples.')+'</div>';
  else h='<ol class="timeline">'+tl.map(function(e){
    var why=e.why&&e.why.length?'<details><summary class="note">Por que entrou</summary><ul class="list">'+e.why.map(function(w){return '<li>'+esc(w)+'</li>'}).join('')+'</ul></details>':'';
    return '<li class="tl-item '+(e.tone||'')+'"><span class="tl-ico" aria-hidden="true">'+e.icon+'</span><div><div class="tl-title">'+esc(e.title)+' <span class="note">há '+fmtDur(now-e.at)+'</span></div><p class="tl-text">'+esc(e.text)+'</p>'+why+'</div></li>';
  }).join('')+'</ol>';
  var cl=Bot.closedTrades(B).slice().sort(function(a,b){return b.closedAt-a.closedAt}).slice(0,25);
  if(cl.length)h+='<details><summary class="note">Ver tabela completa das últimas operações</summary><div class="tablewrap"><table><thead><tr><th class="l">Fechada em</th><th class="l">Ativo</th><th class="l">Lado</th><th class="r">Entrada</th><th class="r">Saída</th><th class="r">Resultado</th><th class="r">R</th><th class="l">Saída por</th></tr></thead><tbody>'+
    cl.map(function(t){return '<tr><td class="l">'+fmtDate(t.closedAt)+'</td><td class="l">'+esc(t.sym)+'</td><td class="l '+t.side+'">'+(t.side==='long'?'Compra':'Venda')+'</td><td class="r">'+fmtPrice(t.entry)+'</td><td class="r">'+fmtPrice(t.exit)+'</td><td class="r '+sgn(t.pnl)+'">'+fmtSigned(t.pnl)+'</td><td class="r">'+(t.risk>0?fmtSigned(t.pnl/t.risk):'–')+'</td><td class="l">'+esc(t.reason)+'</td></tr>'}).join('')+'</tbody></table></div></details>';
  return h;
}
function renderBotCfg(){
  var lockAll=B.running,lockStruct=botLocked(),sel=$('bPreset'),opts=presetList().map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>'}).join('');
  var known=presetList().some(function(x){return x.id===B.cfg.presetId});
  if(!known)opts+='<option value="'+esc(B.cfg.presetId)+'">Personalizada</option>';
  if(sel.getAttribute('data-k')!==opts){sel.setAttribute('data-k',opts);sel.innerHTML=opts}
  sel.value=B.cfg.presetId;sel.disabled=lockStruct;$('bTf').value=B.cfg.tf;$('bTf').disabled=lockStruct;
  Object.keys(BOT_IN).forEach(function(id){var el=$(id);if(document.activeElement!==el)el.value=B.cfg[BOT_IN[id]];el.disabled=lockAll});
  $('bCapital').disabled=lockAll||B.trades.length>0;
  $('bNotify').checked=!!B.cfg.notify;
  $('bSyms').innerHTML=B.cfg.syms.map(function(s){return '<span class="chip">'+esc(s)+(lockStruct?'':'<button type="button" data-rm="'+esc(s)+'" aria-label="Remover '+esc(s)+'">×</button>')+'</span>'}).join('');
  $('bSymAdd').disabled=lockStruct;$('bSymAddBtn').disabled=lockStruct;
  $('botLock').textContent=B.running?'Pause o robô para mudar a configuração.':(lockStruct?'Há posições abertas: encerre-as para mudar estratégia, intervalo e moedas.':'');
  $('bCloseAll').disabled=!Bot.openTrades(B).length;
}
function renderBotReady(){
  var rd=Bot.readiness(B,Date.now(),botMode==='server'?(R&&R.meta.pesquisa||null):undefined),h='<h2>Trava de segurança</h2><ul class="checklist">'+
    rd.checks.map(function(c){return '<li><span class="'+(c.ok?'ok':'no')+'">'+(c.ok?'✓':'○')+'</span><span>'+esc(c.label)+'</span><span class="d">'+esc(c.detail)+'</span></li>'}).join('')+'</ul>';
  h+=rd.ready?'':'<p class="note">'+rd.passed+' de '+rd.checks.length+' critérios.</p>';
  $('botReady').innerHTML=h;
}

function botTest(){
  if(botTestBusy)return;
  botTestBusy=true;$('bTestBtn').disabled=true;$('bTestOut').innerHTML='<div class="empty">Buscando dados e testando…</div>';
  var syms=B.cfg.syms.slice(),fee=B.cfg.feePct;
  Promise.all(syms.map(function(sym){return D.fetchKlines(sym,B.cfg.tf,1000).then(function(cs){return {sym:sym,cs:cs}}).catch(function(){return null})})).then(function(res){
    botTestBusy=false;$('bTestBtn').disabled=false;
    var data=res.filter(Boolean);
    if(!data.length){$('bTestOut').innerHTML='<div class="empty">Não consegui buscar dados da Binance agora.</div>';return}
    var rows=presetList().map(function(x){
      var rs=data.map(function(d){return E.backtest(d.cs,E.computeIndicators(d.cs,x.p),fee,x.p)});
      return {x:x,a:Bot.aggregate(rs)};
    });
    var best=null;rows.forEach(function(r){if(r.a.n>=10&&(!best||r.a.totalR>best.a.totalR))best=r});
    var f=function(n){return n.toFixed(2).replace('.',',')};
    $('bTestOut').innerHTML='<div class="tablewrap"><table><thead><tr><th class="l">Estratégia</th><th class="r">Ops</th><th class="r">Acerto</th><th class="r">Resultado (R)</th><th class="r">R por op.</th><th class="r">Fator de lucro</th><th></th></tr></thead><tbody>'+
      rows.map(function(r){var a=r.a;return '<tr class="'+(best===r?'activeRow':'')+'"><td class="l">'+esc(r.x.name)+(best===r?' <span class="tag">melhor nesta amostra</span>':'')+'</td><td class="r">'+a.n+'</td><td class="r">'+(a.n?a.winRate.toFixed(0)+'%':'–')+'</td><td class="r '+sgn(a.totalR)+'">'+(a.n?fmtSigned(a.totalR):'–')+'</td><td class="r">'+(a.n?fmtSigned(a.avgR):'–')+'</td><td class="r">'+(a.n?(isFinite(a.pf)?f(a.pf):'∞'):'–')+'</td><td class="r"><button class="btn" type="button" data-use="'+esc(r.x.id)+'"'+(botLocked()||botMode!=='local'?' disabled':'')+'>Usar</button></td></tr>'}).join('')+'</tbody></table></div>'+
      '<p class="note">'+data.length+' de '+syms.length+' moedas testadas, '+data[0].cs.length+' velas cada. "R" é o lucro medido em múltiplos do risco de cada operação. Amostras curtas enganam: confirme no robô rodando.</p>';
  });
}
function botAddSym(){
  var s=symInput($('bSymAdd').value);$('bSymAdd').value='';
  if(!s)return;
  if(!D.validSymbol(s)){say('Moeda inválida. Exemplo: SUI ou SUIUSDT.');return}
  if(B.cfg.syms.indexOf(s)>=0){say(s+' já está na lista.');return}
  if(B.cfg.syms.length>=10){say('Limite de 10 moedas.');return}
  D.fetchKlines(s,B.cfg.tf,50).then(function(){if(botLocked())return;B.cfg.syms.push(s);saveBot();renderBot()}).catch(function(e){say('Não consegui adicionar '+s+': '+e.message+'.')});
}
function bindBot(){
  $('botHero').addEventListener('click',function(e){if(botMode==='local'&&e.target.closest('#bToggle'))L.running?botStop():botStart()});
  $('bPreset').addEventListener('change',function(e){
    var m=presetList().filter(function(x){return x.id===e.target.value})[0];if(!m||botLocked())return;
    B.cfg.presetId=m.id;B.params=E.normParams(m.p);saveBot();renderBot();
  });
  $('bTf').addEventListener('change',function(e){if(botLocked())return;B.cfg.tf=e.target.value;B.cursor={};saveBot();renderBot()});
  Object.keys(BOT_IN).forEach(function(id){
    var k=BOT_IN[id],r=Bot.CFG_RANGE[k],el=$(id);
    el.addEventListener('change',function(){
      if(B.running)return;
      var v=parseFloat(String(el.value).replace(',','.'));if(!isFinite(v))v=B.cfg[k];
      v=clamp(v,r[0],r[1]);if(k==='maxOpen')v=Math.round(v);
      B.cfg[k]=v;el.value=v;saveBot();renderBot();
    });
  });
  $('bNotify').addEventListener('change',function(e){
    var on=e.target.checked;
    if(on&&typeof Notification!=='undefined'&&Notification.permission==='default'){
      Notification.requestPermission().then(function(p){if(p!=='granted'){say('O navegador não deixou enviar avisos.');B.cfg.notify=false}else B.cfg.notify=true;saveBot();renderBotCfg()});return;
    }
    if(on&&(typeof Notification==='undefined'||Notification.permission==='denied')){say('Os avisos estão bloqueados neste navegador.');e.target.checked=false;return}
    B.cfg.notify=on;saveBot();
  });
  $('bSyms').addEventListener('click',function(e){
    var b=e.target.closest('[data-rm]');if(!b||botLocked())return;
    var s=b.getAttribute('data-rm');if(B.cfg.syms.length<=1){say('O robô precisa de pelo menos uma moeda.');return}
    B.cfg.syms=B.cfg.syms.filter(function(x){return x!==s});delete B.cursor[s];saveBot();renderBot();
  });
  $('bSymAddBtn').addEventListener('click',botAddSym);
  $('bSymAdd').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();botAddSym()}});
  $('bCloseAll').addEventListener('click',function(){
    var out=Bot.closeAll(B,{},Date.now());
    if(!out.length){say('Sem preço recente para encerrar. Aguarde a próxima checagem.');return}
    saveBot();renderBot();say(out.length+' posição(ões) encerrada(s) ao último preço.');
  });
  $('bReset').addEventListener('click',function(){
    var b=$('bReset');
    if(!botResetArm){b.textContent='Confirmar: apagar o histórico do robô?';botResetArm=setTimeout(function(){botResetArm=null;b.textContent='Zerar robô'},4000);return}
    clearTimeout(botResetArm);botResetArm=null;b.textContent='Zerar robô';
    var cfg=L.cfg,params=L.params;stopBotTimer();L=Bot.defaults();L.cfg=cfg;L.params=params;B=L;saveBot();renderBot();say('Robô zerado.');
  });
  $('bTestBtn').addEventListener('click',botTest);
  $('bTestOut').addEventListener('click',function(e){
    var b=e.target.closest('[data-use]');if(!b||botMode!=='local'||botLocked())return;
    var m=presetList().filter(function(x){return x.id===b.getAttribute('data-use')})[0];if(!m)return;
    B.cfg.presetId=m.id;B.params=E.normParams(m.p);saveBot();renderBot();say('Estratégia '+m.name+' selecionada para o robô.');
  });
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&B.running)botTick()});
  window.addEventListener('online',function(){if(B.running)botTick()});
}


/* ---------- tela Hoje ---------- */
var Hoje=window.RadarHoje,HOJE_KEY='radar-hoje-v1',hj={capital:0,cur:'BRL',risk:0.5,lev:1,fx:0},hjPrices={},hjChg={},hjAt=0,hjTimer=null,hjBusy=false,hjRadar={},hjRadarBusy=false,hjRadarAt=0,hjRadarTimer=null;
var ICON={
  go:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.2 9.4"/></svg>',
  wait:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/></svg>',
  warn:'<svg viewBox="0 0 24 24"><path d="M12 3.5l9.2 16H2.8L12 3.5z"/><path d="M12 10v4.2M12 17.2v.1"/></svg>',
  stop:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/></svg>',
  shield:'<svg viewBox="0 0 24 24"><path d="M12 3l7.2 3v5.2c0 4.6-3 7.9-7.2 9.8-4.2-1.9-7.2-5.2-7.2-9.8V6L12 3z"/><path d="M9.2 12l2.1 2.1 3.6-4.2"/></svg>',
  sun:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>',
  moon:'<svg viewBox="0 0 24 24"><path d="M20 14.2A8 8 0 019.8 4 8 8 0 1020 14.2z"/></svg>',
  auto:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor"/></svg>'
};
function loadHoje(){try{var d=JSON.parse(localStorage.getItem(HOJE_KEY)||'{}');
  if(isFinite(d.capital)&&d.capital>=0)hj.capital=d.capital;if(d.cur==='USDT'||d.cur==='BRL')hj.cur=d.cur;
  if([0.25,0.5,1].indexOf(d.risk)>=0)hj.risk=d.risk;if([1,2,3].indexOf(d.lev)>=0)hj.lev=d.lev;if(d.fx>0)hj.fx=d.fx}catch(e){}}
function saveHoje(){try{localStorage.setItem(HOJE_KEY,JSON.stringify(hj))}catch(e){}}
function hjCapUSDT(){if(!(hj.capital>0))return 0;if(hj.cur==='USDT')return hj.capital;return hj.fx>0?hj.capital/hj.fx:0}
function money(usdt){return hj.cur==='BRL'&&hj.fx>0?'R$ '+fmt2(usdt*hj.fx):fmt2(usdt)+' USDT'}
function ago(ms){return fmtDur(Math.max(0,ms))}
function hjSymbols(){
  var s=R?R.st.cfg.syms.slice():[];
  if(R)Bot.openTrades(R.st).forEach(function(t){if(s.indexOf(t.sym)<0)s.push(t.sym)});
  return s;
}
function refreshHoje(){
  if(hjBusy)return;
  var syms=hjSymbols();
  if(hj.cur==='BRL')syms.push('USDTBRL');
  if(!syms.length){renderHoje();return}
  hjBusy=true;
  D.fetchTicker24h(syms).then(function(p){
    Object.keys(p).forEach(function(k){hjPrices[k]=p[k].price;hjChg[k]=p[k].change});hjAt=Date.now();
    if(p.USDTBRL&&p.USDTBRL.price>0){hj.fx=p.USDTBRL.price;saveHoje()}
  }).catch(function(){}).then(function(){hjBusy=false;if(S.view==='hoje')renderHoje()});
}
function syncHojeTimer(){
  clearInterval(hjTimer);hjTimer=null;clearInterval(hjRadarTimer);hjRadarTimer=null;
  if(S.view==='hoje'){
    refreshHoje();loadRadar();
    hjTimer=setInterval(function(){if(!document.hidden)refreshHoje()},20000);
    hjRadarTimer=setInterval(function(){if(!document.hidden)loadRadar()},60000);
  }
}
// Analisa cada moeda do robô (intervalo base + intervalo maior), só com velas fechadas, e monta o semáforo.
function loadRadar(){
  if(!R||hjRadarBusy)return;
  var st=R.st,tf=st.cfg.tf,mTf=D.macroTf(tf),syms=st.cfg.syms.slice();
  hjRadarBusy=true;
  Promise.all(syms.map(function(sym){
    var pb=D.fetchKlines(sym,tf,400),ph=mTf?D.fetchKlines(sym,mTf,400).catch(function(){return null}):Promise.resolve(null);
    return Promise.all([pb,ph]).then(function(r){return {sym:sym,base:r[0],htf:r[1]}}).catch(function(e){return {sym:sym,error:e.message}});
  })).then(function(list){
    var now=Date.now();
    list.forEach(function(x){
      if(x.error){hjRadar[x.sym]={sym:x.sym,error:x.error,at:now};return}
      var a=Rd.analyze({sym:x.sym,tf:tf,htfTf:mTf,base:x.base,htf:x.htf||[],params:st.params,now:now});a.at=now;hjRadar[x.sym]=a;
    });
    hjRadarBusy=false;hjRadarAt=now;if(S.view==='hoje')renderHoje();
  });
}
function radarSummary(){
  var ok=[];Object.keys(hjRadar).forEach(function(k){if(!hjRadar[k].error)ok.push(hjRadar[k])});
  return ok.length?Rd.summary(ok):null;
}
function nextCloseAny(){
  var now=Date.now(),tfMs=D.TFS[R.st.cfg.tf],best=0;
  Object.keys(hjRadar).forEach(function(k){if(hjRadar[k].nextCloseAt>now&&(!best||hjRadar[k].nextCloseAt<best))best=hjRadar[k].nextCloseAt});
  return best||(Math.floor(now/tfMs)+1)*tfMs;
}

var hjAdvice=null,hjCopy={};
function miniLamp(color){return '<span class="tl mini-tl" data-c="'+color+'" aria-hidden="true"><i class="r"></i><i class="y"></i><i class="g"></i></span>'}
function clock(ms){
  var d=new Date(ms),p=function(n){return String(n).padStart(2,'0')},t=p(d.getHours())+':'+p(d.getMinutes()),day=function(x){return new Date(x).setHours(0,0,0,0)},diff=Math.round((day(Date.now())-day(ms))/864e5);
  return diff<=0?t:(diff===1?'ontem '+t:p(d.getDate())+'/'+p(d.getMonth()+1)+' '+t);
}
function rrClass(rr,prefix){return (prefix||'')+(rr>=3?'good':(rr>=2?'mid':'bad'))}
function pctTxt(v){return f1(Math.abs(v))+'%'}
// estado do sinal: janela de entrada, expirado ou hora de sair
function sigState(x,tfMs,now){
  var t=x.trade,s=x.status,end=t.openedAt+2*tfMs;
  switch(s.state){
    case 'valid':return {c:'ok',title:'DENTRO DA JANELA',sub:'entrar até '+clock(end)};
    case 'late':return {c:'warn',title:'SINAL EXPIRADO',sub:'preço fora da faixa às '+clock(now)};
    case 'old':return {c:'warn',title:'SINAL EXPIRADO',sub:'expirou às '+clock(end)};
    case 'running':return {c:'warn',title:'SINAL EXPIRADO',sub:'preço já andou · '+clock(now)};
    case 'stopped':return {c:'bad',title:'SAIR AGORA / FECHAR POSIÇÃO',sub:'stop atingido · '+clock(now)};
    case 'target':return {c:'ok-out',title:'SAIR AGORA / FECHAR POSIÇÃO',sub:'alvo atingido · '+clock(now)};
  }
  return {c:'warn',title:'SEM PREÇO',sub:'aguardando cotação'};
}
function copyParams(t,size){
  var long=t.side==='long',L=['Par: '+t.sym,'Direção: '+(long?'COMPRA (LONG)':'VENDA (SHORT)'),'Entrada: '+rawPrice(t.entry),'Stop Loss: '+rawPrice(t.stop),'Take Profit: '+rawPrice(t.target)];
  if(size)L.push('Quantidade: '+rawPrice(+size.qty.toFixed(size.qty>=100?2:(size.qty>=1?3:5))),'Alavancagem: '+Math.max(1,Math.ceil(size.lev))+'x');
  return L.join('\n');
}
function sigCard(o){
  var t=o.trade,long=t.side==='long',d0=t.dist0>0?t.dist0:Math.abs(t.entry-t.stop),rr=Math.abs(t.target-t.entry)/d0,coin=t.sym.replace(/USDT$/,'');
  var id='c'+(o.n),when=clock(t.openedAt).replace(/^(\d\d:\d\d)$/,'às $1').replace(/^ontem /,'ontem às ').replace(/^(\d\d\/\d\d) /,'$1 às ');
  if(o.copy)hjCopy[id]=o.copy;
  return '<article class="sg '+(long?'buy':'sell')+(o.dim?' dim':'')+'">'+
    '<header class="sg-head"><span class="sg-pair">'+esc(coin)+'<small>/USDT</small></span><span class="sg-dir">'+(long?'COMPRA':'VENDA')+'</span>'+
      (o.copy?'<button class="sg-copy" type="button" data-copy="'+id+'" title="Copiar entrada, stop e alvo">Copiar</button>':'')+'</header>'+
    '<div class="sg-when">Entrada '+when+'</div>'+
    '<dl class="sg-grid"><div><dt>Entrada</dt><dd>'+fmtPrice(t.entry)+'</dd></div>'+
      '<div class="neg"><dt>Stop</dt><dd>'+fmtPrice(t.stop)+'</dd><small>−'+pctTxt(d0/t.entry*100)+'</small></div>'+
      '<div class="pos"><dt>Alvo</dt><dd>'+fmtPrice(t.target)+'</dd><small>+'+pctTxt(Math.abs(t.target-t.entry)/t.entry*100)+'</small></div>'+
      '<div class="sg-rr '+rrClass(rr)+'"><dt>Risco/retorno</dt><dd>'+f1(rr).replace(',0','')+' : 1</dd></div></dl>'+
    '<footer class="sg-state '+o.state.c+'"><b>'+o.state.title+'</b><span>'+esc(o.state.sub)+'</span></footer></article>';
}
function renderHojeTicker(){
  var syms=hjSymbols();if(!syms.length&&R)syms=['BTCUSDT'];
  if(!syms.length){$('hjTicker').innerHTML='<div class="tk-chip skel"></div><div class="tk-chip skel"></div><div class="tk-chip skel"></div>';return}
  $('hjTicker').innerHTML=syms.map(function(s){
    var p=hjPrices[s]||(R&&R.st.prices[s]),ch=hjChg[s],a=hjRadar[s],lamp=a&&!a.error?'<i class="dot" data-c="'+a.traffic.color+'" title="'+esc(a.traffic.title)+'"></i>':'';
    return '<div class="tk-chip"><span class="tk-sym">'+lamp+esc(s.replace(/USDT$/,''))+'</span><span class="tk-price">'+(p?fmtPrice(p):'–')+'</span>'+(isFinite(ch)?'<span class="tk-chg '+sgn(ch)+'">'+(ch>=0?'+':'')+ch.toFixed(2).replace('.',',')+'%</span>':'')+'</div>';
  }).join('');
}
function renderHojeSignals(){
  var a=hjAdvice,now=Date.now();if(!a||!R)return;
  var tfMs=D.TFS[R.st.cfg.tf],n=0,h='';hjCopy={};
  a.signals.forEach(function(x){
    var st=sigState(x,tfMs,now),ok=x.status.state==='valid';
    h+=sigCard({trade:x.trade,state:st,n:n++,dim:!ok,copy:ok?copyParams(x.trade,x.size):''});
  });
  // operações que o robô já encerrou há pouco: avisa a hora de sair
  var since=now-Math.max(2*tfMs,3600000);
  Bot.closedTrades(R.st).filter(function(t){return t.closedAt>=since}).sort(function(p,q){return q.closedAt-p.closedAt}).slice(0,4).forEach(function(t){
    h+=sigCard({trade:t,state:{c:t.pnl>0?'ok-out':'bad',title:'SAIR AGORA / FECHAR POSIÇÃO',sub:(t.reason==='Alvo'?'alvo':(t.reason==='Stop'?'stop':'encerrado'))+' atingido às '+clock(t.closedAt)},n:n++,dim:true});
  });
  if(!h)h='<div class="sg-empty"><b>Nenhum sinal ativo</b><span>Os próximos aparecem aqui</span></div>';
  $('hjSignals').innerHTML=h;
}
function renderHoje(){
  renderHojeTicker();
  var vEl=$('hjVerdict');
  if(!R){
    var msg=remoteErr==='404'?'Servidor sem dados ainda.':remoteErr==='net'?'Sem conexão com o servidor. Tentando de novo…':remoteErr==='config'?'Falta configurar o repositório.':'';
    vEl.className='hj-status'+(msg?' warn':'');
    vEl.innerHTML=msg?'<b>'+esc(msg)+'</b>':'<span class="skel" style="height:20px;width:180px"></span>';
    $('hjSignals').innerHTML='';renderHojeMy(null);return;
  }
  var now=Date.now(),u={capital:hjCapUSDT(),riskPct:hj.risk,maxLev:hj.lev},a=Hoje.advise(R.st,R.meta,hjPrices,u,now);hjAdvice=a;
  var rsum=radarSummary(),n=a.actionable.length,tone='wait',txt;
  if(a.code==='parar'){tone='bad';txt='Limite de perda do dia atingido'}
  else if(a.code==='desatualizado'){tone='warn';txt='Dados atrasados ('+ago(a.staleMs)+')'}
  else if(n){tone='go';txt=n+(n===1?' sinal na janela':' sinais na janela')}
  else txt='Aguardando sinal';
  vEl.className='hj-status '+tone;
  vEl.innerHTML=(rsum?miniLamp(rsum.color):'')+'<b>'+esc(txt)+'</b>'+(a.ready?'':'<span class="hj-tag" title="O robô ainda não passou na trava de segurança. Não use dinheiro real.">Simulação</span>')+
    '<span class="hj-next">Vela fecha em <span class="countdown" id="hjCountdown2" data-at="'+nextCloseAny()+'">'+Rd.countdown(nextCloseAny()-now)+'</span></span>';
  renderHojeSignals();renderHojeMy(a);
}
function renderHojeMy(a){
  var cap=hjCapUSDT(),h='';
  if(hj.cur==='BRL'&&!(hj.fx>0)&&hj.capital>0)h='<div class="warnbox">Sem cotação do dólar agora. Escolha USDT ou espere alguns segundos.</div>';
  else if(cap>0){
    var L=Hoje.limits(cap,hj.risk*3,hj.risk*6);
    h='<dl class="kv"><dt>Risco por operação</dt><dd class="num">'+money(cap*hj.risk/100)+'</dd><dt>Perda máxima no dia (3 stops)</dt><dd class="num neg">'+money(L.daily)+'</dd></dl>';
  }
  $('hjLimits').innerHTML=h;
  if(document.activeElement!==$('hjCapital'))$('hjCapital').value=hj.capital>0?hj.capital:'';
  [['hjCurSeg','cur'],['hjRiskSeg','risk'],['hjLevSeg','lev']].forEach(function(a2){
    Array.prototype.forEach.call($(a2[0]).querySelectorAll('button'),function(b){b.classList.toggle('on',String(hj[a2[1]])===b.getAttribute('data-v'))});
  });
}
function copyToClipboard(txt){
  if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(txt);
  return new Promise(function(res,rej){
    var ta=document.createElement('textarea');ta.value=txt;ta.setAttribute('readonly','');ta.style.cssText='position:fixed;top:-1000px';document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy')?res():rej(new Error('copy'))}catch(e){rej(e)}ta.remove();
  });
}
function bindHoje(){
  $('hjSignals').addEventListener('click',function(e){
    var b=e.target.closest('[data-copy]');if(!b||!hjCopy[b.getAttribute('data-copy')])return;
    copyToClipboard(hjCopy[b.getAttribute('data-copy')]).then(function(){b.textContent='Copiado ✓';b.classList.add('done');setTimeout(function(){b.textContent='Copiar';b.classList.remove('done')},1800)}).catch(function(){say('Não consegui copiar neste navegador.')});
  });
  $('hjCapital').addEventListener('change',function(e){var v=parseFloat(String(e.target.value).replace(',','.'));hj.capital=isFinite(v)&&v>0?v:0;saveHoje();refreshHoje()});
  ['hjCurSeg','hjRiskSeg','hjLevSeg'].forEach(function(id){
    $(id).addEventListener('click',function(e){
      var b=e.target.closest('button[data-v]');if(!b)return;
      var key=$(id).getAttribute('data-key'),v=b.getAttribute('data-v');
      hj[key]=key==='cur'?v:parseFloat(v);saveHoje();
      if(key==='cur')refreshHoje();else renderHoje();
    });
  });
}

/* ---------- robô no servidor (somente leitura) ---------- */
function rcfg(){return window.RADAR_CONFIG||{}}
function rawUrl(){var c=rcfg();return c.repo?'https://raw.githubusercontent.com/'+c.repo+'/'+(c.stateBranch||'robo-estado')+'/estado.json?t='+Date.now():''}
function ghUrl(kind,path){var c=rcfg();return c.repo?'https://github.com/'+c.repo+'/'+kind+'/'+(c.defaultBranch||'main')+'/'+path:'#'}
function loadRemote(){
  if(remoteBusy)return;
  var u=rawUrl();
  if(!u){remoteErr='config';if(botMode==='server')renderBot();return}
  remoteBusy=true;
  fetch(u,{cache:'no-store'}).then(function(r){if(r.status===404)throw new Error('404');if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(j){
    if(!j||!j.state)throw new Error('formato');
    R={st:Bot.sanitize(j.state),meta:j.meta||{}};remoteErr='';
  }).catch(function(e){remoteErr=e.message==='404'?'404':'net'}).then(function(){remoteBusy=false;if(S.view==='hoje'){refreshHoje();loadRadar()}else if(botMode==='server'&&S.view==='bot')renderBot()});
}
function syncRemoteTimer(){
  clearInterval(remoteTimer);remoteTimer=null;
  if((botMode==='server'&&S.view==='bot')||S.view==='hoje'){loadRemote();remoteTimer=setInterval(function(){if(!document.hidden)loadRemote()},60000)}
}
function renderServerHero(){
  var el=$('botHero'),h,c=rcfg(),actions=c.repo?'https://github.com/'+c.repo+'/actions/workflows/robo.yml':'#';
  if(!R){
    var msg=remoteErr==='404'?'Servidor sem dados ainda.':remoteErr==='config'?'Falta configurar o repositório.':remoteErr==='net'?'Sem conexão com o servidor. Tentando de novo…':'Carregando…';
    h='<div class="state"><div class="qword wait">SERVIDOR 24H</div><a class="btn" target="_blank" rel="noopener" href="'+esc(actions)+'">Abrir Actions</a></div><p class="qtext">'+esc(msg)+'</p>';
    el.className='card botstate';el.innerHTML=h;return;
  }
  var st=R.st,m=R.meta,run=st.running,age=Date.now()-(m.lastRun||0);
  h='<div class="state"><div class="qword '+(run?'long':'wait')+'">'+(run?'ROBÔ LIGADO':'ROBÔ DESLIGADO')+'</div><a class="btn" target="_blank" rel="noopener" href="'+esc(ghUrl('edit',c.configPath||'robo/config.json'))+'">Configuração</a></div>';
  h+='<p class="qtext">'+(run?esc(st.cfg.syms.map(function(x){return x.replace(/USDT$/,'')}).join(', '))+' · velas de '+esc(st.cfg.tf)+' · checou '+(m.lastRun?'há '+fmtDur(age):'nunca'):'Desligado na configuração.')+'</p>';
  if(run&&age>25*60000)h+='<div class="warnbox">Sem checagem há '+fmtDur(age)+'.</div>';
  else if(m.net==='off')h+='<div class="warnbox">Sem dados da Binance. Tentando de novo.</div>';
  else if(m.net==='part')h+='<div class="warnbox">Algumas moedas sem dados. Tentando de novo.</div>';
  if(m.configError)h+='<div class="warnbox">Erro na configuração: '+esc(m.configError)+'</div>';
  el.className='card botstate'+(run?' on':'');el.innerHTML=h;
}
function renderServerCfg(){
  var st=R?R.st:null,c=rcfg();
  if(!st){$('botSrv').innerHTML='';return}
  var k=st.cfg,dl=function(a,b){return '<dt>'+a+'</dt><dd class="num">'+esc(b)+'</dd>'};
  $('botSrv').innerHTML='<h2>Configuração do servidor</h2><dl class="kv">'+
    dl('Estratégia',presetName(k.presetId))+dl('Intervalo',k.tf)+dl('Moedas',k.syms.join(', '))+dl('Capital',fmt2(k.capital)+' USDT')+
    dl('Risco por operação',f1(k.riskPct)+'%')+dl('Alavancagem',k.lev+'x')+dl('Máx. posições',String(k.maxOpen))+dl('Limite diário',f1(k.dailyPct)+'%')+
    dl('Taxa / derrapagem por lado',k.feePct+'% / '+k.slipPct+'%')+'</dl>'+
    '<div class="toolrow"><a class="btn" target="_blank" rel="noopener" href="'+esc(ghUrl('edit',c.configPath||'robo/config.json'))+'">Editar configuração</a></div>';
}
function setBotMode(m){
  botMode=m;
  try{localStorage.setItem(MODE_KEY2,m)}catch(e){}
  $('bmServer').classList.toggle('on',m==='server');$('bmLocal').classList.toggle('on',m==='local');
  $('bmNote').textContent='';
  syncRemoteTimer();renderBot();
}

function setView(v){
  S.view=v;document.body.setAttribute('data-view',v);
  $('viewHoje').hidden=v!=='hoje';$('viewBot').hidden=v!=='bot';$('viewManual').hidden=v!=='manual';
  $('tabHoje').classList.toggle('on',v==='hoje');$('tabBot').classList.toggle('on',v==='bot');$('tabManual').classList.toggle('on',v==='manual');
  try{localStorage.setItem(VIEW_KEY,v)}catch(e){}
  if(v==='manual'){
    if(S.wantLive){S.wantLive=false;connectLive(S.liveSym,S.tf,true)}
    setTimeout(function(){if(S.ind)drawChart()},0);
    renderHeader();
  }else{document.title='Radar de Futuros';if(v==='bot')renderBot();else renderHoje()}
  syncRemoteTimer();syncHojeTimer();
}

/* ---------- início ---------- */
function init(){
  var saved=load();
  setInterval(function(){['hjCountdown','hjCountdown2'].forEach(function(id){var el=$(id);if(el){var at=+el.getAttribute('data-at');el.textContent=Rd.countdown(at-Date.now())}})},1000);
  $('ver').textContent='Versão '+(window.RADAR_VERSION||'?');
  try{applyTheme(localStorage.getItem(THEME_KEY)||'auto')}catch(e){applyTheme('auto')}
  matchPreset();
  $('symlist').innerHTML=D.POPULAR.map(function(s){return '<option value="'+s+'">'}).join('');
  buildDemo();refresh();bind();
  var mode;try{mode=localStorage.getItem(MODE_KEY)}catch(e){}
  applyMode(mode!=='adv');
  try{if(window.matchMedia('(max-width:600px)').matches){['diaryCard','perfCard','stratCard'].forEach(function(id){$(id).open=false})}}catch(e){}
  evaluateOpen();renderAll();
  setLiveStatus('','');S.wantLive=!!(saved.first||saved.src==='live');
  loadBot();
  var view,bm;try{view=localStorage.getItem(VIEW_KEY);bm=localStorage.getItem(MODE_KEY2)}catch(e){}
  botMode=bm==='local'?'local':'server';
  $('bmServer').classList.toggle('on',botMode==='server');$('bmLocal').classList.toggle('on',botMode==='local');
  $('bmNote').textContent='';
  loadHoje();
  setView(view==='manual'?'manual':(view==='bot'?'bot':'hoje'));
  if(L.running){startBotTimer();botTick()}
  D.fetchSymbols().then(function(list){if(list.length)$('symlist').innerHTML=list.map(function(s){return '<option value="'+s+'">'}).join('')}).catch(function(){});
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)){
    // se uma versão nova assumir o controle de quem já tinha o app, recarrega uma vez para não ficar com arquivos velhos
    var hadCtl=!!navigator.serviceWorker.controller,reloaded=false;
    navigator.serviceWorker.addEventListener('controllerchange',function(){if(hadCtl&&!reloaded){reloaded=true;location.reload()}});
    window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').then(function(r){try{r.update()}catch(e){}}).catch(function(){})});
  }
}
init();
})();
