'use strict';

(() => {
  const refs = {};
  let canvas, ctx;
  let tiles = [];
  let selectedId = null;
  let view = { scale: 0.5, x: 60, y: 60 };
  let interaction = null;
  let spacePressed = false;
  let renderPending = false;
  let toastTimer = null;
  let dirty = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cache();
    canvas = refs.canvas;
    ctx = canvas.getContext('2d', { alpha: false });
    bind();
    resize();
    syncUI();
    requestRender();
    new ResizeObserver(() => { resize(); requestRender(); }).observe(refs.stage);
  }

  function cache() {
    ['addImagesBtn','emptyAddBtn','saveLayoutBtn','loadLayoutBtn','exportBtn','helpBtn','arrangeBtn',
      'columnsInput','overlapXInput','overlapYInput','tileCount','tileList','stage','canvas','emptyState',
      'toast','noSelection','propertyForm','selectedName','propX','propY','propOpacity','opacityValue',
      'frontBtn','backBtn','hideBtn','deleteBtn','cursorStatus','outputStatus','fitBtn','zoomOutBtn',
      'zoomInBtn','zoomStatus','imageInput','layoutInput','helpDialog','nudgeCenter'].forEach(id => refs[id] = document.getElementById(id));
    refs.nudgeButtons = Array.from(document.querySelectorAll('[data-nudge-x],[data-nudge-y]'));
  }

  function bind() {
    refs.addImagesBtn.addEventListener('click', () => refs.imageInput.click());
    refs.emptyAddBtn.addEventListener('click', () => refs.imageInput.click());
    refs.imageInput.addEventListener('change', addImages);
    refs.arrangeBtn.addEventListener('click', autoArrange);
    refs.saveLayoutBtn.addEventListener('click', saveLayout);
    refs.loadLayoutBtn.addEventListener('click', () => refs.layoutInput.click());
    refs.layoutInput.addEventListener('change', loadLayout);
    refs.exportBtn.addEventListener('click', exportMerged);
    refs.helpBtn.addEventListener('click', () => refs.helpDialog.showModal());

    refs.propX.addEventListener('change', applyPropertyPosition);
    refs.propY.addEventListener('change', applyPropertyPosition);
    refs.propOpacity.addEventListener('input', () => {
      const tile = selected(); if (!tile) return;
      tile.opacity = Number(refs.propOpacity.value) / 100;
      refs.opacityValue.textContent = refs.propOpacity.value + '%';
      dirty = true; requestRender();
    });
    refs.frontBtn.addEventListener('click', bringFront);
    refs.backBtn.addEventListener('click', sendBack);
    refs.hideBtn.addEventListener('click', toggleSelectedVisibility);
    refs.deleteBtn.addEventListener('click', deleteSelected);
    refs.nudgeButtons.forEach(btn => btn.addEventListener('click', e => {
      nudge(Number(btn.dataset.nudgeX || 0), Number(btn.dataset.nudgeY || 0), e.shiftKey ? 10 : 1);
    }));
    refs.nudgeCenter.addEventListener('click', () => showToast('矢印ボタンまたはキーボードの矢印キーで微調整します'));

    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', pointerUp);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    refs.fitBtn.addEventListener('click', fitView);
    refs.zoomInBtn.addEventListener('click', () => zoomAt(1.25, canvas.clientWidth / 2, canvas.clientHeight / 2));
    refs.zoomOutBtn.addEventListener('click', () => zoomAt(0.8, canvas.clientWidth / 2, canvas.clientHeight / 2));

    document.addEventListener('keydown', keyDown);
    document.addEventListener('keyup', e => { if (e.code === 'Space') spacePressed = false; });
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  function resize() {
    const r = refs.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px'; canvas._dpr = dpr;
  }

  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => { renderPending = false; render(); });
  }

  function render() {
    const dpr = canvas._dpr || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.globalAlpha = 1;
    ctx.fillStyle = '#090b0e'; ctx.fillRect(0,0,w,h);
    drawScreenGrid(ctx,w,h);
    ctx.save(); ctx.translate(view.x,view.y); ctx.scale(view.scale,view.scale);
    for (const tile of tiles) {
      if (tile.hidden || !tile.img) continue;
      ctx.save(); ctx.globalAlpha = tile.opacity; ctx.drawImage(tile.img,tile.x,tile.y);
      if (tile.id === selectedId) drawSelection(ctx,tile);
      ctx.restore();
    }
    ctx.restore();
    refs.zoomStatus.textContent = Math.round(view.scale * 100) + '%';
    updateOutputStatus();
  }

  function drawScreenGrid(q,w,h) {
    q.strokeStyle = '#161a20'; q.lineWidth = 1; q.beginPath();
    const step = 32;
    for(let x=0;x<w;x+=step){q.moveTo(x,0);q.lineTo(x,h)}
    for(let y=0;y<h;y+=step){q.moveTo(0,y);q.lineTo(w,y)} q.stroke();
  }

  function drawSelection(q,t) {
    q.globalAlpha = 1; q.strokeStyle = '#fff'; q.lineWidth = 2 / view.scale;
    q.setLineDash([8/view.scale,5/view.scale]); q.strokeRect(t.x,t.y,t.width,t.height); q.setLineDash([]);
    const hs = 7 / view.scale; q.fillStyle = '#fff';
    [[t.x,t.y],[t.x+t.width,t.y],[t.x,t.y+t.height],[t.x+t.width,t.y+t.height]].forEach(([x,y])=>q.fillRect(x-hs/2,y-hs/2,hs,hs));
  }

  async function addImages() {
    const files = Array.from(refs.imageInput.files || []).filter(f => f.type.startsWith('image/'));
    refs.imageInput.value = '';
    if (!files.length) return;
    files.sort((a,b) => a.name.localeCompare(b.name, 'ja', { numeric:true, sensitivity:'base' }));
    showToast(`${files.length}枚の画像を読み込んでいます`);
    try {
      for (const file of files) {
        const dataUrl = await readDataUrl(file);
        const img = await imageFrom(dataUrl);
        tiles.push({ id:makeId(), name:file.name, type:file.type, dataUrl, img, width:img.naturalWidth, height:img.naturalHeight, x:0, y:0, opacity:1, hidden:false });
      }
      dirty = true;
      autoArrange(false);
      selectTile(tiles[tiles.length - 1]?.id || null);
      syncUI(); fitView();
      showToast(`${files.length}枚の画像を追加しました`);
    } catch (err) {
      console.error(err); showToast('画像の読み込みに失敗しました', true);
    }
  }

  function readDataUrl(file) {
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)});
  }
  function imageFrom(src) { return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=src}); }
  function makeId(){return crypto.randomUUID?crypto.randomUUID():'tile-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}

  function autoArrange(notify = true) {
    if (!tiles.length) return;
    const cols = Math.max(1, Number(refs.columnsInput.value) || 1);
    const overlapX = Math.max(0,Math.min(80,Number(refs.overlapXInput.value)||0))/100;
    const overlapY = Math.max(0,Math.min(80,Number(refs.overlapYInput.value)||0))/100;
    const baseW = tiles[0].width, baseH = tiles[0].height;
    tiles.forEach((tile,i)=>{
      const col = i % cols, row = Math.floor(i / cols);
      tile.x = Math.round(col * baseW * (1-overlapX));
      tile.y = Math.round(row * baseH * (1-overlapY));
    });
    dirty = true; syncUI(); requestRender(); fitView();
    if (notify) showToast('ファイル名順に自動配置しました');
  }

  function pointerDown(e) {
    if (!tiles.length) return;
    e.preventDefault(); canvas.setPointerCapture(e.pointerId);
    const p = screenPoint(e), w = worldPoint(p.x,p.y);
    const pan = spacePressed || e.button === 1 || e.button === 2;
    if (pan) {
      interaction = { mode:'pan', id:e.pointerId, p, view:{...view} }; canvas.style.cursor='grabbing'; return;
    }
    const hit = hitTile(w.x,w.y);
    selectTile(hit ? hit.id : null);
    if (hit) interaction = { mode:'tile', id:e.pointerId, p:w, tile:hit, x:hit.x, y:hit.y, moved:false };
    else interaction = { mode:'pan', id:e.pointerId, p, view:{...view} };
  }

  function pointerMove(e) {
    const p = screenPoint(e), w = worldPoint(p.x,p.y);
    refs.cursorStatus.textContent = `座標: ${Math.round(w.x)}, ${Math.round(w.y)}`;
    if (!interaction || interaction.id !== e.pointerId) return;
    e.preventDefault();
    if (interaction.mode === 'pan') {
      view.x = interaction.view.x + p.x - interaction.p.x; view.y = interaction.view.y + p.y - interaction.p.y; canvas.style.cursor='grabbing'; requestRender();
    } else {
      const dx=w.x-interaction.p.x,dy=w.y-interaction.p.y; interaction.tile.x=Math.round(interaction.x+dx);interaction.tile.y=Math.round(interaction.y+dy);interaction.moved=interaction.moved||Math.hypot(dx,dy)>1;dirty=true;syncProperties();renderTileList();requestRender();
    }
  }

  function pointerUp(e) {
    if (!interaction || interaction.id !== e.pointerId) return;
    interaction=null; canvas.style.cursor='default';
    try{canvas.releasePointerCapture(e.pointerId)}catch(_){ }
  }
  function screenPoint(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  function worldPoint(x,y){return{x:(x-view.x)/view.scale,y:(y-view.y)/view.scale}}
  function hitTile(x,y){for(let i=tiles.length-1;i>=0;i--){const t=tiles[i];if(!t.hidden&&x>=t.x&&x<=t.x+t.width&&y>=t.y&&y<=t.y+t.height)return t}return null}

  function wheel(e){if(!tiles.length)return;e.preventDefault();const p=screenPoint(e);zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y)}
  function zoomAt(factor,x,y){const w=worldPoint(x,y);view.scale=Math.max(.02,Math.min(8,view.scale*factor));view.x=x-w.x*view.scale;view.y=y-w.y*view.scale;requestRender()}
  function fitView(){const b=visibleBounds();if(!b)return;const pad=35,cw=canvas.clientWidth,ch=canvas.clientHeight;view.scale=Math.max(.02,Math.min(8,Math.min((cw-pad*2)/b.w,(ch-pad*2)/b.h)));view.x=(cw-b.w*view.scale)/2-b.x*view.scale;view.y=(ch-b.h*view.scale)/2-b.y*view.scale;requestRender()}

  function visibleBounds(){const v=tiles.filter(t=>!t.hidden);if(!v.length)return null;const minX=Math.min(...v.map(t=>t.x)),minY=Math.min(...v.map(t=>t.y)),maxX=Math.max(...v.map(t=>t.x+t.width)),maxY=Math.max(...v.map(t=>t.y+t.height));return{x:minX,y:minY,w:maxX-minX,h:maxY-minY}}
  function updateOutputStatus(){const b=visibleBounds();refs.outputStatus.textContent=b?`出力範囲: ${Math.round(b.w)} × ${Math.round(b.h)}px`:'出力範囲: --'}

  function selectTile(id){selectedId=id;syncProperties();renderTileList();requestRender();if(id&&innerWidth<=760)document.querySelector('.property-panel').classList.add('open')}
  function selected(){return tiles.find(t=>t.id===selectedId)||null}
  function syncProperties(){const t=selected();refs.noSelection.hidden=!!t;refs.propertyForm.hidden=!t;if(!t)return;refs.selectedName.textContent=t.name;refs.propX.value=Math.round(t.x);refs.propY.value=Math.round(t.y);refs.propOpacity.value=Math.round(t.opacity*100);refs.opacityValue.textContent=Math.round(t.opacity*100)+'%';refs.hideBtn.textContent=t.hidden?'表示':'非表示'}
  function renderTileList(){refs.tileCount.textContent=tiles.length;refs.tileList.textContent='';if(!tiles.length){const e=document.createElement('div');e.className='empty-list';e.textContent='画像がありません';refs.tileList.appendChild(e);return}tiles.slice().reverse().forEach(t=>{const item=document.createElement('div');item.className='tile-item'+(t.id===selectedId?' selected':'');if(t.hidden)item.style.opacity='.5';const im=document.createElement('img');im.className='tile-thumb';im.src=t.dataUrl;const info=document.createElement('span');info.className='tile-info';const n=document.createElement('span');n.className='tile-name';n.textContent=t.name;const p=document.createElement('span');p.className='tile-pos';p.textContent=`${Math.round(t.x)}, ${Math.round(t.y)}`;info.append(n,p);const eye=document.createElement('button');eye.type='button';eye.className='tile-eye'+(t.hidden?' off':'');eye.textContent=t.hidden?'○':'●';eye.onclick=e=>{e.stopPropagation();t.hidden=!t.hidden;dirty=true;syncUI();requestRender()};item.onclick=()=>selectTile(t.id);item.append(im,info,eye);refs.tileList.appendChild(item)})}
  function syncUI(){refs.emptyState.hidden=tiles.length>0;renderTileList();syncProperties();updateOutputStatus();requestRender()}
  function applyPropertyPosition(){const t=selected();if(!t)return;t.x=Number(refs.propX.value)||0;t.y=Number(refs.propY.value)||0;dirty=true;syncUI()}
  function nudge(dx,dy,step){const t=selected();if(!t)return;t.x+=dx*step;t.y+=dy*step;dirty=true;syncUI()}
  function bringFront(){const t=selected();if(!t)return;tiles=tiles.filter(x=>x.id!==t.id);tiles.push(t);dirty=true;syncUI()}
  function sendBack(){const t=selected();if(!t)return;tiles=tiles.filter(x=>x.id!==t.id);tiles.unshift(t);dirty=true;syncUI()}
  function toggleSelectedVisibility(){const t=selected();if(!t)return;t.hidden=!t.hidden;dirty=true;syncUI()}
  function deleteSelected(){const t=selected();if(!t)return;if(!confirm(`「${t.name}」を削除しますか？`))return;tiles=tiles.filter(x=>x.id!==t.id);selectedId=null;dirty=true;syncUI();showToast('画像を削除しました')}

  function keyDown(e){const tag=e.target?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag))return;if(e.code==='Space'){spacePressed=true;e.preventDefault();return}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&selectedId){e.preventDefault();const s=e.shiftKey?10:1;nudge(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0,s)}else if((e.key==='Delete'||e.key==='Backspace')&&selectedId){e.preventDefault();deleteSelected()}else if(e.key==='Escape'){selectTile(null);document.querySelector('.property-panel').classList.remove('open')}}

  function saveLayout(){if(!tiles.length){showToast('画像を追加してください',true);return}const data={app:'shinsen-map-layout',version:1,savedAt:new Date().toISOString(),settings:{columns:Number(refs.columnsInput.value),overlapX:Number(refs.overlapXInput.value),overlapY:Number(refs.overlapYInput.value)},tiles:tiles.map(({img,...t})=>t)};download(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),'真戦マップ配置.nsslayout');dirty=false;showToast('配置ファイルを保存しました')}
  function loadLayout(){const file=refs.layoutInput.files?.[0];refs.layoutInput.value='';if(!file)return;if(dirty&&!confirm('現在の配置を閉じて読み込みますか？'))return;const r=new FileReader();r.onload=async()=>{try{const d=JSON.parse(r.result);if(!d||!Array.isArray(d.tiles))throw new Error('invalid');const loaded=[];for(const raw of d.tiles){const img=await imageFrom(raw.dataUrl);loaded.push({...raw,id:raw.id||makeId(),img,width:img.naturalWidth,height:img.naturalHeight,x:Number(raw.x)||0,y:Number(raw.y)||0,opacity:Number(raw.opacity)||1,hidden:!!raw.hidden})}tiles=loaded;selectedId=null;if(d.settings){refs.columnsInput.value=d.settings.columns||4;refs.overlapXInput.value=d.settings.overlapX??20;refs.overlapYInput.value=d.settings.overlapY??20}dirty=false;syncUI();fitView();showToast('配置ファイルを読み込みました')}catch(err){console.error(err);showToast('配置ファイルの形式が正しくありません',true)}};r.readAsText(file,'utf-8')}

  async function exportMerged(){const b=visibleBounds();if(!b){showToast('表示中の画像がありません',true);return}const maxSide=15000,maxPixels=100000000;const scale=Math.min(1,maxSide/b.w,maxSide/b.h,Math.sqrt(maxPixels/(b.w*b.h)));const w=Math.max(1,Math.round(b.w*scale)),h=Math.max(1,Math.round(b.h*scale));try{const out=document.createElement('canvas');out.width=w;out.height=h;const q=out.getContext('2d');q.fillStyle='#111';q.fillRect(0,0,w,h);q.scale(scale,scale);for(const t of tiles){if(t.hidden)continue;q.save();q.globalAlpha=t.opacity;q.drawImage(t.img,t.x-b.x,t.y-b.y);q.restore()}const blob=await new Promise((res,rej)=>out.toBlob(v=>v?res(v):rej(new Error('export')),'image/png'));download(blob,'真戦_結合マップ.png');showToast(scale<1?`大きさを縮小して出力しました（${w} × ${h}px）`:'結合PNGを出力しました')}catch(err){console.error(err);showToast('画像が大きすぎるため出力できませんでした',true)}}
  function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000)}
  function showToast(msg,err=false){clearTimeout(toastTimer);refs.toast.textContent=msg;refs.toast.classList.toggle('error',err);refs.toast.classList.add('show');toastTimer=setTimeout(()=>refs.toast.classList.remove('show'),2800)}
})();
