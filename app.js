'use strict';

(() => {
  const APP_VERSION = 21;
  const PK2_WIDTH = 2000;
  const PK2_HEIGHT = 3250;
  const PK2_DISPLAY_WIDTH = 2595;
  const PK2_DISPLAY_HEIGHT = 2134;
  const MIN_ZOOM = 0.08;
  const MAX_ZOOM = 10;
  const TAP_MOVE_PX = 9;
  const PK2_DISPLAY_TRANSFORM = { m00:1.2761893137143974, m01:-1.1086900344981845, m10:0.6801900753291124, m11:0.5251276563399424, tx:1815.506342488914, ty:-559.1567323436, im00:0.368696339593132, im01:0.7784201660829038, im10:-0.47756690772933746, im11:0.8960227535412332 };
  const RESOURCE_ZONE_BOUNDARY_GATE_IDS = new Set([126,127,128,129,131,132,133,136,137,138,139,142,143]);
  const PK2_ROUTE_WORKER_SOURCE = String.raw`
const W=2000,H=3250,N=W*H;
let bitset=null,stationBits=null,seaBits=null;
let gScore=new Uint32Array(N),roadScore=new Uint16Array(N),turnScore=new Uint16Array(N),seen=new Uint16Array(N),parentDir=new Uint8Array(N),generation=1;
const dirs=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function bitOn(bits,i){return !!bits&&((bits[i>>3]>>(i&7))&1)!==0}
function basePassable(i,allowSea){return bitOn(bitset,i)||(allowSea&&bitOn(seaBits,i))}
function isStationRoad(i){return bitOn(stationBits,i)}
function isSeaRoute(i){return bitOn(seaBits,i)}
function fillRuns(bits,runs){for(let k=0;k+1<runs.length;k+=2){const start=runs[k],len=runs[k+1];for(let i=start,end=Math.min(N,start+len);i<end;i++)bits[i>>3]|=1<<(i&7)}}
function makeBlocked(gates,ids){const wanted=new Set((ids||[]).map(Number)),out=new Set();if(!wanted.size)return out;for(const g of gates){if(!wanted.has(Number(g.id)))continue;for(let y=Number(g.ymin);y<=Number(g.ymax);y++)for(let x=Number(g.xmin);x<=Number(g.xmax);x++)out.add(y*W+x)}return out}
function heuristic(x,y,gx,gy){return Math.max(Math.abs(x-gx),Math.abs(y-gy))}
function betterHeap(a,b){return a.f<b.f||(a.f===b.f&&(a.r>b.r||(a.r===b.r&&a.t<b.t)))}
class Heap{constructor(){this.a=[]}get length(){return this.a.length}push(v){let p=this.a.length;this.a.push(v);while(p){const q=(p-1)>>1;if(betterHeap(this.a[q],v))break;this.a[p]=this.a[q];p=q}this.a[p]=v}pop(){const n=this.a.length;if(!n)return null;const out=this.a[0],last=this.a.pop();if(n>1){let p=0;while(true){let a=p*2+1;if(a>=n-1)break;let b=a+1,c=b<n-1&&betterHeap(this.a[b],this.a[a])?b:a;if(betterHeap(last,this.a[c]))break;this.a[p]=this.a[c];p=c}this.a[p]=last}return out}}
function bump(){generation++;if(generation>=65535){seen.fill(0);generation=1}}
function route(start,goal,blocked,maxExpand=3000000,allowSea=false){
  bump();const[sx,sy]=start,[gx,gy]=goal;
  if(sx<0||sx>=W||sy<0||sy>=H||gx<0||gx>=W||gy<0||gy>=H)return{status:'outside'};
  const sidx=sy*W+sx,gidx=gy*W+gx,can=i=>basePassable(i,allowSea)&&!blocked.has(i);
  if(!can(sidx))return{status:'start_blocked'};if(!can(gidx))return{status:'goal_blocked'};
  const heap=new Heap();seen[sidx]=generation;gScore[sidx]=0;roadScore[sidx]=isStationRoad(sidx)?1:0;turnScore[sidx]=0;parentDir[sidx]=0;
  heap.push({i:sidx,f:heuristic(sx,sy,gx,gy),g:0,r:roadScore[sidx],t:0});
  let expanded=0,bestGoal=0xffffffff;
  while(heap.length){
    const q=heap.pop(),idx=q.i;
    if(seen[idx]!==generation||gScore[idx]!==q.g||roadScore[idx]!==q.r||turnScore[idx]!==q.t)continue;
    if(q.f>bestGoal)break;
    if(idx===gidx){bestGoal=q.g;continue}
    if(++expanded>maxExpand)return{status:'max_expand',expanded};
    const x=idx%W,y=Math.floor(idx/W),prev=parentDir[idx]-1;
    for(let di=0;di<8;di++){
      const dx=dirs[di][0],dy=dirs[di][1],nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;
      const ni=ny*W+nx;if(!can(ni))continue;
      const ng=q.g+1,nf=ng+heuristic(nx,ny,gx,gy);if(nf>bestGoal)continue;
      const nr=Math.min(65535,q.r+(isStationRoad(ni)?1:0));
      const nt=Math.min(65535,q.t+((prev>=0&&prev!==di)?1:0));
      const better=seen[ni]!==generation||ng<gScore[ni]||(ng===gScore[ni]&&(nr>roadScore[ni]||(nr===roadScore[ni]&&nt<turnScore[ni])));
      if(better){seen[ni]=generation;gScore[ni]=ng;roadScore[ni]=nr;turnScore[ni]=nt;parentDir[ni]=di+1;heap.push({i:ni,f:nf,g:ng,r:nr,t:nt})}
    }
  }
  if(seen[gidx]!==generation||gScore[gidx]===0xffffffff)return{status:'no_path',expanded};
  const rev=[gidx];let cur=gidx;
  while(cur!==sidx){const code=parentDir[cur]-1;if(code<0)return{status:'parent_error'};const[dx,dy]=dirs[code],x=cur%W,y=Math.floor(cur/W);cur=(y-dy)*W+(x-dx);rev.push(cur)}
  rev.reverse();let seaCells=0;if(allowSea)for(const idx of rev)if(isSeaRoute(idx))seaCells++;
  return{status:'ok',path:rev,steps:rev.length-1,stationCells:roadScore[gidx],seaCells,turns:turnScore[gidx],expanded};
}
function routeAll(points,blocked,maxExpand,allowSea=false){let total=0,station=0,sea=0,turns=0,expanded=0,full=[],segments=[];for(let k=0;k<points.length-1;k++){const r=route(points[k],points[k+1],blocked,maxExpand,allowSea);expanded+=r.expanded||0;segments.push({start:points[k],goal:points[k+1],status:r.status,steps:r.steps??null,stationCells:r.stationCells??null,seaCells:r.seaCells??null,expanded:r.expanded||0});if(r.status!=='ok')return{status:r.status,totalSteps:null,segments,expanded};total+=r.steps;station+=r.stationCells||0;sea+=r.seaCells||0;turns+=r.turns||0;full=full.concat(k?r.path.slice(1):r.path)}return{status:'ok',totalSteps:total,stationCells:station,seaCells:sea,turns,segments,expanded,path:full}}
function requiredSet(points){const s=new Set();for(const p of points||[])s.add(Number(p[1])*W+Number(p[0]));return s}
function blockRouteInterior(path,set,required){if(!path||path.length<3)return;for(let i=1;i<path.length-1;i++){const idx=path[i];if(!required.has(idx))set.add(idx)}}
function blockDiversityWindow(path,set,required,ratio,windowSize=7){if(!path||path.length<5)return;const center=Math.max(1,Math.min(path.length-2,Math.floor((path.length-1)*ratio))),half=Math.floor(windowSize/2);for(let i=Math.max(1,center-half);i<=Math.min(path.length-2,center+half);i++){const idx=path[i];if(!required.has(idx))set.add(idx)}}
function pack(r){return{totalSteps:r.totalSteps,stationCells:r.stationCells,seaCells:r.seaCells||0,turns:r.turns,expanded:r.expanded,path:new Uint32Array(r.path)}}
self.onmessage=e=>{const m=e.data;if(m.type==='init'){bitset=new Uint8Array(m.buffer);stationBits=new Uint8Array(Math.ceil(N/8));seaBits=new Uint8Array(Math.ceil(N/8));const runs=m.stationRuns?new Uint32Array(m.stationRuns):new Uint32Array(0);fillRuns(stationBits,runs);const seaRuns=m.seaRuns?new Uint32Array(m.seaRuns):new Uint32Array(0);fillRuns(seaBits,seaRuns);self.postMessage({type:'ready'});return}if(m.type!=='route')return;try{
  if(!bitset)throw new Error('route data not initialized');const gateBlocked=makeBlocked(m.gates||[],m.blockedGateIds||[]),pts=m.points||[],routeCount=Math.max(1,Math.min(3,Number(m.routeCount)||1)),allowSea=m.allowSea!==false,routes=[];
  const r1=routeAll(pts,gateBlocked,m.maxExpand||3000000,allowSea);if(r1.status!=='ok'){self.postMessage({type:'result',requestId:m.requestId,status:r1.status});return}routes.push(pack(r1));
  if(routeCount>=2){const req=requiredSet(pts),avoid1=new Set(gateBlocked);blockRouteInterior(r1.path,avoid1,req);const r2=routeAll(pts,avoid1,m.maxExpand||3000000,allowSea);if(r2.status==='ok'){routes.push(pack(r2));if(routeCount>=3){let r3=null;for(const ratio of [.5,.34,.66,.25,.75]){const avoid3=new Set(avoid1);blockDiversityWindow(r2.path,avoid3,req,ratio,7);const trial=routeAll(pts,avoid3,m.maxExpand||3000000,allowSea);if(trial.status==='ok'){r3=trial;break}}if(r3)routes.push(pack(r3))}}
  }
  const transfers=routes.map(r=>r.path.buffer);self.postMessage({type:'result',requestId:m.requestId,status:'ok',routes},transfers)
}catch(err){self.postMessage({type:'result',requestId:m.requestId,status:'error',message:String(err&&err.message||err)})}}
`;

  const $ = id => document.getElementById(id);
  const refs = {
    stage: $('mapStage'), canvas: $('mapCanvas'), fitBtn: $('fitBtn'), helpBtn: $('helpBtn'), helpDialog: $('helpDialog'),
    search: $('placeSearch'), searchClear: $('searchClearBtn'), searchResults: $('searchResults'),
    toggleCity: $('toggleCityNames'), toggleGate: $('toggleGateNames'), toggleResource: $('toggleResourceZones'),
    routeSheet: $('routeSheet'), sheetBackdrop: $('sheetBackdrop'),
    routePointsList: $('routePointsList'), addPointFromMap: $('addPointFromMapBtn'), clearRoute: $('clearRouteBtn'),
    calculateRoute: $('calculateRouteBtn'), routeResult: $('routeResult'), showAlternate: $('showAlternateRoutesBtn'),
    gateFilter: $('gateFilter'), gateBlockList: $('gateBlockList'), clearBlocked: $('clearBlockedGatesBtn'), blockedGateCount: $('blockedGateCount'),
    routeAddBanner: $('routeAddBanner'), routeUndoQuick: $('routeUndoQuickBtn'), routeClearQuick: $('routeClearQuickBtn'), routeAddDone: $('routeAddDoneBtn'),
    coordinatePill: $('coordinatePill'), gamePosition: $('gamePosition'), toast: $('toast'), loadingBadge: $('loadingBadge'),
    placeSheet: $('placeSheet'), placeTitle: $('placeSheetTitle'), placeMeta: $('placeSheetMeta'), placeStart: $('placeStartBtn'), placeGoal: $('placeGoalBtn'),
    placeVia: $('placeViaBtn'), placeCopy: $('placeCopyBtn'), placeCopyCoord: $('placeCopyCoord'), placeBlockGate: $('placeBlockGateBtn')
  };

  const ctx = refs.canvas.getContext('2d');
  const data = window.PK2_EMBEDDED || {};
  const cities = Array.isArray(data.cities) ? data.cities : [];
  const gates = Array.isArray(data.gates) ? data.gates : [];
  const places = [
    ...cities.map(o => ({...o, _kind:'city'})),
    ...gates.map(o => ({...o, _kind:'gate'}))
  ];
  const placeByKey = new Map(places.map(p => [`${p._kind}:${p.id}`, p]));
  const passableMainBits = data.passableLandB64 ? decodeBase64Bytes(data.passableLandB64) : new Uint8Array(0);
  const seaRouteMain = new Set();
  if(Array.isArray(data.seaRouteRuns)) {
    for(let k=0;k+1<data.seaRouteRuns.length;k+=2) {
      const start=Number(data.seaRouteRuns[k])||0, len=Number(data.seaRouteRuns[k+1])||0;
      for(let i=start,end=Math.min(PK2_WIDTH*PK2_HEIGHT,start+len);i<end;i++) seaRouteMain.add(i);
    }
  }

  function mainBitOn(bits,index) { return !!bits.length && index>=0 && index<PK2_WIDTH*PK2_HEIGHT && ((bits[index>>3]>>(index&7))&1)!==0; }
  function isPassableGamePoint(x,y) {
    x=Math.round(Number(x));y=Math.round(Number(y));
    if(x<0||x>=PK2_WIDTH||y<0||y>=PK2_HEIGHT)return false;
    const idx=y*PK2_WIDTH+x;
    return mainBitOn(passableMainBits,idx)||seaRouteMain.has(idx);
  }
  function mapPointObject(x,y) { return {_kind:'point',id:`point:${x},${y}`,name:'地点',center_x:x,center_y:y,level:0,province_names:''}; }

  const mapImage = new Image();
  const zoneImage = new Image();
  let mapReady = false;
  let zoneReady = false;
  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let view = { x: 0, y: 0, scale: 1 };
  let renderPending = false;
  let routeWorker = null;
  let routeWorkerReady = false;
  let routeBusy = false;
  let requestSeq = 0;
  let activeRouteRequestId = 0;
  let selectedPlace = null;
  let routeAddMode = false;
  let pendingAutoRoute = false;
  let routeReorder = null;
  let lastGamePosition = null;
  let searchMatches = [];
  let toastTimer = 0;

  const state = loadState();
  state.routePoints = Array.isArray(state.routePoints) ? state.routePoints.filter(validPoint) : [];
  state.blockedGates = Array.isArray(state.blockedGates) ? state.blockedGates.map(Number).filter(Number.isFinite) : [];
  state.routeGoalSet = state.routeGoalSet === true;
  state.routePath = [];
  state.altPaths = [];
  state.routeResult = null;
  state.showAlternates = false;

  const pointers = new Map();
  let gesture = null;

  function loadState() {
    const base = { showCityNames:true, showGateNames:true, showResourceZones:false, routePoints:[], blockedGates:[], routeGoalSet:false };
    try {
      const saved = JSON.parse(localStorage.getItem('pk2-mobile-state') || 'null');
      return Object.assign(base, saved && typeof saved === 'object' ? saved : {});
    } catch { return base; }
  }
  function saveState() {
    try {
      localStorage.setItem('pk2-mobile-state', JSON.stringify({
        showCityNames:state.showCityNames, showGateNames:state.showGateNames, showResourceZones:state.showResourceZones,
        routePoints:state.routePoints, blockedGates:state.blockedGates, routeGoalSet:state.routeGoalSet === true
      }));
    } catch {}
  }
  function validPoint(p) { return Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])); }
  function clamp(v,a,b) { return Math.max(a, Math.min(b, v)); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function gateDisplayName(g) { return `${g.name}${Number(g.level) ? ` Lv.${g.level}` : ''}`; }
  function placeDisplayName(p) {
    if(p._kind === 'point') return `地点 ${p.center_x},${p.center_y}`;
    return p._kind === 'gate' ? gateDisplayName(p) : p.name;
  }
  function placeMetaText(p) {
    if(p._kind === 'point') return `通行可能 ・ ${p.center_x},${p.center_y}`;
    const province = p.province_names || '';
    const level = p._kind === 'city' && Number(p.level) ? `Lv.${p.level}` : '';
    return [p._kind === 'gate' ? '関所' : '城', level, province, `${p.center_x},${p.center_y}`].filter(Boolean).join(' ・ ');
  }

  function gameToWorld(x,y) {
    const t = PK2_DISPLAY_TRANSFORM;
    return { x:t.m00*x+t.m01*y+t.tx, y:t.m10*x+t.m11*y+t.ty };
  }
  function worldToGame(x,y) {
    const t = PK2_DISPLAY_TRANSFORM, dx=x-t.tx, dy=y-t.ty;
    return { x:t.im00*dx+t.im01*dy, y:t.im10*dx+t.im11*dy };
  }
  function clientToWorld(cx,cy) {
    const r = refs.canvas.getBoundingClientRect();
    return { x:(cx-r.left-view.x)/view.scale, y:(cy-r.top-view.y)/view.scale };
  }
  function clientToGame(cx,cy) { const w=clientToWorld(cx,cy); return worldToGame(w.x,w.y); }
  function worldToClient(x,y) { const r=refs.canvas.getBoundingClientRect(); return {x:r.left+view.x+x*view.scale,y:r.top+view.y+y*view.scale}; }

  function resizeCanvas() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const r = refs.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width*dpr)), h = Math.max(1, Math.round(r.height*dpr));
    if (refs.canvas.width !== w || refs.canvas.height !== h) { refs.canvas.width=w; refs.canvas.height=h; }
    requestRender();
  }
  function fitView() {
    const r = refs.canvas.getBoundingClientRect();
    const pad = 18;
    const scale = Math.min((r.width-pad*2)/PK2_DISPLAY_WIDTH, (r.height-pad*2)/PK2_DISPLAY_HEIGHT);
    view.scale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    view.x = (r.width-PK2_DISPLAY_WIDTH*view.scale)/2;
    view.y = (r.height-PK2_DISPLAY_HEIGHT*view.scale)/2;
    requestRender();
  }
  function zoomAt(factor,cx,cy) {
    const r=refs.canvas.getBoundingClientRect(), px=cx-r.left, py=cy-r.top;
    const wx=(px-view.x)/view.scale, wy=(py-view.y)/view.scale;
    const next=clamp(view.scale*factor,MIN_ZOOM,MAX_ZOOM);
    view.scale=next; view.x=px-wx*next; view.y=py-wy*next; requestRender();
  }
  function requestRender() { if(renderPending)return; renderPending=true; requestAnimationFrame(()=>{renderPending=false;render();}); }

  function render() {
    const rect=refs.canvas.getBoundingClientRect();
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,rect.width,rect.height);
    ctx.fillStyle='#0b1117'; ctx.fillRect(0,0,rect.width,rect.height);
    if(!mapReady)return;
    ctx.save(); ctx.translate(view.x,view.y); ctx.scale(view.scale,view.scale);
    ctx.drawImage(mapImage,0,0,PK2_DISPLAY_WIDTH,PK2_DISPLAY_HEIGHT);
    if(state.showResourceZones && zoneReady) ctx.drawImage(zoneImage,0,0,PK2_DISPLAY_WIDTH,PK2_DISPLAY_HEIGHT);
    drawReferenceMarkersAndLabels();
    drawRoutes();
    ctx.restore();
  }

  function labelVisibilityThreshold(p) {
    if(view.scale < .23) return Number(p.level||0) >= 8;
    if(view.scale < .38) return Number(p.level||0) >= 7;
    if(view.scale < .55) return Number(p.level||0) >= 6;
    return true;
  }
  function drawReferenceMarkersAndLabels() {
    const radiusCity=Math.max(2.2,3.1/view.scale), radiusGate=Math.max(2.7,3.9/view.scale);
    for(const c of cities) {
      const p=gameToWorld(Number(c.center_x),Number(c.center_y));
      ctx.beginPath();ctx.arc(p.x,p.y,radiusCity,0,Math.PI*2);ctx.fillStyle='#842b27';ctx.fill();ctx.strokeStyle='#f1d3c6';ctx.lineWidth=Math.max(.7,1/view.scale);ctx.stroke();
    }
    for(const g of gates) {
      const p=gameToWorld(Number(g.center_x),Number(g.center_y)), r=radiusGate;
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.PI/4);ctx.fillStyle='#c5851d';ctx.fillRect(-r*.75,-r*.75,r*1.5,r*1.5);ctx.strokeStyle='#ffe0a0';ctx.lineWidth=Math.max(.7,1/view.scale);ctx.strokeRect(-r*.75,-r*.75,r*1.5,r*1.5);ctx.restore();
    }
    if(state.showResourceZones) drawResourceZoneBoundaryGates();
    const items=[];
    if(state.showGateNames) for(const g of gates) if(labelVisibilityThreshold(g)) items.push({o:g,kind:'gate',text:gateDisplayName(g),priority:2000+Number(g.level||0)});
    if(state.showCityNames) for(const c of cities) if(labelVisibilityThreshold(c)) items.push({o:c,kind:'city',text:c.name,priority:1000+Number(c.level||0)});
    items.sort((a,b)=>b.priority-a.priority||Number(a.o.id)-Number(b.o.id));
    const placed=[]; const offsets=[[0,-15],[0,15],[16,0],[-16,0],[15,-13],[-15,-13],[15,13],[-15,13],[0,-28],[0,28]];
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';
    for(const item of items) {
      const p=gameToWorld(Number(item.o.center_x),Number(item.o.center_y));
      const fs=Math.max(9,11.5/view.scale); ctx.font=`700 ${fs}px system-ui, "Noto Sans JP", sans-serif`;
      const tw=ctx.measureText(item.text).width; let chosen=null;
      for(const d of offsets) {
        const cx=p.x+d[0]/view.scale, cy=p.y+d[1]/view.scale;
        const box={l:cx-tw/2-3/view.scale,r:cx+tw/2+3/view.scale,t:cy-fs*.72,b:cy+fs*.72};
        if(!placed.some(z=>!(box.r<z.l||box.l>z.r||box.b<z.t||box.t>z.b))){chosen={cx,cy,box};break;}
      }
      if(!chosen)continue;placed.push(chosen.box);
      ctx.lineJoin='round';ctx.strokeStyle='rgba(8,15,22,.96)';ctx.lineWidth=3.1/view.scale;ctx.strokeText(item.text,chosen.cx,chosen.cy);
      ctx.fillStyle=item.kind==='gate'?'#ffd166':'#f8fbff';ctx.fillText(item.text,chosen.cx,chosen.cy);
    }
    ctx.restore();
  }
  function drawResourceZoneBoundaryGates() {
    ctx.save();
    for(const g of gates) if(RESOURCE_ZONE_BOUNDARY_GATE_IDS.has(Number(g.id))) {
      const p=gameToWorld(Number(g.center_x),Number(g.center_y)), r=Math.max(6,9/view.scale);
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.strokeStyle='#ffdf43';ctx.lineWidth=Math.max(1.5,2.8/view.scale);ctx.stroke();
      ctx.beginPath();ctx.arc(p.x,p.y,r*1.45,0,Math.PI*2);ctx.strokeStyle='rgba(255,223,67,.75)';ctx.lineWidth=Math.max(1,1.5/view.scale);ctx.stroke();
    }
    ctx.restore();
  }
  function drawRoutes() {
    drawRoutePath(state.routePath,'#ef4d43',[]);
    if(state.showAlternates && state.altPaths[0]) drawRoutePath(state.altPaths[0],'#2ac1d6',[8,5]);
    if(state.showAlternates && state.altPaths[1]) drawRoutePath(state.altPaths[1],'#bf73ff',[3,5]);
    for(let i=0;i<state.routePoints.length;i++) {
      const [gx,gy]=state.routePoints[i], p=gameToWorld(gx+.5,gy+.5), r=Math.max(4,6/view.scale);
      ctx.save();ctx.fillStyle=i===0?'#23b967':(state.routeGoalSet&&i===state.routePoints.length-1&&i>0?'#e13d36':'#ffd54d');ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(1,1.4/view.scale);ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.fillStyle='#111';ctx.font=`900 ${Math.max(8,10/view.scale)}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),p.x,p.y);ctx.restore();
    }
  }
  function drawRoutePath(path,color,dash) {
    if(!Array.isArray(path)||path.length<2)return;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.8,3.4/view.scale);ctx.lineJoin='round';ctx.lineCap='round';ctx.setLineDash((dash||[]).map(v=>v/view.scale));ctx.beginPath();
    for(let i=0;i<path.length;i++){const idx=Number(path[i]),gx=idx%PK2_WIDTH+.5,gy=Math.floor(idx/PK2_WIDTH)+.5,p=gameToWorld(gx,gy);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y)}ctx.stroke();ctx.restore();
  }

  function nearestPlaceAtClient(cx,cy,maxPx=23) {
    let best=null,bestD=maxPx;
    for(const p of places) {
      const w=gameToWorld(Number(p.center_x),Number(p.center_y)); const c=worldToClient(w.x,w.y); const d=Math.hypot(c.x-cx,c.y-cy);
      if(d<bestD){best=p;bestD=d;}
    }
    return best;
  }

  function updateCoordinateFromClient(cx,cy) {
    const g=clientToGame(cx,cy); if(!Number.isFinite(g.x)||!Number.isFinite(g.y))return;
    const x=Math.round(g.x),y=Math.round(g.y);
    if(x<0||x>=PK2_WIDTH||y<0||y>=PK2_HEIGHT){lastGamePosition=null;refs.gamePosition.textContent='--,--';return;}
    lastGamePosition=[x,y];refs.gamePosition.textContent=`${x},${y}`;
  }

  function onPointerDown(e) {
    refs.canvas.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});
    if(pointers.size===1) gesture={type:'pending',pointerId:e.pointerId,startViewX:view.x,startViewY:view.y,startX:e.clientX,startY:e.clientY,moved:false};
    else if(pointers.size===2) {
      const arr=[...pointers.values()], dx=arr[1].x-arr[0].x,dy=arr[1].y-arr[0].y,dist=Math.hypot(dx,dy)||1,cx=(arr[0].x+arr[1].x)/2,cy=(arr[0].y+arr[1].y)/2;
      const r=refs.canvas.getBoundingClientRect(), px=cx-r.left,py=cy-r.top; gesture={type:'pinch',startDist:dist,startScale:view.scale,worldX:(px-view.x)/view.scale,worldY:(py-view.y)/view.scale};
    }
  }
  function onPointerMove(e) {
    const p=pointers.get(e.pointerId); if(p){p.x=e.clientX;p.y=e.clientY;}
    updateCoordinateFromClient(e.clientX,e.clientY);
    if(pointers.size===2&&gesture?.type==='pinch'){
      const arr=[...pointers.values()],dx=arr[1].x-arr[0].x,dy=arr[1].y-arr[0].y,dist=Math.hypot(dx,dy)||1,cx=(arr[0].x+arr[1].x)/2,cy=(arr[0].y+arr[1].y)/2,r=refs.canvas.getBoundingClientRect(),px=cx-r.left,py=cy-r.top;
      const next=clamp(gesture.startScale*(dist/gesture.startDist),MIN_ZOOM,MAX_ZOOM);view.scale=next;view.x=px-gesture.worldX*next;view.y=py-gesture.worldY*next;requestRender();return;
    }
    if(pointers.size===1&&gesture&&gesture.pointerId===e.pointerId){
      const dx=e.clientX-gesture.startX,dy=e.clientY-gesture.startY;if(Math.hypot(dx,dy)>TAP_MOVE_PX)gesture.moved=true;
      if(gesture.moved){view.x=gesture.startViewX+dx;view.y=gesture.startViewY+dy;gesture.type='pan';requestRender();}
    }
  }
  function onPointerUp(e) {
    const p=pointers.get(e.pointerId); const wasSingle=pointers.size===1; const g=gesture;
    pointers.delete(e.pointerId);
    if(wasSingle&&p&&g&&g.pointerId===e.pointerId&&!g.moved) handleMapTap(e.clientX,e.clientY);
    if(pointers.size===1){const rem=[...pointers.entries()][0];gesture={type:'pending',pointerId:rem[0],startViewX:view.x,startViewY:view.y,startX:rem[1].x,startY:rem[1].y,moved:true};}
    else if(!pointers.size) gesture=null;
  }
  function handleMapTap(cx,cy) {
    updateCoordinateFromClient(cx,cy);
    if(routeAddMode){
      if(!lastGamePosition)return;
      const [x,y]=lastGamePosition;
      if(!isPassableGamePoint(x,y)){showToast('この地点は通行できません',true);return;}
      if(state.routeGoalSet&&state.routePoints.length>=2)state.routePoints.splice(state.routePoints.length-1,0,[x,y]);else state.routePoints.push([x,y]);
      afterRoutePointEdit(state.routePoints.length>=2);showToast(`経路点 ${state.routePoints.length} を追加しました`);return;
    }
    const place=nearestPlaceAtClient(cx,cy);
    if(place){openPlaceSheet(place);return;}
    if(lastGamePosition){
      const [x,y]=lastGamePosition;
      if(isPassableGamePoint(x,y))openPlaceSheet(mapPointObject(x,y));
      else showToast('この地点は通行できません',true);
    }
  }

  function searchPlaces(query) {
    const q=String(query||'').trim().toLowerCase(); if(!q)return [];
    return places.filter(p=>placeDisplayName(p).toLowerCase().includes(q)||String(p.province_names||'').toLowerCase().includes(q)).sort((a,b)=>{
      const ae=placeDisplayName(a).toLowerCase()===q?0:1,be=placeDisplayName(b).toLowerCase()===q?0:1;if(ae!==be)return ae-be;if(a._kind!==b._kind)return a._kind==='gate'?-1:1;return Number(b.level||0)-Number(a.level||0);
    }).slice(0,12);
  }
  function updateSearchResults() {
    const q=refs.search.value.trim();refs.searchClear.hidden=!q;searchMatches=searchPlaces(q);refs.searchResults.innerHTML='';
    if(!q||!searchMatches.length){refs.searchResults.hidden=true;return;}
    for(const p of searchMatches){const b=document.createElement('button');b.type='button';b.className='search-result';b.innerHTML=`<span class="place-kind ${p._kind==='gate'?'gate':''}">${p._kind==='gate'?'関所':'城'}</span><span class="search-result-main"><b>${escapeHtml(placeDisplayName(p))}</b><small>${escapeHtml([p.province_names,`${p.center_x},${p.center_y}`].filter(Boolean).join(' ・ '))}</small></span>`;b.addEventListener('click',()=>{refs.searchResults.hidden=true;refs.search.blur();centerOnPlace(p);openPlaceSheet(p);});refs.searchResults.appendChild(b);}
    refs.searchResults.hidden=false;
  }
  function centerOnPlace(p) {
    const w=gameToWorld(Number(p.center_x),Number(p.center_y)),r=refs.canvas.getBoundingClientRect();view.scale=Math.max(view.scale,.8);view.x=r.width/2-w.x*view.scale;view.y=r.height/2-w.y*view.scale;requestRender();
  }

  function resetSheetDrag(sheet) {
    if(!sheet)return;sheet.style.removeProperty('--sheet-drag-y');sheet.classList.remove('sheet-dragging');
    refs.sheetBackdrop.style.removeProperty('opacity');
  }
  function openSheet(sheet) { closeSheets(false);resetSheetDrag(sheet);refs.sheetBackdrop.hidden=false;sheet.hidden=false; }
  function closeSheets(hideBackdrop=true) {
    resetSheetDrag(refs.routeSheet);resetSheetDrag(refs.placeSheet);
    refs.routeSheet.hidden=true;refs.placeSheet.hidden=true;if(hideBackdrop)refs.sheetBackdrop.hidden=true;
  }
  function openRouteSheet() { syncRouteUi();openSheet(refs.routeSheet); }
  function openPlaceSheet(p) {
    selectedPlace=p;refs.placeTitle.textContent=placeDisplayName(p);refs.placeMeta.textContent=placeMetaText(p);refs.placeCopyCoord.textContent=`${p.center_x},${p.center_y}`;refs.placeBlockGate.hidden=p._kind!=='gate';
    if(p._kind==='gate'){const blocked=state.blockedGates.includes(Number(p.id));refs.placeBlockGate.querySelector('b').textContent=blocked?'通行許可':'通行不可';refs.placeBlockGate.querySelector('span').textContent=blocked?'遮断を解除':'この関所を遮断';}
    openSheet(refs.placeSheet);
  }

  function placeRoutePoint(p) { return [Math.round(Number(p.center_x)),Math.round(Number(p.center_y))]; }
  function autoCalculateRoute() {
    if(state.routePoints.length<2)return;
    if(routeBusy){pendingAutoRoute=true;return;}
    if(routeWorkerReady){pendingAutoRoute=false;calculateRoute(1);}
    else pendingAutoRoute=true;
  }
  function setStartFromPlace() {
    if(!selectedPlace)return;
    const p=placeRoutePoint(selectedPlace);
    if(state.routePoints.length) state.routePoints[0]=p;
    else state.routePoints=[p];
    closeSheets();afterRoutePointEdit(true);
  }
  function setGoalFromPlace() {
    if(!selectedPlace)return;
    const p=placeRoutePoint(selectedPlace);
    if(!state.routePoints.length) {
      state.routePoints=[p];
      state.routeGoalSet=false;
    } else if(state.routeGoalSet && state.routePoints.length>=2) {
      state.routePoints[state.routePoints.length-1]=p;
    } else {
      state.routePoints.push(p);
      state.routeGoalSet=true;
    }
    closeSheets();afterRoutePointEdit(true);
  }
  function addViaFromPlace() {
    if(!selectedPlace)return;
    const p=placeRoutePoint(selectedPlace);
    if(state.routeGoalSet && state.routePoints.length>=2) state.routePoints.splice(state.routePoints.length-1,0,p);
    else state.routePoints.push(p);
    closeSheets();afterRoutePointEdit(true);
  }
  function cancelPendingRouteCalculation() {
    pendingAutoRoute=false;
    activeRouteRequestId=++requestSeq;
    routeBusy=false;
    refs.calculateRoute.disabled=false;
    refs.calculateRoute.textContent='経路を表示';
  }
  function afterRoutePointEdit(autoRoute=false) {
    clearRouteResult();saveState();syncRouteUi();requestRender();
    if(autoRoute&&state.routePoints.length>=2)autoCalculateRoute();
    else cancelPendingRouteCalculation();
  }
  function clearRouteResult() {state.routePath=[];state.altPaths=[];state.routeResult=null;state.showAlternates=false;}

  function routePointPlace(point) {
    let best=null,bestD=2.5;for(const p of places){const d=Math.hypot(Number(p.center_x)-point[0],Number(p.center_y)-point[1]);if(d<bestD){best=p;bestD=d;}}return best;
  }
  function clearReorderTargets() { for(const row of refs.routePointsList.querySelectorAll('.route-point-row')) row.classList.remove('reorder-target','reorder-active'); }
  function reorderTargetIndex(clientY) {
    const rows=[...refs.routePointsList.querySelectorAll('.route-point-row')];if(!rows.length)return 0;
    let best=0,bestD=Infinity;rows.forEach((row,i)=>{const r=row.getBoundingClientRect(),d=Math.abs(clientY-(r.top+r.bottom)/2);if(d<bestD){bestD=d;best=i;}});return best;
  }
  function bindRoutePointReorder(row,index) {
    row.addEventListener('pointerdown',e=>{
      if(e.button!==undefined&&e.button!==0)return;if(e.target.closest('button'))return;if(routeReorder)return;
      const startX=e.clientX,startY=e.clientY,pointerId=e.pointerId;let active=false,target=index;
      const timer=setTimeout(()=>{active=true;routeReorder={index,target,pointerId};row.classList.add('reorder-active');try{row.setPointerCapture?.(pointerId);}catch{}navigator.vibrate?.(18);showToast('上下に動かして順番を変更');},380);
      const move=ev=>{
        if(ev.pointerId!==pointerId)return;
        if(!active){if(Math.hypot(ev.clientX-startX,ev.clientY-startY)>10)clearTimeout(timer);return;}
        ev.preventDefault();target=reorderTargetIndex(ev.clientY);routeReorder.target=target;clearReorderTargets();row.classList.add('reorder-active');const rows=[...refs.routePointsList.querySelectorAll('.route-point-row')];rows[target]?.classList.add('reorder-target');
      };
      const finish=ev=>{
        if(ev.pointerId!==pointerId)return;clearTimeout(timer);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);
        clearReorderTargets();routeReorder=null;
        if(active&&target!==index&&state.routePoints[index]){const [point]=state.routePoints.splice(index,1);state.routePoints.splice(target,0,point);afterRoutePointEdit(true);}
      };
      window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
    });
  }
  function syncRouteUi() {
    refs.routePointsList.innerHTML='';
    if(!state.routePoints.length){refs.routePointsList.innerHTML='<div class="route-point-empty">城・関所または通行可能な地点を指定します。<br>「地図から追加」でも追加できます。</div>';}
    state.routePoints.forEach((p,i)=>{
      const row=document.createElement('div');row.className='route-point-row';row.dataset.index=String(i);
      const place=routePointPlace(p),role=i===0?'出発':(state.routeGoalSet&&i===state.routePoints.length-1&&i>0?'到着':'経由'),title=place?placeDisplayName(place):`地点 ${p[0]},${p[1]}`;
      row.innerHTML=`<span class="route-point-index">${i+1}</span><span class="route-point-info"><b>${escapeHtml(title)}</b><small>${role} ・ ${p[0]},${p[1]}</small></span><span class="route-point-drag" aria-hidden="true">≡</span><button class="route-point-remove" type="button" aria-label="削除">×</button>`;
      row.querySelector('button').addEventListener('click',()=>{const wasGoal=state.routeGoalSet&&i===state.routePoints.length-1;state.routePoints.splice(i,1);if(wasGoal||state.routePoints.length<2)state.routeGoalSet=false;afterRoutePointEdit(state.routePoints.length>=2);});bindRoutePointReorder(row,i);refs.routePointsList.appendChild(row);
    });
    refs.blockedGateCount.textContent=String(state.blockedGates.length);refs.showAlternate.hidden=!(state.routeResult&&state.routeResult.status==='ok'&&!state.showAlternates);
    syncQuickRouteBar();syncBlockedGates();renderRouteResult();
  }
  function populateGateList() { refs.gateBlockList.innerHTML='';for(const g of gates.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'ja'))){const label=document.createElement('label');label.className='gate-block-item';label.dataset.label=`${gateDisplayName(g)} ${g.province_names||''}`.toLowerCase();label.innerHTML=`<input type="checkbox" data-id="${g.id}"><span>${escapeHtml(gateDisplayName(g))}</span><small>${escapeHtml(g.province_names||'')}</small>`;label.querySelector('input').addEventListener('change',e=>{const id=Number(e.target.dataset.id);if(e.target.checked){if(!state.blockedGates.includes(id))state.blockedGates.push(id);}else state.blockedGates=state.blockedGates.filter(v=>v!==id);clearRouteResult();saveState();syncRouteUi();requestRender();if(state.routePoints.length>=2)autoCalculateRoute();});refs.gateBlockList.appendChild(label);} }
  function syncBlockedGates() { for(const cb of refs.gateBlockList.querySelectorAll('input[type="checkbox"]'))cb.checked=state.blockedGates.includes(Number(cb.dataset.id)); }
  function filterGateList() { const q=refs.gateFilter.value.trim().toLowerCase();for(const item of refs.gateBlockList.querySelectorAll('.gate-block-item'))item.style.display=!q||item.dataset.label.includes(q)?'flex':'none'; }

  function initRouteWorker() {
    if(!data.passableLandB64){refs.loadingBadge.textContent='経路データがありません';return;}
    const url=URL.createObjectURL(new Blob([PK2_ROUTE_WORKER_SOURCE],{type:'text/javascript'}));routeWorker=new Worker(url);
    routeWorker.onmessage=e=>{const m=e.data||{};if(m.type==='ready'){routeWorkerReady=true;refs.loadingBadge.hidden=true;if(pendingAutoRoute){pendingAutoRoute=false;calculateRoute(1);}return;}if(m.type==='result')handleRouteResult(m);};
    routeWorker.onerror=e=>{routeWorkerReady=false;routeBusy=false;refs.loadingBadge.textContent='経路データ初期化エラー';refs.calculateRoute.disabled=false;console.error(e);};
    const bits=decodeBase64Bytes(data.passableLandB64),stationRuns=new Uint32Array(Array.isArray(data.stationRoadRuns)?data.stationRoadRuns:[]),seaRuns=new Uint32Array(Array.isArray(data.seaRouteRuns)?data.seaRouteRuns:[]);
    routeWorker.postMessage({type:'init',buffer:bits.buffer,stationRuns:stationRuns.buffer,seaRuns:seaRuns.buffer},[bits.buffer,stationRuns.buffer,seaRuns.buffer]);
  }
  function decodeBase64Bytes(text) {const bin=atob(text),out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
  function calculateRoute(routeCount=1) {
    if(routeBusy)return;if(state.routePoints.length<2){showToast('開始地点と到着地点を指定してください',true);return;}if(!routeWorkerReady){showToast('経路データを準備中です',true);return;}
    routeBusy=true;refs.calculateRoute.disabled=true;refs.calculateRoute.textContent='探索中…';refs.routeResult.innerHTML='<p>経路を探索中…</p>';state.showAlternates=routeCount>1;
    const requestId=++requestSeq;activeRouteRequestId=requestId;
    routeWorker.postMessage({type:'route',requestId,points:state.routePoints,blockedGateIds:state.blockedGates,gates,routeCount,allowSea:true,maxExpand:3000000});
  }
  function handleRouteResult(m) {
    if(Number(m.requestId||0)!==activeRouteRequestId)return;
    routeBusy=false;refs.calculateRoute.disabled=false;refs.calculateRoute.textContent='経路を表示';
    if(pendingAutoRoute){pendingAutoRoute=false;calculateRoute(1);return;}
    if(m.status!=='ok'){state.routePath=[];state.altPaths=[];state.routeResult={status:m.status||'error'};renderRouteResult();requestRender();return;}
    const routes=Array.isArray(m.routes)?m.routes:[],first=routes[0]||{};state.routePath=Array.from(first.path||[]);state.altPaths=routes.slice(1,3).map(r=>Array.from(r.path||[]));
    const crossed=[];for(const g of gates){const xmin=Number(g.xmin),xmax=Number(g.xmax),ymin=Number(g.ymin),ymax=Number(g.ymax);if(state.routePath.some(idx=>{const x=idx%PK2_WIDTH,y=Math.floor(idx/PK2_WIDTH);return x>=xmin&&x<=xmax&&y>=ymin&&y<=ymax;}))crossed.push(Number(g.id));}
    state.routeResult={status:'ok',totalSteps:Number(first.totalSteps||0),seaCells:Number(first.seaCells||0),stationCells:Number(first.stationCells||0),crossedGates:crossed,alternatives:routes.slice(1,3).map(r=>({steps:Number(r.totalSteps||0),seaCells:Number(r.seaCells||0)}))};syncRouteUi();requestRender();
  }
  function renderRouteResult() {
    const r=state.routeResult;if(!r){refs.routeResult.innerHTML='<p>開始地点と到着地点を指定してください。</p>';return;}
    if(r.status!=='ok'){const labels={outside:'マップ範囲外です',start_blocked:'開始点が通行不可です',goal_blocked:'終点が通行不可です',no_path:'到達できる経路がありません',max_expand:'探索上限に達しました',error:'経路計算エラー'};refs.routeResult.innerHTML=`<p>${escapeHtml(labels[r.status]||r.status)}</p>`;return;}
    const crossed=(r.crossedGates||[]).map(id=>{const g=gates.find(x=>Number(x.id)===Number(id));return g?gateDisplayName(g):String(id);});const blocked=state.blockedGates.map(id=>{const g=gates.find(x=>Number(x.id)===Number(id));return g?gateDisplayName(g):String(id);});
    let alt='';if(state.showAlternates&&Array.isArray(r.alternatives)&&r.alternatives.length)alt='<div class="alt-route-line">'+r.alternatives.map((a,i)=>`候補${i+2}：${a.steps}マス${a.seaCells?`（海上 ${a.seaCells}）`:''}`).join('<br>')+'</div>';
    refs.routeResult.innerHTML=`<div class="route-main">最短 ${r.totalSteps} マス</div><dl><dt>海上航路</dt><dd>${r.seaCells?`${r.seaCells}マス`:'未使用'}</dd><dt>通過関所</dt><dd>${crossed.length?escapeHtml(crossed.join('、')):'-'}</dd><dt>遮断関所</dt><dd>${blocked.length?escapeHtml(blocked.join('、')):'-'}</dd></dl>${alt}`;
  }

  async function copyText(text) {
    try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);else{const t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();}showToast(`${text} をコピーしました`);return true;}catch{showToast('コピーできませんでした',true);return false;}
  }
  function showToast(message,error=false) {clearTimeout(toastTimer);refs.toast.textContent=message;refs.toast.classList.toggle('error',error);refs.toast.classList.add('show');toastTimer=setTimeout(()=>refs.toast.classList.remove('show'),2200);}

  function syncQuickRouteBar() {
    const show=routeAddMode||state.routePoints.length>0;
    refs.routeAddBanner.hidden=!show;
    refs.coordinatePill.hidden=show;
  }
  function setRouteAddMode(on) {routeAddMode=!!on;syncQuickRouteBar();if(routeAddMode)closeSheets();requestRender();}
  function toggleDisplay(key,button) {state[key]=!state[key];button.classList.toggle('active',state[key]);button.setAttribute('aria-pressed',String(state[key]));saveState();requestRender();}

  function bindSheetSwipe(sheet) {
    sheet.addEventListener('pointerdown',e=>{
      if(e.button!==undefined&&e.button!==0)return;
      if(e.target.closest('button,input,summary,details,.sheet-scroll'))return;
      if(!e.target.closest('.sheet-grabber,.sheet-header'))return;
      const pointerId=e.pointerId,startY=e.clientY;let dy=0,active=false;
      const move=ev=>{
        if(ev.pointerId!==pointerId)return;dy=Math.max(0,ev.clientY-startY);
        if(dy>5)active=true;if(!active)return;ev.preventDefault();sheet.classList.add('sheet-dragging');sheet.style.setProperty('--sheet-drag-y',`${dy}px`);refs.sheetBackdrop.style.opacity=String(Math.max(0,1-dy/260));
      };
      const finish=ev=>{
        if(ev.pointerId!==pointerId)return;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',finish);
        if(active&&dy>85)closeSheets();else resetSheetDrag(sheet);
      };
      window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',finish);
    });
  }

  function bindEvents() {
    refs.canvas.addEventListener('pointerdown',onPointerDown);refs.canvas.addEventListener('pointermove',onPointerMove);refs.canvas.addEventListener('pointerup',onPointerUp);refs.canvas.addEventListener('pointercancel',onPointerUp);
    refs.canvas.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.deltaY<0?1.15:.87,e.clientX,e.clientY);},{passive:false});
    refs.fitBtn.addEventListener('click',fitView);refs.helpBtn.addEventListener('click',()=>refs.helpDialog.showModal());
    refs.search.addEventListener('input',updateSearchResults);refs.search.addEventListener('keydown',e=>{if(e.key==='Enter'&&searchMatches[0]){e.preventDefault();const p=searchMatches[0];refs.searchResults.hidden=true;refs.search.blur();centerOnPlace(p);openPlaceSheet(p);}});
    refs.searchClear.addEventListener('click',()=>{refs.search.value='';updateSearchResults();refs.search.focus();});
    document.addEventListener('pointerdown',e=>{if(!e.target.closest('.search-panel'))refs.searchResults.hidden=true;},true);
    refs.toggleCity.addEventListener('click',()=>toggleDisplay('showCityNames',refs.toggleCity));refs.toggleGate.addEventListener('click',()=>toggleDisplay('showGateNames',refs.toggleGate));refs.toggleResource.addEventListener('click',()=>toggleDisplay('showResourceZones',refs.toggleResource));
    refs.sheetBackdrop.addEventListener('click',()=>closeSheets());document.querySelectorAll('[data-close-sheet]').forEach(b=>b.addEventListener('click',()=>closeSheets()));bindSheetSwipe(refs.routeSheet);bindSheetSwipe(refs.placeSheet);
    refs.addPointFromMap.addEventListener('click',()=>setRouteAddMode(true));refs.routeAddDone.addEventListener('click',()=>{if(state.routePoints.length>=2)state.routeGoalSet=true;setRouteAddMode(false);saveState();syncRouteUi();openRouteSheet();autoCalculateRoute();});refs.routeUndoQuick.addEventListener('click',()=>{if(state.routePoints.length){const removedGoal=state.routeGoalSet&&state.routePoints.length>=2;state.routePoints.pop();if(removedGoal||state.routePoints.length<2)state.routeGoalSet=false;afterRoutePointEdit(state.routePoints.length>=2);}});refs.routeClearQuick.addEventListener('click',()=>{state.routePoints=[];state.routeGoalSet=false;afterRoutePointEdit(false);});
    refs.clearRoute.addEventListener('click',()=>{state.routePoints=[];state.routeGoalSet=false;afterRoutePointEdit(false);});refs.calculateRoute.addEventListener('click',()=>calculateRoute(1));refs.showAlternate.addEventListener('click',()=>calculateRoute(3));
    refs.gateFilter.addEventListener('input',filterGateList);refs.clearBlocked.addEventListener('click',()=>{state.blockedGates=[];clearRouteResult();saveState();syncRouteUi();requestRender();if(state.routePoints.length>=2)autoCalculateRoute();});
    refs.placeStart.addEventListener('click',setStartFromPlace);refs.placeGoal.addEventListener('click',setGoalFromPlace);refs.placeVia.addEventListener('click',addViaFromPlace);refs.placeCopy.addEventListener('click',()=>{if(!selectedPlace)return;const text=`${selectedPlace.center_x},${selectedPlace.center_y}`;closeSheets();copyText(text);});refs.placeBlockGate.addEventListener('click',()=>{if(!selectedPlace||selectedPlace._kind!=='gate')return;const id=Number(selectedPlace.id);if(state.blockedGates.includes(id))state.blockedGates=state.blockedGates.filter(v=>v!==id);else state.blockedGates.push(id);clearRouteResult();saveState();openPlaceSheet(selectedPlace);syncRouteUi();requestRender();if(state.routePoints.length>=2)autoCalculateRoute();});
    refs.coordinatePill.addEventListener('click',()=>{if(lastGamePosition)copyText(`${lastGamePosition[0]},${lastGamePosition[1]}`);});
    window.addEventListener('resize',()=>{resizeCanvas();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)resizeCanvas();});
  }

  function initUi() {
    refs.toggleCity.classList.toggle('active',state.showCityNames);refs.toggleCity.setAttribute('aria-pressed',String(state.showCityNames));refs.toggleGate.classList.toggle('active',state.showGateNames);refs.toggleGate.setAttribute('aria-pressed',String(state.showGateNames));refs.toggleResource.classList.toggle('active',state.showResourceZones);refs.toggleResource.setAttribute('aria-pressed',String(state.showResourceZones));populateGateList();syncRouteUi();
  }

  mapImage.onload=()=>{mapReady=true;resizeCanvas();fitView();requestRender();};mapImage.onerror=()=>showToast('マップ画像を読み込めませんでした',true);mapImage.src='map.png';
  zoneImage.onload=()=>{zoneReady=true;requestRender();};zoneImage.src='resource_zones.png';
  bindEvents();initUi();resizeCanvas();initRouteWorker();
})();
