// Sala isométrica do escritório: cada IA é um personagem na própria mesa. Só desenho (canvas 2D), sem biblioteca.
// Recebe a lista de IAs já pronta (RadarOfficeScene.set) e nunca decide nada: é só a vitrine do placar.
(function(){
'use strict';
var TW=64,TH=32,W=13,D=10,WH=96,VW=760,VH=480,OX=D*32+12,OY=WH+8;
var BODY=['#e0605c','#4aa3df','#f0b84a','#58c08a','#b277e0','#ef8bb3','#4fd0d0','#e8854a','#9aa5b8','#b8d65a'];
var SKIN=['#f2c7a0','#d9a273','#a8744a','#f5d5b8'];
var cv,ctx,list=[],prices={},actors={},raf=0,meeting=false,last=0,scale=1,dpr=1,reduce=false,clickCb=null;

function iso(x,y,z){return [(x-y)*TW/2+OX,(x+y)*TH/2-(z||0)+OY]}
function hash(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;return h}
function shade(hex,f){
  var n=parseInt(hex.slice(1),16),r=n>>16,g=n>>8&255,b=n&255;
  function c(v){return Math.max(0,Math.min(255,Math.round(f>=1?v+(255-v)*(f-1):v*f)))}
  return 'rgb('+c(r)+','+c(g)+','+c(b)+')';
}
function poly(pts,fill,stroke){
  ctx.beginPath();pts.forEach(function(p,i){i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])});ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}
}
// caixa: x,y no chão (em casas), z e h em pixels
function box(x,y,z,w,d,h,col){
  poly([iso(x,y,z+h),iso(x+w,y,z+h),iso(x+w,y+d,z+h),iso(x,y+d,z+h)],shade(col,1.12));
  poly([iso(x,y+d,z),iso(x+w,y+d,z),iso(x+w,y+d,z+h),iso(x,y+d,z+h)],shade(col,0.82));
  poly([iso(x+w,y,z),iso(x+w,y+d,z),iso(x+w,y+d,z+h),iso(x+w,y,z+h)],shade(col,0.62));
}
function ellipseIso(cx,cy,rx,ry,z,fill){
  var pts=[];for(var i=0;i<32;i++){var a=i/32*Math.PI*2;pts.push(iso(cx+Math.cos(a)*rx,cy+Math.sin(a)*ry,z))}
  poly(pts,fill);
}

