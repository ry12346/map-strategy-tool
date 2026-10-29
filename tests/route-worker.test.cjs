'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app.js'),'utf8');
const worker=source.match(/const PK2_ROUTE_WORKER_SOURCE = String\.raw`([\s\S]*?)`;/)[1];
const W=2000,N=2000*3250,BYTES=Math.ceil(N/8);
const index=([x,y])=>y*W+x;
const bits=points=>{const b=new Uint8Array(BYTES);for(const p of points){const i=index(p);b[i>>3]|=1<<(i&7);}return b;};
const rect=(xmin,ymin,xmax,ymax)=>{const a=[];for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++)a.push([x,y]);return a;};
let output;
const context=vm.createContext({self:{postMessage:m=>{output=m;}},Uint8Array,Uint16Array,Uint32Array,Set,Math,Number,Array,Error});
vm.runInContext(worker,context);
function run({land,capture=land,points,facilities=[],sea=[],blocked=[],gates=[],routeCount=1}){
  output=null;
  context.self.onmessage({data:{type:'init',buffer:bits(land).buffer,occupationBuffer:capture===null?new ArrayBuffer(0):bits(capture).buffer,seaRuns:new Uint32Array(sea.flatMap(p=>[index(p),1])).buffer}});
  assert.equal(output.type,'ready');
  context.self.onmessage({data:{type:'route',requestId:42,points,facilities,gates,blockedGateIds:blocked,routeCount,maxExpand:10000}});
  assert.equal(output.requestId,42);
  return output;
}

test('movement may cross a nonoccupiable strip while occupation independently detours',()=>{
  const land=rect(100,94,106,110);
  const capture=land.filter(([x,y])=>x!==103||y===94);
  const result=run({land,capture,points:[[100,102],[106,102]]});
  assert.equal(result.status,'ok');
  assert.equal(result.routes[0].totalSteps,6);
  assert.equal(result.occupation.status,'ok');
  assert.equal(result.occupation.totalCaptures,16);
  const allowed=new Set(capture.map(index));
  for(const i of result.occupation.paths[0])assert.ok(allowed.has(i));
});

test('occupation keeps diagonal adjacency instead of silently switching to four directions',()=>{
  const result=run({land:[[100,100],[101,101]],points:[[100,100],[101,101]]});
  assert.equal(result.routes[0].totalSteps,1);
  assert.equal(result.occupation.totalCaptures,1);
});

test('sea travel stays enabled but cannot connect an occupation chain',()=>{
  const endpoints=[[100,100],[104,100]];
  const result=run({land:endpoints,capture:endpoints,sea:[[101,100],[102,100],[103,100]],points:endpoints});
  assert.equal(result.status,'ok');
  assert.equal(result.routes[0].totalSteps,4);
  assert.equal(result.routes[0].seaCells,3);
  assert.equal(result.occupation.status,'no_path');
  assert.equal(result.occupation.totalCaptures,undefined);
});

test('the whole origin facility is owned and its tiles do not count as new captures',()=>{
  const land=rect(100,100,110,120);
  const facility={xmin:104,ymin:104,xmax:106,ymax:106};
  const capture=land.filter(([x,y])=>x<104||x>106||y<104||y>106);
  const result=run({land,capture,facilities:[facility],points:[[105,105],[105,118]]});
  assert.equal(result.routes[0].totalSteps,13);
  assert.equal(result.occupation.totalCaptures,12);
  const first=result.occupation.paths[0][0];
  assert.equal(Math.floor(first/W),106);
});

test('a destination facility ends at its adjacent land and excludes the siege',()=>{
  const land=rect(100,100,110,110);
  const facility={xmin:105,ymin:105,xmax:107,ymax:107};
  const capture=land.filter(([x,y])=>x<105||x>107||y<105||y>107);
  const result=run({land,capture,facilities:[facility],points:[[106,100],[106,106]]});
  assert.equal(result.occupation.status,'ok');
  assert.equal(result.occupation.totalCaptures,4);
  const p=Array.from(result.occupation.paths[0]);
  assert.equal(Math.floor(p.at(-1)/W),104);
});

test('a nonoccupiable destination never gets an invented numeric count',()=>{
  const result=run({land:rect(100,100,104,104),capture:[[100,100]],points:[[100,100],[104,104]]});
  assert.equal(result.status,'ok');
  assert.equal(result.occupation.status,'goal_not_occupiable');
  assert.equal(result.occupation.totalCaptures,undefined);
});

