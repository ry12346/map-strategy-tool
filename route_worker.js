const W=2000,H=3250,N=W*H;
let bitset=null;
let gScore=new Uint32Array(N),seen=new Uint16Array(N),parentDir=new Uint8Array(N),generation=1;
const dirs=[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
function basePassable(i){return !!bitset&&((bitset[i>>3]>>(i&7))&1)!==0}
function makeBlocked(gates,ids){const wanted=new Set(ids||[]),out=new Set();if(!wanted.size)return out;for(const g of gates){if(!wanted.has(Number(g.id)))continue;for(let y=Number(g.ymin);y<=Number(g.ymax);y++)for(let x=Number(g.xmin);x<=Number(g.xmax);x++)out.add(y*W+x)}return out}
function heuristic(x,y,gx,gy){return Math.max(Math.abs(x-gx),Math.abs(y-gy))}
class Heap{constructor(){this.i=[];this.f=[];this.g=[]}get length(){return this.i.length}push(idx,fv,gv){let p=this.i.length;this.i.push(idx);this.f.push(fv);this.g.push(gv);while(p){let q=(p-1)>>1;if(this.f[q]<=fv)break;this.i[p]=this.i[q];this.f[p]=this.f[q];this.g[p]=this.g[q];p=q}this.i[p]=idx;this.f[p]=fv;this.g[p]=gv}pop(){const n=this.i.length;if(!n)return null;const oi=this.i[0],of=this.f[0],og=this.g[0],li=this.i.pop(),lf=this.f.pop(),lg=this.g.pop();if(n>1){let p=0;while(true){let a=p*2+1;if(a>=n-1)break;let b=a+1,c=(b<n-1&&this.f[b]<this.f[a])?b:a;if(this.f[c]>=lf)break;this.i[p]=this.i[c];this.f[p]=this.f[c];this.g[p]=this.g[c];p=c}this.i[p]=li;this.f[p]=lf;this.g[p]=lg}return[oi,of,og]}}
function bump(){generation++;if(generation>=65535){seen.fill(0);generation=1}}
function route(start,goal,blocked,penalty,maxExpand=3000000,penaltyCost=4){
  bump();const[sx,sy]=start,[gx,gy]=goal;
  if(sx<0||sx>=W||sy<0||sy>=H||gx<0||gx>=W||gy<0||gy>=H)return{status:'outside'};
  const sidx=sy*W+sx,gidx=gy*W+gx,can=i=>basePassable(i)&&!blocked.has(i);
  if(!can(sidx))return{status:'start_blocked'};if(!can(gidx))return{status:'goal_blocked'};
  const heap=new Heap();seen[sidx]=generation;gScore[sidx]=0;parentDir[sidx]=0;heap.push(sidx,heuristic(sx,sy,gx,gy),0);let expanded=0;
  while(heap.length){const item=heap.pop(),idx=item[0],pg=item[2];if(seen[idx]!==generation||gScore[idx]!==pg)continue;
    if(idx===gidx){const rev=[idx];let cur=idx;while(cur!==sidx){const code=parentDir[cur]-1;if(code<0)return{status:'parent_error'};const[dx,dy]=dirs[code],x=cur%W,y=Math.floor(cur/W);cur=(y-dy)*W+(x-dx);rev.push(cur)}rev.reverse();return{status:'ok',path:rev,steps:rev.length-1,cost:pg,expanded}}
    if(++expanded>maxExpand)return{status:'max_expand',expanded};
    const x=idx%W,y=Math.floor(idx/W);
    for(let di=0;di<8;di++){const dx=dirs[di][0],dy=dirs[di][1],nx=x+dx,ny=y+dy;if(nx<0||nx>=W||ny<0||ny>=H)continue;const ni=ny*W+nx;if(!can(ni))continue;const extra=penalty&&penalty.has(ni)?penaltyCost:0,ng=pg+1+extra;if(seen[ni]!==generation||ng<gScore[ni]){seen[ni]=generation;gScore[ni]=ng;parentDir[ni]=di+1;heap.push(ni,ng+heuristic(nx,ny,gx,gy),ng)}}
  }
  return{status:'no_path',expanded}
}
function routeAll(points,blocked,penalty,maxExpand){let total=0,expanded=0,full=[],segments=[];for(let k=0;k<points.length-1;k++){const r=route(points[k],points[k+1],blocked,penalty,maxExpand);expanded+=r.expanded||0;segments.push({start:points[k],goal:points[k+1],status:r.status,steps:r.steps??null,expanded:r.expanded||0});if(r.status!=='ok')return{status:r.status,totalSteps:null,segments,expanded};total+=r.steps;full=full.concat(k?r.path.slice(1):r.path)}return{status:'ok',totalSteps:total,segments,expanded,path:full}}
function addPenalty(path,set){if(!path||path.length<3)return;for(let i=1;i<path.length-1;i++)set.add(path[i])}
self.onmessage=e=>{const m=e.data;if(m.type==='init'){bitset=new Uint8Array(m.buffer);self.postMessage({type:'ready'});return}if(m.type!=='route')return;try{if(!bitset)throw new Error('route data not initialized');const blocked=makeBlocked(m.gates||[],m.blockedGateIds||[]),pts=m.points||[],routeCount=Math.max(1,Math.min(3,Number(m.routeCount)||1));const penalty=new Set(),routes=[];for(let i=0;i<routeCount;i++){const r=routeAll(pts,blocked,penalty,m.maxExpand||3000000);if(r.status!=='ok'){if(i===0){self.postMessage({type:'result',status:r.status});return}break}const packed=new Uint32Array(r.path);routes.push({totalSteps:r.totalSteps,expanded:r.expanded,path:packed});addPenalty(r.path,penalty)}const transfers=routes.map(r=>r.path.buffer);self.postMessage({type:'result',status:'ok',routes},transfers)}catch(err){self.postMessage({type:'result',status:'error',message:String(err&&err.message||err)})}}