/* ---------- cenário fixo ---------- */
function drawRoom(){
  var x,y;
  for(x=0;x<W;x++)for(y=0;y<D;y++)poly([iso(x,y,0),iso(x+1,y,0),iso(x+1,y+1,0),iso(x,y+1,0)],(x+y)%2?'#3b3656':'#363150');
  // paredes do fundo (y=0) e da esquerda (x=0)
  poly([iso(0,0,0),iso(W,0,0),iso(W,0,WH),iso(0,0,WH)],'#7b6aa0');
  poly([iso(0,0,0),iso(0,D,0),iso(0,D,WH),iso(0,0,WH)],'#5e4f82');
  poly([iso(0,0,0),iso(W,0,0),iso(W,0,8),iso(0,0,8)],'#4a3d68');
  poly([iso(0,0,0),iso(0,D,0),iso(0,D,8),iso(0,0,8)],'#3d3257');
  // janelas e painel na parede do fundo
  var o=iso(0,0,0);
  ctx.save();ctx.transform(1,0.5,0,1,o[0],o[1]);
  [14,84,282,352].forEach(function(u){
    var g=ctx.createLinearGradient(0,-80,0,-30);g.addColorStop(0,'#2c4a7a');g.addColorStop(1,'#f0a86a');
    ctx.fillStyle='#d8d0ea';ctx.fillRect(u-3,-83,66,56);ctx.fillStyle=g;ctx.fillRect(u,-80,60,50);
    ctx.fillStyle='rgba(216,208,234,.9)';ctx.fillRect(u+29,-80,3,50);
  });
  // quadro de preços
  ctx.fillStyle='#16132a';ctx.fillRect(160,-84,100,58);ctx.strokeStyle='#8f84b8';ctx.strokeRect(160,-84,100,58);
  ctx.font='600 9px IBM Plex Mono, monospace';ctx.textBaseline='alphabetic';
  var syms=Object.keys(prices).slice(0,4);
  ctx.fillStyle='#8f84b8';ctx.fillText('MERCADO',166,-72);
  syms.forEach(function(s,i){ctx.fillStyle='#e7eaee';ctx.fillText(s.replace(/USDT$/,''),166,-58+i*11);ctx.textAlign='right';ctx.fillText(prices[s]>=1000?Math.round(prices[s]).toLocaleString('pt-BR'):prices[s].toFixed(2),256,-58+i*11);ctx.textAlign='left'});
  ctx.restore();
  // quadro na parede da esquerda
  ctx.save();ctx.transform(-1,0.5,0,1,o[0],o[1]);
  [{u:70,c:'#4aa3df'},{u:210,c:'#58c08a'}].forEach(function(f){ctx.fillStyle='#d8d0ea';ctx.fillRect(f.u-3,-77,56,44);ctx.fillStyle=f.c;ctx.fillRect(f.u,-74,50,38);ctx.fillStyle='rgba(255,255,255,.55)';ctx.fillRect(f.u+8,-62,34,3);ctx.fillRect(f.u+8,-54,22,3)});
  ctx.restore();
  // tapete e mesa de reunião
  ellipseIso(6.5,7.4,3.2,2.2,0,'#4d3f78');ellipseIso(6.5,7.4,2.9,1.95,0,'#574886');
}
function plant(x,y){
  box(x,y,0,0.5,0.5,16,'#8a5a3a');
  [[0,34,12,'#3f9d64'],[-7,28,9,'#4fb877'],[7,30,9,'#348555'],[0,44,8,'#58c987']].forEach(function(c){var p=iso(x+0.25,y+0.25,0);ctx.beginPath();ctx.arc(p[0]+c[0],p[1]-c[1],c[2],0,7);ctx.fillStyle=c[3];ctx.fill()});
}
function table(cx,cy){
  box(cx-0.15,cy-0.15,0,0.3,0.3,22,'#6b4a30');
  ellipseIso(cx,cy,1.55,1.1,22,'#7c5636');ellipseIso(cx,cy,1.55,1.1,26,'#a87a4f');ellipseIso(cx,cy,1.2,0.85,26.5,'#b88a5a');
}

