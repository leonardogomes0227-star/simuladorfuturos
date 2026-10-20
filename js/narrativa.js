// Narrativa: traduz logs, erros e operações do robô em frases claras para quem não é técnico.
// Funções puras, sem DOM.
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RadarNarrativa=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

function price(p){
  if(!isFinite(p))return '–';
  var a=Math.abs(p),d=a>=1000?2:(a>=10?3:(a>=1?4:(a>=0.01?5:8)));
  return p.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
}
function n2(n){return n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
function signed(n){return (n>0?'+':(n<0?'−':''))+n2(Math.abs(n))}
function coin(sym){return String(sym||'').replace(/USDT$/,'')}

// Erro técnico -> frase. Aceita "BTCUSDT: HTTP 451" e devolve {sym, text, kind}.
function friendlyError(msg){
  var raw=String(msg==null?'':msg),m=raw.match(/^([A-Z0-9]{4,20}):\s*(.*)$/),sym=m?m[1]:'',e=m?m[2]:raw,text,kind='other';
  if(/HTTP (451|403)/.test(e)){kind='blocked';text='A Binance recusou o acesso a partir daqui (restrição regional) e o servidor reserva também não respondeu. Tento de novo em instantes.'}
  else if(/HTTP (429|418)/.test(e)){kind='rate';text='A Binance pediu calma (muitas consultas). Espero um pouco e tento de novo sozinho.'}
  else if(/HTTP 5\d\d/.test(e)){kind='server';text='A Binance está instável agora. Tento de novo em instantes.'}
  else if(/não encontrado|HTTP (400|404)/i.test(e)){kind='notfound';text='Esse par não existe na Binance. Confira o nome (por exemplo, BTCUSDT).'}
  else if(/abort|timeout|timed out/i.test(e)){kind='timeout';text='A Binance demorou demais para responder. Tento de novo.'}
  else if(/sem velas/i.test(e)){kind='nodata';text='Ainda não há histórico suficiente desse par.'}
  else if(/failed to fetch|network|enotfound|econn|fetch failed|sem resposta|rede/i.test(e)){kind='network';text='Sem conexão com a Binance neste momento. Verifico de novo sozinho.'}
  else text='Algo inesperado aconteceu ao falar com a Binance ('+e+'). Vou tentar de novo.';
  return {sym:sym,text:(sym?coin(sym)+': ':'')+text,kind:kind};
}

// Linha do registro técnico do robô -> frase.
function friendlyLog(line){
  var s=String(line||''),m;
  if(s==='Robô ligado')return 'Robô ligado: começou a vigiar o mercado a partir de agora.';
  if(s==='Robô desligado pela configuração')return 'Robô desligado pelo arquivo de configuração. Nenhuma checagem está sendo feita.';
  if((m=s.match(/^Histórico zerado \((.*)\)$/)))return 'Conta do robô reiniciada para uma nova fase ('+m[1]+'). O placar de prontidão recomeçou do zero.';
  if(/faltou histórico/.test(s))return (s.match(/^([A-Z0-9]+):/)?coin(s.match(/^([A-Z0-9]+):/)[1])+': ':'')+'o robô ficou um tempo sem checar e perdeu algumas velas. A análise segue normal a partir de agora.';
  if((m=s.match(/^Configuração mudou: (\d+) posição/)))return 'A configuração mudou, então encerrei '+m[1]+' posição(ões) ao último preço para recomeçar do zero.';
  if((m=s.match(/^Capital só muda com o histórico zerado; mantido em (.*)$/)))return 'O capital só pode mudar com o histórico zerado. Mantive '+m[1]+' USDT.';
  return s;
}

// Motivo técnico da entrada -> frase simples.
function reasonText(r){
  var s=String(r||''),m;
  if(/^Médias .* alinhadas para cima/.test(s))return 'As médias apontam todas para cima (tendência de alta)';
  if(/^Médias .* alinhadas para baixo/.test(s))return 'As médias apontam todas para baixo (tendência de baixa)';
  if(/^Média \d+ subindo/.test(s))return 'A tendência de fundo está subindo';
  if(/^Média \d+ caindo/.test(s))return 'A tendência de fundo está caindo';
  if((m=s.match(/^RSI em (\d+), força sem exagero/)))return 'Força saudável, sem exagero (RSI '+m[1]+')';
  if((m=s.match(/^RSI em (\d+), fraqueza sem exagero/)))return 'Fraqueza saudável, sem exagero (RSI '+m[1]+')';
  if(/^Fechou acima da máxima/.test(s))return 'Rompeu a máxima das últimas 20 velas';
  if(/^Fechou abaixo da mínima/.test(s))return 'Rompeu a mínima das últimas 20 velas';
  if(/^Volume acima da média em vela de alta/.test(s))return 'Volume forte a favor da alta';
  if(/^Volume acima da média em vela de baixa/.test(s))return 'Volume forte a favor da baixa';
  return s;
}

function describeOpen(t){
  var long=t.side==='long',dist=t.dist0>0?t.dist0:Math.abs(t.entry-t.stop),rr=Math.abs(t.target-t.entry)/dist;
  return {kind:'open',icon:long?'🟢':'🔴',tone:long?'pos':'neg',
    title:(long?'Comprou ':'Vendeu ')+coin(t.sym),
    text:'Entrada perto de '+price(t.entry)+'. Stop em '+price(t.stop)+' (limite da perda) e alvo em '+price(t.target)+'. Retorno de '+rr.toFixed(1).replace('.',',')+' para 1.',
    why:(t.reasons||[]).map(reasonText),rr:rr};
}
function describeClose(t){
  var c=coin(t.sym),R=t.risk>0?t.pnl/t.risk:NaN,rtxt=isFinite(R)?' ('+(R>=0?'+':'−')+Math.abs(R).toFixed(1).replace('.',',')+'R)':'';
  var o={kind:'close',pnl:t.pnl,tone:t.pnl>0?'pos':(t.pnl<0?'neg':'')};
  switch(t.reason){
    case 'Alvo':o.icon='🎯';o.title='Alvo atingido em '+c;o.text='Lucro de '+signed(t.pnl)+' USDT'+rtxt+'. Plano cumprido.';break;
    case 'Stop':o.icon='🛑';o.title='Stop em '+c;o.text='Perda de '+signed(t.pnl)+' USDT'+rtxt+'. O stop existe para limitar a perda: faz parte do jogo.';break;
    case 'Stop móvel':o.icon='🔒';o.title=t.pnl>=0?'Lucro protegido em '+c:'Saída perto da entrada em '+c;o.text='O stop acompanhou o preço e fechou em '+signed(t.pnl)+' USDT'+rtxt+'.';break;
    case 'Tempo':o.icon='⏱️';o.title='Saída por tempo em '+c;o.text='A operação não andou como esperado e foi encerrada: '+signed(t.pnl)+' USDT'+rtxt+'.';break;
    case 'Manual':o.icon='✋';o.title='Encerrada manualmente em '+c;o.text='Fechada ao preço do momento: '+signed(t.pnl)+' USDT'+rtxt+'.';break;
    default:o.icon='ℹ️';o.title='Encerrada em '+c;o.text=signed(t.pnl)+' USDT'+rtxt+'.';
  }
  return o;
}
// Linha do tempo: eventos de abertura e fechamento, do mais novo para o mais antigo.
function timeline(trades,limit){
  var ev=[];
  (trades||[]).forEach(function(t){
    ev.push(Object.assign({at:t.openedAt,sym:t.sym,id:t.id},describeOpen(t)));
    if(t.status==='closed')ev.push(Object.assign({at:t.closedAt,sym:t.sym,id:t.id},describeClose(t)));
  });
  ev.sort(function(a,b){return b.at-a.at||(a.kind==='close'?-1:1)});
  return ev.slice(0,limit||40);
}

return {friendlyError:friendlyError,friendlyLog:friendlyLog,reasonText:reasonText,describeOpen:describeOpen,describeClose:describeClose,timeline:timeline,price:price};
});
