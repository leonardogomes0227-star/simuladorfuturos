// Tela "Escritório": placar das IAs e a mesa de cada uma. Só lê o estado gravado pelo servidor (escritorio-estado).
(function(){
'use strict';
var O=window.RadarOffice,Scene=window.RadarOfficeScene,timer=null,busy=false,box=null,last=null,err='',mounted=false;

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function money(v){return (v<0?'−':'')+Math.abs(v).toFixed(2).replace('.',',')}
function signed(v){return (v>0?'+':(v<0?'−':''))+Math.abs(v).toFixed(2).replace('.',',')}
function pct(v){return signed(v)+'%'}
function cls(v){return v>0?'pos':(v<0?'neg':'')}
function price(p){var a=Math.abs(p);return p.toLocaleString('pt-BR',{minimumFractionDigits:a>=1000?2:(a>=10?3:4),maximumFractionDigits:a>=1000?2:(a>=10?3:4)})}
function ago(ms){var s=Math.max(0,Math.round((Date.now()-ms)/1000));if(s<90)return 'agora há pouco';var m=Math.round(s/60);if(m<90)return 'há '+m+' min';var h=Math.round(m/60);return h<48?'há '+h+' h':'há '+Math.round(h/24)+' dias'}
function url(){var c=window.RADAR_CONFIG||{};return c.repo?'https://raw.githubusercontent.com/'+c.repo+'/'+(c.officeBranch||'escritorio-estado')+'/escritorio.json?t='+Date.now():''}

var BADGE={ok:['ok','operando'],erro:['bad','erro'],'sem chave':['warn','sem chave'],desligado:['off','desligada'],novo:['off','novo']};
function spark(curve,cap){
  if(!curve||curve.length<2)return '<div class="of-spark empty">Sem histórico ainda</div>';
  var w=240,h=48,vals=curve.map(function(p){return p.e}).concat([cap]),lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals);
  if(hi-lo<0.01){hi+=0.5;lo-=0.5}
  var pts=curve.map(function(p,i){return (i/(curve.length-1)*w).toFixed(1)+','+(h-(p.e-lo)/(hi-lo)*h).toFixed(1)}).join(' ');
  var y0=(h-(cap-lo)/(hi-lo)*h).toFixed(1),up=curve[curve.length-1].e>=cap;
  return '<svg class="of-spark" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" role="img" aria-label="Curva de saldo"><line x1="0" x2="'+w+'" y1="'+y0+'" y2="'+y0+'" class="base"/><polyline points="'+pts+'" class="'+(up?'up':'down')+'"/></svg>';
}
function actionLine(a){
  var word={abrir:'Abrir',fechar:'Fechar',ajustar:'Ajustar',manter:'Manter'}[a.acao]||a.acao;
  return '<li class="'+(a.ok?'ok':'no')+'"><b>'+esc(word)+(a.ativo?' '+esc(a.ativo.replace(/USDT$/,'')):'')+'</b> '+(a.ok?'✓ ':'recusada: ')+esc(a.msg)+(a.motivo?'<span class="why">“'+esc(a.motivo)+'”</span>':'')+'</li>';
}
function card(a,s,prices,meta){
  var b=BADGE[s.status]||BADGE.novo,open=O.openTrades(a),dec=a.decisions.length?a.decisions[a.decisions.length-1]:null;
  var h='<article class="card of-card" id="of-'+esc(a.id)+'"><header class="of-head"><div><h3>'+esc(a.name)+'</h3><span class="note">'+esc(a.provider==='regras'?'Sem IA · regras fixas':a.provider+(a.model?' · '+a.model:''))+'</span></div><span class="of-badge '+b[0]+'">'+b[1]+'</span></header>';
  h+='<div class="of-eq"><span class="num big">'+money(s.equity)+'</span><span class="note">USDT</span><span class="num '+cls(s.pnl)+'">'+pct(s.pnlPct)+'</span></div>';
  h+=spark(a.curve,a.capital);
  h+='<dl class="of-kv"><div><dt>Hoje</dt><dd class="num '+cls(s.today)+'">'+signed(s.today)+'</dd></div><div><dt>Operações</dt><dd class="num">'+s.trades+'</dd></div><div><dt>Acerto</dt><dd class="num">'+(s.trades?s.winRate.toFixed(0)+'%':'–')+'</dd></div><div><dt>Maior queda</dt><dd class="num">'+(s.trades?s.maxDD.toFixed(1).replace('.',',')+'%':'–')+'</dd></div></dl>';
  if(s.error)h+='<div class="warnbox">'+esc(s.error)+'</div>';
  h+='<div class="of-sec"><h4>Posições abertas</h4>';
  if(!open.length)h+='<p class="note">Nenhuma.</p>';
  else h+='<ul class="of-pos">'+open.map(function(t){var u=O.unrealized(t,prices[t.sym]);return '<li><b>'+esc(t.sym.replace(/USDT$/,''))+'</b> <span class="of-side '+t.side+'">'+(t.side==='long'?'compra':'venda')+'</span> '+t.lev+'x · entrada '+price(t.entry)+' · stop '+price(t.stop)+' · alvo '+price(t.target)+' <span class="num '+cls(u)+'">'+signed(u)+'</span></li>'}).join('')+'</ul>';
  h+='</div>';
  if(dec){
    h+='<div class="of-sec"><h4>Última decisão <span class="note">'+ago(dec.at)+'</span></h4>';
    if(dec.erro)h+='<p class="note neg">'+esc(dec.erro)+'</p>';
    else{if(dec.resumo)h+='<p class="of-say">'+esc(dec.resumo)+'</p>';
      h+=dec.acoes.length?'<ul class="of-acts">'+dec.acoes.map(actionLine).join('')+'</ul>':'<p class="note">Sem ordens.</p>'}
    h+='</div>';
  }
  var cl=O.closedTrades(a).slice(-4).reverse();
  if(cl.length)h+='<details class="of-sec"><summary>Últimas operações ('+cl.length+')</summary><ul class="of-pos">'+cl.map(function(t){return '<li><b>'+esc(t.sym.replace(/USDT$/,''))+'</b> '+(t.side==='long'?'compra':'venda')+' · '+esc(t.reason)+' <span class="num '+cls(t.pnl)+'">'+signed(t.pnl)+'</span></li>'}).join('')+'</ul></details>';
  if(a.usage&&a.usage.calls)h+='<p class="note of-use">'+a.usage.calls+' consultas · '+a.usage.errors+' erro'+(a.usage.errors===1?'':'s')+' · '+Math.round((a.usage.inTok+a.usage.outTok)/1000)+' mil tokens</p>';
  return h+'</article>';
}
function render(){
  if(!box)return;
  if(!last){
    if(Scene)Scene.set([],{});
    box.innerHTML='<div class="card"><h2>Escritório de IAs</h2><p class="note">'+(err==='404'
      ?'O escritório ainda não rodou. Vá em <b>Actions → Escritório de IAs → Run workflow</b> no GitHub para a primeira rodada (veja <code>escritorio/LEIA-ME.md</code>).'
      :(err?'Não consegui carregar o escritório agora. Tentando de novo em instantes.':'Carregando…'))+'</p></div>';
    return;
  }
  var st=O.sanitize(last.state),meta=last.meta||{},prices=meta.prices||{},now=Date.now();
  var lb=O.leaderboard(st,prices,now),ids=Object.keys(st.agents);
  if(Scene)Scene.set(ids.map(function(id){
    var a=st.agents[id],s=lb.filter(function(x){return x.id===id})[0],dec=a.decisions.length?a.decisions[a.decisions.length-1]:null;
    return {id:id,name:a.name,status:s.status,pnlPct:s.pnlPct,open:s.open,
      say:!dec?'Ainda não decidi nada.':(dec.erro?'Tive um problema: '+dec.erro:(dec.resumo||'Sem novidade por enquanto.'))};
  }),prices);
  var h='<div class="of-top"><div><h2>Placar</h2><p class="note">Cada IA começou com '+(meta.cfg?money(meta.cfg.capital):'100,00')+' USDT. Dinheiro de mentira, preços reais da Binance.</p></div><span class="note">Atualizado '+ago(meta.lastRun||0)+'</span></div>';
  if(meta.configError)h+='<div class="warnbox">Configuração com erro: '+esc(meta.configError)+'</div>';
  if(meta.cfg&&meta.cfg.on===false)h+='<div class="warnbox">O escritório está desligado em <code>escritorio/config.json</code> ("ligado": false). As IAs não decidem; só as posições abertas são acompanhadas.</div>';
  if(!ids.length)h+='<p class="note">Nenhuma IA configurada.</p>';
  else{
    h+='<ol class="of-board">'+lb.map(function(s,i){return '<li><span class="of-rank">'+(i+1)+'</span><span class="of-name">'+esc(s.name)+'</span><span class="num '+cls(s.pnl)+'">'+pct(s.pnlPct)+'</span><span class="num of-eqs">'+money(s.equity)+'</span></li>'}).join('')+'</ol>';
    h+='<div class="of-grid">'+lb.map(function(s){return card(st.agents[s.id],s,prices,meta)}).join('')+'</div>';
  }
  if(meta.cfg&&meta.cfg.rules){var r=meta.cfg.rules;h+='<p class="note of-rules">Regras da mesa (iguais para todas, aplicadas em código): risco máx. '+r.riskMaxPct+'% por operação · alavancagem máx. '+r.levMax+'x · até '+r.maxOpen+' posições · perda máx. do dia '+r.dailyLossPct+'% · velas de '+esc(meta.cfg.tf)+'.</p>'}
  box.innerHTML=h;
}
function load(){
  if(busy)return;var u=url();if(!u){err='config';render();return}
  busy=true;
  fetch(u,{cache:'no-store'}).then(function(r){if(r.status===404)throw new Error('404');if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})
    .then(function(j){if(!j||!j.state)throw new Error('formato');last=j;err=''})
    .catch(function(e){err=e.message==='404'?'404':'net'})
    .then(function(){busy=false;render()});
}
function show(){
  box=document.getElementById('officeBox');
  if(Scene){
    if(!mounted){
      mounted=true;
      Scene.mount(document.getElementById('officeCanvas'),function(id){var el=document.getElementById('of-'+id);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('flash');setTimeout(function(){el.classList.remove('flash')},1200)}});
      var b=document.getElementById('officeMeet');
      b.addEventListener('click',function(){var on=Scene.toggleMeeting();b.setAttribute('aria-pressed',on);b.textContent=on?'Voltar às mesas':'Chamar reunião'});
    }
    Scene.start();
  }
  render();load();clearInterval(timer);timer=setInterval(function(){if(!document.hidden)load()},60000)}
function hide(){clearInterval(timer);timer=null;if(Scene)Scene.stop()}
window.RadarOfficeUI={show:show,hide:hide};
})();