/* ---------- mesas e personagens ---------- */
function deskPos(i){var row=Math.floor(i/5),col=i%5;return {x:1.4+col*2.3,y:1.5+row*3.3}}
function seatPos(i){var d=deskPos(i);return {x:d.x+0.85,y:d.y-0.55}}
function meetPos(i,n){var a=(i/Math.max(1,n))*Math.PI*2+0.4;return {x:Math.min(W-0.5,6.5+Math.cos(a)*2.15),y:Math.min(D-0.4,7.4+Math.sin(a)*1.6)}}
function screenColor(a,t){
  if(a.status==='erro')return Math.floor(t/500)%2?'#e0605c':'#7a2e2c';
  if(a.status!=='ok')return '#2a2740';
  return a.pnlPct>0.005?'#38b48b':(a.pnlPct<-0.005?'#e0605c':'#4aa3df');
}
function drawDesk(a,i,t){
  var d=deskPos(i),sc=screenColor(a,t);
  box(d.x,d.y,0,1.7,0.9,30,'#b98a5a');
  box(d.x+0.7,d.y+0.28,30,0.3,0.12,5,'#2c2a3a');                     // base do monitor
  box(d.x+0.45,d.y+0.3,35,0.8,0.08,26,'#1c1a2c');                    // monitor
  poly([iso(d.x+0.49,d.y+0.38,38),iso(d.x+1.06,d.y+0.38,38),iso(d.x+1.06,d.y+0.38,57),iso(d.x+0.49,d.y+0.38,57)],sc);
  box(d.x+0.45,d.y+0.55,30,0.7,0.22,3,'#d6d2e6');                    // teclado
  if(a.open>0){var p=iso(d.x+1.45,d.y+0.45,30);ctx.fillStyle='#f0b84a';ctx.beginPath();ctx.arc(p[0],p[1]-4,5,0,7);ctx.fill()} // papel/ordem aberta
}
function drawChair(i){var s=seatPos(i);box(s.x-0.3,s.y-0.42,0,0.6,0.08,44,'#2e3a5c');box(s.x-0.3,s.y-0.3,0,0.6,0.6,18,'#3b4a78')}
function wrap(text,max){
  var words=String(text||'').split(/\s+/),lines=[],cur='';
  words.forEach(function(w){if((cur+' '+w).trim().length>max){if(cur)lines.push(cur);cur=w}else cur=(cur+' '+w).trim()});
  if(cur)lines.push(cur);
  if(lines.length>3){lines=lines.slice(0,3);lines[2]=lines[2].replace(/.{0,2}$/,'…')}
  return lines;
}
function roundRect(x,y,w,h,r,fill){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();ctx.fillStyle=fill;ctx.fill()}
function drawPerson(a,i,ac,t){
  var p=iso(ac.x,ac.y,0),sit=ac.sit,bob=reduce||sit?0:Math.sin(t/110+i)*1.6,body=BODY[hash(a.id)%BODY.length],skin=SKIN[hash(a.id+'s')%SKIN.length];
  var x=p[0],y=p[1]+bob,z0=sit?18:12;
  ctx.fillStyle='rgba(0,0,0,.28)';ctx.beginPath();ctx.ellipse(x,p[1],13,6,0,0,7);ctx.fill();
  if(!sit){ctx.fillStyle='#262338';ctx.fillRect(x-6,y-14,5,14);ctx.fillRect(x+1,y-14,5,14)}else{ctx.fillStyle='#262338';ctx.fillRect(x-7,y-20,14,8)}
  roundRect(x-9,y-z0-28,18,30,5,body);                               // tronco
  ctx.fillStyle=shade(body,0.75);ctx.fillRect(x-9,y-z0-12,18,3);
  var hy=y-z0-37;
  ctx.fillStyle=skin;ctx.beginPath();ctx.arc(x,hy,9,0,7);ctx.fill();
  ctx.fillStyle=shade(body,0.55);ctx.beginPath();ctx.arc(x,hy-2,9.5,Math.PI,0);ctx.fill();   // cabelo
  ctx.fillStyle='#1c1a2c';ctx.fillRect(x-4,hy,2,2);ctx.fillRect(x+2,hy,2,2);
  // etiqueta com nome e resultado
  var nm=a.name.length>12?a.name.slice(0,11)+'…':a.name,pc=(a.pnlPct>0?'+':'')+a.pnlPct.toFixed(1).replace('.',',')+'%';
  ctx.font='600 10px IBM Plex Sans, sans-serif';
  var w1=ctx.measureText(nm).width,w2=ctx.measureText(pc).width,tw=w1+w2+28,tx=x-tw/2,ty=hy-34;
  roundRect(tx,ty,tw,16,8,'rgba(14,16,19,.88)');
  var dot={ok:'#38b48b',erro:'#e0605c','sem chave':'#d9a441'}[a.status]||'#8c96a3';
  ctx.fillStyle=dot;ctx.beginPath();ctx.arc(tx+9,ty+8,3.2,0,7);ctx.fill();
  ctx.fillStyle='#e7eaee';ctx.fillText(nm,tx+16,ty+11.5);
  ctx.fillStyle=a.pnlPct>0.005?'#38b48b':(a.pnlPct<-0.005?'#e0605c':'#8c96a3');ctx.fillText(pc,tx+20+w1,ty+11.5);
  // balão de fala na reunião
  if(meeting&&!ac.moving&&a.say){
    var lines=wrap(a.say,22);ctx.font='500 10px IBM Plex Sans, sans-serif';
    var bw=Math.max.apply(null,lines.map(function(l){return ctx.measureText(l).width}))+14,bh=lines.length*12+9,bx=Math.max(4,Math.min(VW-bw-4,x-bw/2)),by=ty-bh-8;
    roundRect(bx,by,bw,bh,7,'#f4f1fb');
    ctx.beginPath();ctx.moveTo(x-4,by+bh);ctx.lineTo(x+4,by+bh);ctx.lineTo(x,by+bh+6);ctx.closePath();ctx.fillStyle='#f4f1fb';ctx.fill();
    ctx.fillStyle='#1c1a2c';lines.forEach(function(l,k){ctx.fillText(l,bx+7,by+14+k*12)});
  }
}

