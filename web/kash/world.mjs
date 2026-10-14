// Schematic artwork. Building types encode service profiles; scenery encodes no metrics.
export const LIGHT_PALETTE = { water:'#d0e8e0', ripple:'#a9d1c9', grass:'#9dbd68', grassLight:'#bfce88',
  grassDark:'#719353', earth:'#9b7755', earthDark:'#755c47', sand:'#e5d49d', path:'#dfc493',
  pathEdge:'#b79969', stone:'#ded9bd', stoneDark:'#aaa88a', roof:'#d0a557', roofDark:'#b38342',
  wood:'#986d4e', teal:'#4f9582', leaf:'#467659', leafLight:'#69936a', flower:'#e4a5a7',
  cream:'#fff4ce', ink:'#364d42', purple:'#9c84b5', purpleDark:'#796095', alert:'#b96955',
  shadow:'rgba(41,63,47,.16)', selection:'#f2c66a', white:'#fff8e3' };
export function worldPositions(places, width, height) {
  return places.map(p => ({ ...p, px: p.x * width, py: p.y * height }));
}
const oval = (c,x,y,rx,ry,color) => { c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill(); };
const poly = (c,points,color) => { c.fillStyle=color;c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill(); };
const rounded = (c,x,y,w,h,r,color) => { c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill(); };
function island(c,x,y,rx,ry,p) {
  oval(c,x,y+18,rx,ry,p.earthDark);oval(c,x,y+10,rx,ry,p.earth);
  oval(c,x,y,rx+2,ry+2,p.sand);oval(c,x,y-4,rx-3,ry-2,p.grass);
  oval(c,x-5,y-10,rx*.74,ry*.70,p.grassLight);
}
function tree(c,x,y,size,p) {
  oval(c,x+1,y+4,size*.63,size*.20,p.shadow);
  rounded(c,x-3,y-size*.54,6,size*.63,2,p.wood);
  oval(c,x,y-size*.8,size*.52,size*.50,p.leaf);
  oval(c,x-size*.22,y-size*1.06,size*.36,size*.36,p.leafLight);
  oval(c,x+size*.29,y-size*.88,size*.34,size*.36,p.leaf);
}
function rock(c,x,y,s,p) {
  oval(c,x,y+4,s,s*.38,p.shadow);
  poly(c,[[x-s,y],[x-s*.55,y-s*.58],[x+s*.4,y-s*.72],[x+s,y],[x+s*.45,y+s*.3]],p.stoneDark);
  poly(c,[[x-s,y],[x-s*.55,y-s*.58],[x+s*.4,y-s*.72],[x+s*.05,y]],p.stone);
}
function tower(c,x,y,w,h,p,roofColor=p.roof) {
  oval(c,x,y+5,w*.8,w*.23,p.shadow);
  rounded(c,x-w*.5,y-h,w,h,3,p.stone);
  poly(c,[[x+w*.20,y-h],[x+w*.5,y-h],[x+w*.5,y],[x+w*.20,y]],p.stoneDark);
  rounded(c,x-5,y-h*.62,10,15,5,p.ink);
  rounded(c,x-7,y-20,14,20,6,p.wood);
  poly(c,[[x-w*.7,y-h],[x,y-h-w*.65],[x+w*.7,y-h]],roofColor);
  poly(c,[[x,y-h-w*.65],[x+w*.7,y-h],[x+w*.08,y-h]],p.roofDark);
  rounded(c,x-1,y-h-w*.65-12,2,14,1,p.wood);
  poly(c,[[x+1,y-h-w*.65-12],[x+15,y-h-w*.65-8],[x+1,y-h-w*.65-3]],p.cream);
}
function archive(c,x,y,s,p,online) {
  const q={...p,roof:online?p.roof:p.stoneDark};
  rounded(c,x-38*s,y-37*s,76*s,37*s,3*s,q.stone);
  poly(c,[[x-38*s,y-37*s],[x,y-62*s],[x+38*s,y-37*s]],q.roof);
  rounded(c,x-10*s,y-23*s,20*s,23*s,8*s,p.wood);
  for(let i=-2;i<=2;i++)rounded(c,x+i*14*s-4*s,y-47*s,8*s,12*s,1*s,p.stone);
  tower(c,x-38*s,y,25*s,54*s,q,q.roof);tower(c,x+38*s,y,25*s,54*s,q,q.roof);
  for(let i=0;i<3;i++)rounded(c,x-17*s+i*17*s,y-35*s,7*s,10*s,3*s,p.ink);
}
function house(c,x,y,s,p,roof=p.alert) {
  oval(c,x,y+3*s,43*s,10*s,p.shadow);
  rounded(c,x-29*s,y-39*s,58*s,39*s,4*s,p.cream);
  poly(c,[[x+12*s,y-39*s],[x+29*s,y-39*s],[x+29*s,y],[x+12*s,y]],p.path);
  poly(c,[[x-38*s,y-39*s],[x-4*s,y-68*s],[x+38*s,y-39*s]],roof);
  poly(c,[[x-4*s,y-68*s],[x+38*s,y-39*s],[x+6*s,y-39*s]],p.roofDark);
  rounded(c,x-5*s,y-23*s,15*s,23*s,5*s,p.wood);
  rounded(c,x-21*s,y-29*s,10*s,11*s,2*s,p.teal);
  rounded(c,x+15*s,y-29*s,9*s,11*s,2*s,p.teal);
  rounded(c,x-25*s,y-70*s,8*s,22*s,2*s,p.stone);
}
function library(c,x,y,s,p) {
  oval(c,x,y,42*s,12*s,p.shadow);
  rounded(c,x-31*s,y-43*s,62*s,43*s,7*s,p.cream);
  poly(c,[[x-43*s,y-43*s],[x,y-80*s],[x+43*s,y-43*s]],p.teal);
  poly(c,[[x,y-80*s],[x+43*s,y-43*s],[x+10*s,y-43*s]],p.leaf);
  rounded(c,x-14*s,y-29*s,28*s,29*s,12*s,p.purpleDark);
  rounded(c,x-24*s,y-38*s,48*s,4*s,1*s,p.wood);
  for(let i=0;i<5;i++)rounded(c,x-19*s+i*8*s,y-35*s,5*s,10*s,1*s,i%2?p.roof:p.teal);
  tree(c,x+43*s,y-6*s,36*s,p);
}
function portal(c,x,y,s,p,hasLocal) {
  oval(c,x,y,37*s,12*s,p.shadow);
  c.strokeStyle=p.stone;c.lineWidth=12*s;c.beginPath();c.moveTo(x-23*s,y-3*s);c.lineTo(x-23*s,y-31*s);c.bezierCurveTo(x-23*s,y-68*s,x+23*s,y-68*s,x+23*s,y-31*s);c.lineTo(x+23*s,y-3*s);c.stroke();
  c.fillStyle=p.purple;c.beginPath();c.ellipse(x,y-25*s,17*s,28*s,0,0,Math.PI*2);c.fill();
  c.strokeStyle=p.cream;c.lineWidth=2*s;c.beginPath();c.ellipse(x,y-25*s,10*s,20*s,0,0,Math.PI*2);c.stroke();
  rounded(c,x-7*s,y-34*s,14*s,17*s,3*s,hasLocal?p.cream:p.purpleDark);
  rounded(c,x-28*s,y-2*s,56*s,6*s,2*s,p.stoneDark);
  for(let i=-1;i<=1;i++)oval(c,x+i*12*s,y+11*s,6*s,3*s,p.stone);
}
export function drawWorld(ctx,width,height,snapshot,selectedId='working',palette=LIGHT_PALETTE) {
  const p=palette, scale=Math.min(width/720,height/500), buildingScale=Math.max(.62,Math.min(1.15,scale));
  ctx.clearRect(0,0,width,height);ctx.fillStyle=p.water;ctx.fillRect(0,0,width,height);
  const places=worldPositions(snapshot?.places||[],width,height);
  // Three islands separate the two archive sites from the working / access meadow.
  island(ctx,width*.23,height*.235,width*.20,height*.135,p);
  island(ctx,width*.76,height*.325,width*.205,height*.24,p);
  island(ctx,width*.455,height*.69,width*.35,height*.27,p);
  ctx.strokeStyle=p.ripple;ctx.lineWidth=1.4;
  for(let i=0;i<12;i++){
    const x=(.04+((i*37)%93)/100)*width,y=(.07+((i*23)%87)/100)*height;
    ctx.beginPath();ctx.ellipse(x,y,8+((i*11)%14),2,0,0,Math.PI);ctx.stroke();
  }
  const lookup=new Map(places.map(v=>[v.id,v]));
  for(const edge of snapshot?.edges||[]){
    const a=lookup.get(edge.from),b=lookup.get(edge.to);if(!a||!b)continue;
    const path=()=>{ctx.beginPath();ctx.moveTo(a.px,a.py+8);ctx.bezierCurveTo(a.px,(a.py+b.py)/2,b.px,(a.py+b.py)/2,b.px,b.py+8)};
    ctx.lineCap='round';ctx.strokeStyle=p.pathEdge;ctx.lineWidth=12*buildingScale;path();ctx.stroke();
    ctx.strokeStyle=a.online&&b.online?p.path:p.stoneDark;ctx.lineWidth=8*buildingScale;path();ctx.stroke();
  }
  const foliage=[ [.12,.24], [.32,.20], [.34,.30], [.11,.32], [.84,.16], [.89,.35], [.65,.16], [.66,.39],
    [.82,.62], [.35,.83], [.17,.81], [.39,.67], [.52,.88], [.55,.62], [.35,.53], [.71,.67], [.6,.76], [.89,.43] ];
  foliage.forEach(([x,y],i)=>tree(ctx,x*width,y*height,(18+(i*7)%13)*buildingScale,p));
  [[.4,.77],[.60,.84],[.15,.15],[.66,.51],[.57,.54]].forEach(([x,y],i)=>rock(ctx,x*width,y*height,(6+i%3)*buildingScale,p));
  for(let i=0;i<26;i++){
    const x=(.17+((i*17)%56)/100)*width,y=(.52+((i*11)%34)/100)*height;
    ctx.strokeStyle=p.grassDark;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-2,y-4);ctx.moveTo(x,y);ctx.lineTo(x+2,y-5);ctx.stroke();
    if(i%4===0)oval(ctx,x+4,y-4,2,2,p.flower);
  }
  for(const place of [...places].sort((a,b)=>a.py-b.py)){
    const local=snapshot.resource.local_copies.find(c=>c.place_id===place.id);
    if(place.id===selectedId){
      ctx.strokeStyle=p.selection;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(place.px,place.py+4,45*buildingScale,15*buildingScale,0,0,Math.PI*2);ctx.stroke();
    }
    if(place.kind==='archive')archive(ctx,place.px,place.py,buildingScale*.82,p,place.online);
    else if(place.kind==='working'){house(ctx,place.px-12*buildingScale,place.py,buildingScale,p);house(ctx,place.px+28*buildingScale,place.py-10*buildingScale,buildingScale*.58,p,p.roof);}
    else if(place.kind==='index')library(ctx,place.px,place.py,buildingScale,p);
    else portal(ctx,place.px,place.py,buildingScale,p,local?.present);
    const badgeColor=!place.online?p.alert:place.kind==='archive'?(place.has_copy?p.teal:p.pathEdge):local?.present?p.teal:p.purple;
    oval(ctx,place.px+29*buildingScale,place.py-55*buildingScale,6,6,p.cream);
    oval(ctx,place.px+29*buildingScale,place.py-55*buildingScale,4,4,badgeColor);
  }
  return places;
}