test('missing occupation data is reported without reusing movement data',()=>{
  const result=run({land:rect(100,100,104,104),capture:null,points:[[100,100],[104,104]]});
  assert.equal(result.routes[0].totalSteps,4);
  assert.equal(result.occupation.status,'missing_data');
});

test('blocked gates remain blocked for both calculations',()=>{
  const corridor=rect(100,100,110,100);
  const result=run({land:corridor,points:[[100,100],[110,100]],gates:[{id:9,xmin:105,xmax:105,ymin:100,ymax:100}],blocked:[9]});
  assert.equal(result.status,'no_path');
});

test('same point needs zero new captures',()=>{
  const result=run({land:[[100,100]],points:[[100,100],[100,100]]});
  assert.equal(result.occupation.totalCaptures,0);
});

test('returning to the initial tile does not count that owned tile',()=>{
  const result=run({land:rect(100,100,102,100),points:[[100,100],[102,100],[100,100]]});
  assert.equal(result.occupation.totalCaptures,2);
});

function breadthFirst(allowed,start,goal){
  const queue=[[start,0]],seen=new Set([index(start)]);
  for(let p=0;p<queue.length;p++){
    const [[x,y],d]=queue[p];
    if(x===goal[0]&&y===goal[1])return d;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const next=[x+dx,y+dy],i=index(next);
      if(!allowed.has(i)||seen.has(i))continue;
      seen.add(i);queue.push([next,d+1]);
    }
  }
  return null;
}
test('occupation A* agrees with an independent BFS on varied small terrains',()=>{
  let seed=17;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const land=rect(100,100,110,110),start=[100,100],goal=[110,110];
  for(let trial=0;trial<30;trial++){
    const capture=land.filter(p=>index(p)===index(start)||index(p)===index(goal)||random()>.3);
    const expected=breadthFirst(new Set(capture.map(index)),start,goal);
    const result=run({land,capture,points:[start,goal]});
    if(expected===null)assert.equal(result.occupation.status,'no_path');
    else assert.equal(result.occupation.totalCaptures,expected);
  }
});

test('real PK2 example keeps movement at 13 but requires 16 captures from the owned base',()=>{
  const dataContext={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'pk2_embedded_data.js'),'utf8'),dataContext);
  const data=dataContext.window.PK2_EMBEDDED;
  const land=new Uint8Array(Buffer.from(data.passableLandB64,'base64'));
  const capture=land.slice();
  for(let i=0;i<data.occupationExcludedRuns.length;i+=2){
    const start=data.occupationExcludedRuns[i],length=data.occupationExcludedRuns[i+1];
    for(let j=start;j<start+length;j++)capture[j>>3]&=~(1<<(j&7));
  }
  const base=data.gates.find(g=>g.id===168);
  assert.equal(base.name,'五老ヶ滝本陣');
  context.self.onmessage({data:{type:'init',buffer:land.buffer,occupationBuffer:capture.buffer,stationRuns:new Uint32Array(data.stationRoadRuns).buffer,seaRuns:new Uint32Array(data.seaRouteRuns).buffer}});
  context.self.onmessage({data:{type:'route',requestId:991,points:[[1088,1623],[1087,1636]],facilities:[...data.cities,...data.gates],gates:data.gates,maxExpand:3000000}});
  assert.equal(output.requestId,991);
  assert.equal(output.routes[0].totalSteps,13);
  assert.equal(output.occupation.status,'ok');
  assert.equal(output.occupation.totalCaptures,16);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'pk2-base-168-fixture.json'),'utf8'));
  const lookup=new Map(fixture.cells.map(c=>[c[1]*W+c[0],c[2]]));
  assert.ok(Array.from(output.routes[0].path).some(i=>lookup.get(i)===65));
  for(const i of Array.from(output.occupation.paths[0]).slice(1)){
    assert.ok((capture[i>>3]>>(i&7))&1);
    assert.notEqual(lookup.get(i),65);
  }
  const allowed=new Set(fixture.cells.filter(c=>c[3]).map(c=>c[1]*W+c[0]));
  const starts=[];
  for(let y=base.ymin;y<=base.ymax;y++)for(let x=base.xmin;x<=base.xmax;x++)starts.push([x,y]);
  const queue=starts.map(p=>[p,0]),seen=new Set(starts.map(index));
  let distance=null;
  for(let k=0;k<queue.length;k++){
    const [[x,y],d]=queue[k];
    if(x===1087&&y===1636){distance=d;break;}
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const p=[x+dx,y+dy],i=index(p);
      if(allowed.has(i)&&!seen.has(i)){seen.add(i);queue.push([p,d+1]);}
    }
  }
  assert.equal(distance,16);
});