/* ---------- quadro a quadro ---------- */
function frame(now){
  raf=requestAnimationFrame(frame);
  var dt=Math.min(0.1,(now-(last||now))/1000);last=now;
  var k=reduce?1:1-Math.pow(0.02,dt);
  ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0);ctx.clearRect(0,0,VW,VH);
  drawRoom();
  var items=[],n=list.length;
  items.push({d:0.5+13*0+12.2+0.6,f:function(){plant(12.2,0.6)}});
  items.push({d:0.6+9.6,f:function(){plant(0.6,9.1)}});
  items.push({d:6.5+7.4,f:function(){table(6.5,7.4)}});
  list.forEach(function(a,i){
    var ac=actors[a.id],goal=meeting?meetPos(i,n):seatPos(i);
    if(!ac)ac=actors[a.id]={x:goal.x,y:goal.y,sit:true,moving:false};
    var dx=goal.x-ac.x,dy=goal.y-ac.y,dist=Math.sqrt(dx*dx+dy*dy);
    ac.x+=dx*k;ac.y+=dy*k;ac.moving=dist>0.06;ac.sit=!meeting&&!ac.moving;
    var dk=deskPos(i);
    items.push({d:dk.x+dk.y+0.9,f:function(){drawDesk(a,i,now)}});
    items.push({d:seatPos(i).x+seatPos(i).y,f:function(){drawChair(i)}});
    items.push({d:ac.x+ac.y+0.5,f:function(){drawPerson(a,i,ac,now)},hit:a});
  });
  items.sort(function(p,q){return p.d-q.d}).forEach(function(it){it.f()});
}
function resize(){
  if(!cv)return;
  var w=Math.max(280,cv.parentNode.clientWidth||VW);scale=Math.max(0.8,Math.min(1.2,w/VW));dpr=window.devicePixelRatio||1;
  cv.style.width=Math.round(VW*scale)+'px';cv.style.height=Math.round(VH*scale)+'px';
  cv.width=Math.round(VW*scale*dpr);cv.height=Math.round(VH*scale*dpr);
  var wrap=cv.parentNode;if(wrap.scrollWidth>wrap.clientWidth&&!wrap.dataset.c){wrap.dataset.c=1;wrap.scrollLeft=(wrap.scrollWidth-wrap.clientWidth)/2}
}
function mount(canvas,onClick){
  cv=canvas;ctx=cv.getContext('2d');clickCb=onClick||null;
  try{reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}
  cv.addEventListener('click',function(e){
    // acha o personagem mais perto do clique
    var r=cv.getBoundingClientRect(),mx=(e.clientX-r.left)/scale,my=(e.clientY-r.top)/scale,best=null,bd=900;
    list.forEach(function(a){var ac=actors[a.id];if(!ac)return;var p=iso(ac.x,ac.y,0),dd=Math.pow(p[0]-mx,2)+Math.pow(p[1]-36-my,2);if(dd<bd){bd=dd;best=a}});
    if(best&&clickCb)clickCb(best.id);
  });
  window.addEventListener('resize',resize);resize();
}
function set(agents,p){list=agents||[];prices=p||{}}
function start(){resize();if(!raf&&ctx){last=0;raf=requestAnimationFrame(frame)}}
function stop(){if(raf)cancelAnimationFrame(raf);raf=0}
function setMeeting(v){meeting=!!v;return meeting}
function toggleMeeting(){return setMeeting(!meeting)}
window.RadarOfficeScene={mount:mount,set:set,start:start,stop:stop,toggleMeeting:toggleMeeting,setMeeting:setMeeting};
})();
