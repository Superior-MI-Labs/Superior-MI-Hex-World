import {World,Clock,effect,effectActive,physicalPosition} from "./core.mjs";
import {vertices,uniformShape,sampleSurface,hasVolume} from "./geometry.mjs";
import {editVertex,vertexLimits,TerrainFaceCache} from "./terrain.mjs";
import {decorateTerrain} from "./surface-render.mjs";
import {faceKey,faceHandles,handleKey,handleLabel,nearestHandle} from "./editor.mjs";
import {project,pickFace,billboard,visibleTriangle} from "./camera.mjs";
import {createRenderer} from "./gpu.mjs";
import {createAtlasSprite,createAtlasMask} from "./assets.mjs";
import {loadStyle,vegetationSamples} from "./art-style.mjs";
import {EXPLORATION_PROFILE,explorationConfig,viewportBounds,loadViewport} from "./region.mjs";
import {placeObject,anchorHeight,visualKey,spriteBinding} from "./entities.mjs";
import {validatePrefab,planPrefab,placePrefab} from "./prefabs.mjs";
import {validateMaterials,surface,ignite,advanceSurface,withSurface,stableUnit} from "./materials.mjs";
const $=id=>document.getElementById(id),canvas=$("scene"),ctx=canvas.getContext("2d");
const gpu=createRenderer($("terrain"));
const base=await fetch("./examples/world.json").then(r=>{if(!r.ok)throw Error("World unavailable");return r.json()});
const catalog=validateMaterials(await fetch("./examples/materials.json").then(r=>{if(!r.ok)throw Error("Materials unavailable");return r.json();}));
let world,grid,clock=new Clock(base.simulation),yaw=0,flame=null,last,drag=null,selected=[0,0,0],dirty=true,faces=[],handles=[],scale=24,panX=0,panY=50,meshCache;
const island=Array.from({length:5},(_,i)=>i-2).flatMap(q=>Array.from({length:5},(_,i)=>i-2).filter(r=>Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2).map(r=>[q,r,0]));
const islandDomain=island.flatMap(([q,r])=>[-2,-1,0,1,2].map(z=>[q,r,z]));
let ground=island,domain=islandDomain,exploration=false,regionKey="",cameraKey="",activeChunks=0;
function camera(){return {yaw,scale,width:canvas.width,height:canvas.height,panX,panY};}
function refreshRegion(force=false){
  if(!exploration)return;
  const current=JSON.stringify(camera());if(!force&&current===cameraKey)return;cameraKey=current;
  const bounds=viewportBounds(camera(),grid,undefined,Math.ceil(scale*5)),key=JSON.stringify(bounds);
  if(!force&&key===regionKey)return;
  const loaded=loadViewport(world,bounds);regionKey=key;domain=loaded.addresses;ground=domain.filter(a=>a[2]===0);activeChunks=loaded.chunks.length;dirty=true;
  if(!force)syncConstruction();
}
const prefabCatalog=(await fetch("./examples/prefabs.json").then(r=>{if(!r.ok)throw Error("Prefabs unavailable");return r.json();})).map(validatePrefab);
const prefabSelect=$("prefab");for(const p of prefabCatalog)prefabSelect.add(new Option(p.name,p.id));
const demoVisual={manifest:"./examples/atlas-character/manifest.json",asset:"smi.example.robot.states",state:"idle",height_ft:4};
let actor=null,spriteRequest=0,art=null,activeBinding=demoVisual;
const spriteCache=new Map();
function requestSprite(binding){
  const key=visualKey(binding);
  if(!spriteCache.has(key)){
    const entry={sprite:null,error:null};
    entry.promise=createAtlasSprite(binding).then(async s=>{await s.update(0);entry.sprite=s;return s;}).catch(e=>{entry.error=e.message;return null;});
    spriteCache.set(key,entry);
  }
  return spriteCache.get(key);
}
function prefabPlan(){
  const p=prefabCatalog.find(p=>p.id===prefabSelect.value),anchor=[selected[0],selected[1],selected[2]+Number($("prefabOffset").value)];
  return {p,anchor,turns:Number($("prefabRotation").value),plan:planPrefab(world,p,anchor,Number($("prefabRotation").value))};
}
let preview=null;
function syncConstruction(){
  try{const {plan}=prefabPlan(),inDomain=new Set(domain.map(a=>a.join(","))),outside=plan.edits.some(e=>!inDomain.has(e.address.join(",")));
    preview=plan;$("prefabStatus").textContent=outside?"Outside active editor region":plan.conflicts.length?"Blocked: "+plan.conflicts[0].reason:plan.edits.length+" cells ready";
    $("placePrefab").disabled=outside||plan.conflicts.length>0;
  }catch(e){preview=null;$("prefabStatus").textContent=e.message;$("placePrefab").disabled=true;}
  const menu=$("objects"),old=menu.value,items=world.entities().filter(e=>e.address.every((v,i)=>v===selected[i]));
  menu.replaceChildren(...items.map(e=>new Option(e.visual.asset+" · "+e.id,e.id)));if(items.some(e=>e.id===old))menu.value=old;
  $("removeObject").disabled=!items.length;
}
for(const key of ["prefab","prefabRotation","prefabOffset"])$(key).onchange=syncConstruction;
$("placePrefab").onclick=()=>{try{const {p,anchor,turns}=prefabPlan();if($("placePrefab").disabled)return;placePrefab(world,p,anchor,turns);dirty=true;sync();$("message").textContent=p.name+" placed";}catch(e){$("message").textContent=e.message;}};
$("removeObject").onclick=()=>{world.removeEntity($("objects").value);syncConstruction();};

// Temporary transparent vertical artwork, not an Atlas release.
const tufts=new Map(catalog.vegetation.variants.map(v=>{
  const c=document.createElement("canvas");c.width=c.height=64;const g=c.getContext("2d");
  for(let i=0;i<13;i++){const t=stableUnit(v.id,[i],"blade"),x=12+40*t,top=8+35*stableUnit(v.id,[i],"height");g.fillStyle="rgb("+v.color.map(n=>Math.round(n*255*(.7+t*.4))).join(",")+")";g.beginPath();g.moveTo(30+i%4,62);g.quadraticCurveTo(x,35,x,top);g.quadraticCurveTo(x+6,38,34+i%4,62);g.fill();}
  return [v.id,c];
}));
async function loadActor(){
  const request=++spriteRequest;$("assetStatus").textContent="Loading sprite";
  try{const binding=spriteBinding({manifest:$("manifest").value,asset:$("asset").value,state:$("actorState").value,height_ft:Number($("objectHeight").value)}),entry=requestSprite(binding),next=await entry.promise;
    if(request!==spriteRequest)return;if(!next)throw Error(entry.error);actor=next;activeBinding=binding;$("assetStatus").textContent="Atlas sprite loaded";
  }catch(e){if(request===spriteRequest){actor=null;$("assetStatus").textContent=e.message;}}
}
$("loadActor").onclick=loadActor;
$("placeActor").onclick=()=>{try{if(!actor)throw Error("Load a sprite first");placeObject(world,{id:crypto.randomUUID(),address:[...selected],anchor:"surface",visual:activeBinding});syncConstruction();$("message").textContent="Object placed";}catch(e){$("message").textContent=e.message;}};
const faceSelect=$("surface"),vertexSelect=$("vertex");
const activeFace=()=>faceSelect.value;
const refs=()=>faceHandles(activeFace());
const activeRef=()=>refs().find(h=>handleKey(h)===vertexSelect.value)??refs()[0];
function refreshVertexOptions(){
  const old=vertexSelect.value,items=refs(),keys=items.map(handleKey);
  if([...vertexSelect.options].map(o=>o.value).join("|")!==keys.join("|")){
    vertexSelect.replaceChildren(...items.map(h=>new Option(handleLabel(h),handleKey(h))));
    if(keys.includes(old))vertexSelect.value=old;
  }
}
function selectFace(key){faceSelect.value=key;sync();}

const get=()=>world.get(...selected).shape;
function reset(){
  const n=base.grid.geometry_subdivisions;grid={...base.grid};world=new World(exploration?explorationConfig(base):base);meshCache=new TerrainFaceCache(world);
  selected=[0,0,0];faceSelect.value="upper";flame=null;regionKey="";cameraKey="";
  if(exploration){yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;refreshRegion(true);}
  else{ground=island;domain=islandDomain;activeChunks=0;for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)world.defineChunk(q,r,z);for(const [q,r] of ground)for(const z of [-1,0])world.set(q,r,z,withSurface({material:"soil",shape:uniformShape(n)}, {growth:z===0?.65:0}));}
  placeObject(world,{id:"demo-actor",address:[0,0,0],anchor:"surface",visual:demoVisual});$("worldMode").value=exploration?"exploration":"island";dirty=true;sync();
}
$("worldMode").onchange=()=>{const next=$("worldMode").value==="exploration";if(next===exploration)return;if(!confirm("Start a new world? Export your current world first if you want to keep it.")){$("worldMode").value=exploration?"exploration":"island";return;}exploration=next;reset();};
function sync(){
  $("level").value=selected[2];refreshVertexOptions();
  const n=grid.geometry_subdivisions,{layer,index}=activeRef(),s=get(),height=s[layer][index];
  // Keep the legal range visible. The core still enforces it for pointer drags.
  const slider=$("height");let limits={min:0,max:n},blocked=false;
  try{limits=vertexLimits(world,selected,index,layer,{connected:$("connected").checked});}catch{blocked=true;}
  // A pre-existing discontinuity can lie outside the common connected range.
  // Display the real height until the next edit reconciles the shared corner.
  slider.min=Math.min(height,limits.min);slider.max=Math.max(height,limits.max);slider.value=height;slider.disabled=blocked;
  $("heightValue").value=(height*grid.vertical_ft/n)+" ft";
  $("heightLimits").textContent=blocked?"Unknown neighbor: load before editing":(limits.min*grid.vertical_ft/n)+"–"+(limits.max*grid.vertical_ft/n)+" ft allowed";
  const c=world.get(...selected),srf=surface(c.components?.surface);$("material").value=Object.hasOwn(catalog.materials,c.material)?c.material:"soil";
  for(const k of ["growth","health","moisture","leaves","snow","scorch"]){$(k).value=srf[k];$(k+"Value").value=Math.round(srf[k]*100)+"%";}
  syncConstruction();
}
function move(value,ref=activeRef()){
  const n=grid.geometry_subdivisions;try{editVertex(world,selected,ref.index,ref.layer,Math.max(0,Math.min(n,Math.round(value))),{connected:$("connected").checked});dirty=true;$("message").textContent="";}catch(e){$("message").textContent=e.message;}sync();
}
function set(s){const old=world.get(...selected);world.set(...selected,hasVolume(s)?{...old,material:old.material==="air"?$("material").value:old.material,shape:s}:{material:"air",shape:s});dirty=true;sync();}
function modifySurface(fn){const cell=world.get(...selected);if(!hasVolume(cell.shape)){$("message").textContent="Select a solid surface first";sync();return;}world.set(...selected,withSurface(cell,fn(surface(cell.components?.surface),cell)));dirty=true;sync();}
for(const k of ["growth","health","moisture","leaves","snow","scorch"])$(k).oninput=()=>modifySurface(s=>({...s,[k]:Number($(k).value)}));
$("material").onchange=()=>{const cell=world.get(...selected);if(!hasVolume(cell.shape)){sync();return;}const material=$("material").value,s=surface(cell.components?.surface);world.set(...selected,withSurface({...cell,material},catalog.materials[material].vegetation?s:{...s,growth:0,burn:0}));dirty=true;sync();};
$("reactive").onclick=()=>modifySurface((s,c)=>ignite(catalog,c));
$("extinguish").onclick=()=>{modifySurface(s=>({...s,burn:0}));flame=null;};
function simulate(seconds){if(seconds<=0)return;const edits=[];for(const address of world.burningAddresses()){const c=world.get(...address),s=c.components?.surface;if(s?.burn>0)edits.push({address,value:withSurface(c,advanceSurface(s,seconds,catalog.vegetation.burn_seconds))});}if(edits.length){world.apply(edits);dirty=true;sync();}}

reset();
$("level").onchange=()=>{selected=[selected[0],selected[1],Number($("level").value)];sync();};
loadActor();
async function loadArt(){
  try{const response=await fetch("./examples/meadow-style.json");if(!response.ok)throw Error("Style unavailable");const next=await loadStyle(await response.json());gpu.setTerrainDetail("top",next.top.image);gpu.setTerrainDetail("side",next.side.image);art=next;$("artStatus").textContent="Atlas meadow fixture loaded";}
  catch(e){$("artStatus").textContent="Procedural fallback: "+e.message;}
}
loadArt();
if(catalog.transitions.mask)createAtlasMask(catalog.transitions.mask).then(image=>{gpu.setTransitionMask(image);$("maskStatus").textContent="Atlas transition mask loaded";}).catch(e=>{$("maskStatus").textContent="Procedural mask fallback: "+e.message;});
$("transitions").onchange=()=>dirty=true;
function demoSurface(kind){
  const edits=[];
  for(const address of ground){
    const c=world.get(...address);if(!hasVolume(c.shape))continue;
    const [q,r]=address,patch=q>=1||q===0&&r>0;
    const s={growth:.8,health:1,moisture:0,snow:0,leaves:0,scorch:0,burn:0};
    let material="soil";
    if(patch){if(kind==="snow")s.snow=1;else if(kind==="leaves"){s.leaves=1;s.health=.35;}else if(kind==="scorch"){s.scorch=1;s.growth=0;}else if(kind==="sand"){material="sand";s.growth=0;}else if(kind==="wet")s.moisture=1;}
    edits.push({address,value:withSurface({...c,material},s)});
  }
  world.apply(edits);dirty=true;sync();
}
$("transitionDemo").onchange=()=>{const k=$("transitionDemo").value;if(k)demoSurface(k);$("transitionDemo").value="";};
$("reset").onclick=()=>{if(exploration&&!confirm("Reset exploration world and discard edits?"))return;reset();};
$("surface").onchange=sync;$("vertex").onchange=sync;$("connected").onchange=sync;$("height").oninput=()=>move(Number($("height").value));
const presets={Full:[1,1,1,1,1,1,1],Half:[.5,.5,.5,.5,.5,.5,.5],Slope:[1,1,.5,0,0,.5,.5],Corner:[1,0,1,1,1,1,1],Peak:[0,0,0,0,0,0,1],Basin:[1,1,1,1,1,1,0],Empty:[0,0,0,0,0,0,0]};
for(const [name,h] of Object.entries(presets)){const b=document.createElement("button");b.textContent=name;b.title="Replace selected cell only";b.onclick=()=>set({lower:Array(7).fill(0),upper:h.map(v=>Math.round(v*grid.geometry_subdivisions))});$("presets").append(b);}
const ceiling=document.createElement("button");ceiling.textContent="Raised slab";ceiling.onclick=()=>set(uniformShape(grid.geometry_subdivisions,grid.geometry_subdivisions/2));$("presets").append(ceiling);
$("save").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(world.snapshot(),null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="hex-world.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$("load").onchange=async()=>{try{
  const file=$("load").files[0];if(!file)return;if(file.size>25e6)throw Error("Lab import limit 25 MB");
  const next=World.restore(JSON.parse(await file.text())),g=next.config.grid,cfg=next.config,generated=cfg.generation?.profile===EXPLORATION_PROFILE;
  if(g.horizontal_ft!==base.grid.horizontal_ft||g.vertical_ft!==base.grid.vertical_ft||g.geometry_subdivisions!==2||g.chunk_size.some((n,i)=>n!==base.grid.chunk_size[i])||(!generated&&(cfg.generation||!islandDomain.every(a=>next.get(...a)))))throw Error("Unsupported laboratory world profile");
  if(generated){if(typeof cfg.generation.seed!=="string"||!cfg.generation.seed)throw Error("Invalid generation seed");loadViewport(next,viewportBounds({yaw:0,scale:24,width:canvas.width,height:canvas.height,panX:0,panY:50},g,undefined,120));}
  world=next;meshCache=new TerrainFaceCache(world);grid=g;exploration=generated;selected=[0,0,0];faceSelect.value="upper";dirty=true;flame=null;regionKey="";cameraKey="";
  yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;$("worldMode").value=generated?"exploration":"island";
  if(generated)refreshRegion(true);else{ground=island;domain=islandDomain;activeChunks=0;}
  sync();$("message").textContent="World imported";
}catch(e){$("message").textContent=e.message;}finally{$("load").value="";}};
$("mode").onchange=()=>clock.configure($("mode").value);$("step").onclick=()=>{const before=clock.simulation;clock.advance(6);simulate(clock.simulation-before);};$("fire").onclick=()=>flame={address:[...selected],instance:effect({behavior:"persistent"},clock.simulation)};$("timed").onclick=()=>flame={address:[...selected],instance:effect({behavior:"timed",duration:5},clock.simulation)};$("rotate").onclick=()=>yaw=(yaw+1)%6;$("zoom").oninput=()=>scale=Number($("zoom").value);
const verticalScale=Math.sqrt(2/3);
function view(p){return project(p,{yaw,scale,width:canvas.width,height:canvas.height,panX,panY});}
function projectLocal(a,p){const o=physicalPosition(...a,grid);return view([o.x+p[0],o.y+p[1],o.z+p[2]]);}
function path(p){ctx.beginPath();p.forEach(({x,y},i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function polygon(p,fill,stroke){path(p);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function pos(e){const b=canvas.getBoundingClientRect();return [(e.clientX-b.left)*canvas.width/b.width,(e.clientY-b.top)*canvas.height/b.height];}

canvas.onpointerdown=e=>{const [x,y]=pos(e);if(e.button===1||e.button===2){e.preventDefault();drag={id:e.pointerId,pan:true,x,y,panX,panY};canvas.setPointerCapture(e.pointerId);return;}if(e.button!==0)return;const handle=nearestHandle(handles,x,y,vertexSelect.value);
  if(handle){vertexSelect.value=handleKey(handle);sync();drag={id:e.pointerId,y,h:get()[handle.layer][handle.index],ref:{layer:handle.layer,index:handle.index}};canvas.setPointerCapture(e.pointerId);return;}
  const hit=pickFace(faces,x,y,view);if(hit){selected=[...hit.address];selectFace(faceKey(hit));return;}
  // Empty cells can be selected at their base footprint when not occluded.
  for(const a of domain){if(a[2]!==selected[2]||hasVolume(world.get(...a).shape))continue;path(vertices(uniformShape(0),grid).upper.slice(0,6).map(p=>projectLocal(a,p)));if(ctx.isPointInPath(x,y)){selected=[...a];selectFace("upper");return;}}
};
canvas.onpointermove=e=>{if(drag?.id!==e.pointerId)return;if(drag.pan){const [x,y]=pos(e);panX=drag.panX+x-drag.x;panY=drag.panY+y-drag.y;return;}move(drag.h+(drag.y-pos(e)[1])/(scale*verticalScale*grid.vertical_ft/grid.geometry_subdivisions),drag.ref);};
canvas.oncontextmenu=e=>e.preventDefault();
canvas.addEventListener("wheel",e=>{e.preventDefault();const [x,y]=pos(e),next=Math.max(12,Math.min(48,scale*Math.exp(-e.deltaY*.001))),ratio=next/scale;panX=x-canvas.width/2-(x-canvas.width/2-panX)*ratio;panY=y-canvas.height/2-(y-canvas.height/2-panY)*ratio;scale=next;$("zoom").value=String(next);},{passive:false});
$("resetView").onclick=()=>{yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>drag=null;
function frame(ms){const dt=last===undefined?0:Math.min(.1,(ms-last)/1000);last=ms;clock.animate(dt);const before=clock.simulation;clock.advance(dt,"realtime");simulate(clock.simulation-before);refreshRegion();ctx.clearRect(0,0,900,450);
  if(dirty){faces=decorateTerrain(world,domain,catalog,{enabled:$("transitions").checked,cache:meshCache});dirty=false;}
  const sprites=[],seed=world.config.id,styled=art&&$("artStyle").checked;
  const visible=faces.filter(f=>visibleTriangle(f,view,canvas.width,canvas.height,scale*5));
  if($("vegetation").checked)for(const f of visible){
    if(f.kind!=="top"||f.vegetation<=0)continue;
    if(styled){
      for(const sample of vegetationSamples(f,seed,art.profile,scale)){
        const r=art.vegetation.get(sample.variant);if(!r)continue;
        sprites.push({image:r.image,revision:r.revision,points:billboard(sample.point,yaw,sample.height*r.pixelWidth/r.pixelHeight,sample.height,r.pivot)});
      }
    }else if(stableUnit(seed,f.address,"tuft"+f.triangle)<=f.vegetation){
      const p=[0,1,2].map(i=>f.points.reduce((sum,v)=>sum+v[i]/3,0)),h=.55+f.vegetation*1.1;
      sprites.push({image:tufts.get(f.variant),revision:0,points:billboard(p,yaw,h*.9,h)});
    }
  }
  let objectInstances=0,unresolvedObjects=0;
  if($("showActor").checked)for(const e of world.entities()){
    const h=anchorHeight(e,world.get(...e.address),grid);if(h===undefined){unresolvedObjects++;continue;}
    const o=physicalPosition(...e.address,grid),p=[o.x+e.offset_ft[0],o.y+e.offset_ft[1],o.z+h],screen=view(p);
    const margin=scale*e.visual.height_ft*4;if(screen.x<-margin||screen.x>canvas.width+margin||screen.y<-margin||screen.y>canvas.height+margin)continue;
    const entry=requestSprite(e.visual),s=entry.sprite;
    if(!s){unresolvedObjects++;continue;}
    s.update(clock.visual*1000).catch(err=>{entry.error=err.message;entry.sprite=null;});
    sprites.push({image:s.image,revision:s.revision,points:billboard(p,yaw,s.width,s.height,s.pivot)});objectInstances++;
  }
  gpu.render(visible,view,{selected,pattern:$("pattern").checked,sprites,transitions:catalog.transitions,debug:$("transitionDebug").checked,style:styled?art.profile:null});
  if($("wire").checked){
    for(const a of domain){if(a[2]!==selected[2])continue;const p=projectLocal(a,[0,0,0]);if(p.x<-scale*5||p.x>canvas.width+scale*5||p.y<-scale*5||p.y>canvas.height+scale*5||hasVolume(world.get(...a).shape))continue;polygon(vertices(uniformShape(0),grid).upper.slice(0,6).map(p=>projectLocal(a,p)),null,"#344b56");}

  }
  function drawFire(a){const s=world.get(...a).shape,p=projectLocal(a,[0,0,sampleSurface(s,grid,0,0)]);for(let i=0;i<5;i++){ctx.fillStyle=i%2?"#ffcf69":"#ec783c";ctx.beginPath();ctx.ellipse(p.x+i*8-16,p.y-15,7,17+7*Math.sin(clock.visual*9+i),0,0,Math.PI*2);ctx.fill();}}
  if(flame&&effectActive(flame.instance,clock.simulation))drawFire(flame.address);
  for(const a of world.burningAddresses())drawFire(a);
  if($("previewPrefab").checked&&preview){
    for(const e of preview.edits){const v=vertices(e.value.shape,grid),blocked=preview.conflicts.some(c=>c.address.every((x,i)=>x===e.address[i])),color=blocked?"#f08072":"#88d9ed";
      polygon(v.upper.slice(0,6).map(p=>projectLocal(e.address,p)),null,color);
      polygon(v.lower.slice(0,6).map(p=>projectLocal(e.address,p)),null,color);
    }
  }
  const v=vertices(get(),grid),key=activeFace();
  handles=refs().map(h=>({...h,...projectLocal(selected,v[h.layer][h.index])}));
  // Outline the logical control face even when a neighboring cell clips it.
  // This is an editor overlay, not extra world geometry.
  if(key.startsWith("side:"))polygon(handles,null,"#f2bd60");
  else{
    polygon(handles.slice(0,6),null,"#f2bd60");
    if($("wire").checked)for(let i=0;i<6;i++)polygon([handles[6],handles[i],handles[(i+1)%6]],null,"#d2e3c3");
  }
  for(const p of [...handles].sort((a,b)=>Number(handleKey(a)===vertexSelect.value)-Number(handleKey(b)===vertexSelect.value))){
    const active=handleKey(p)===vertexSelect.value;
    ctx.beginPath();ctx.arc(p.x,p.y,active?7:4.5,0,Math.PI*2);ctx.fillStyle=active?"#f2bd60":p.layer==="upper"?"#e0efcf":"#8fc9ed";ctx.fill();ctx.strokeStyle="#243a4a";ctx.stroke();
    ctx.fillStyle="#fff";ctx.font="12px system-ui";ctx.fillText((p.layer==="upper"?"U":"L")+(p.index===6?"C":p.index+1),p.x+7,p.y+(p.layer==="upper"?-8:13));
  }
  $("status").textContent=JSON.stringify({grid,selected,face:activeFace(),vertex:activeRef(),handles:handles.map(({layer,index,x,y})=>({layer,index,x,y})),cell:world.get(...selected),world_mode:exploration?"exploration":"island",resident_chunks:world.chunkCount,active_chunks:activeChunks,active_cells:domain.length,mesh_cache_entries:meshCache.size,mesh_triangles:faces.length,visible_triangles:visible.length,vegetation_instances:sprites.length-objectInstances,object_instances:objectInstances,world_objects:world.entityCount,unresolved_objects:unresolvedObjects,art_style:styled?art.profile.id:null,transitions:$("transitions").checked,transition_triangles:faces.filter(f=>f.attributes&&f.kind==="top").length,camera:{yaw,scale,panX,panY},renderer:"WebGL2",atlas_sprite:!!actor,simulation_seconds:clock.simulation.toFixed(2),visual_seconds:clock.visual.toFixed(2),effect:flame?.instance.behavior??"none",active:!!flame&&effectActive(flame.instance,clock.simulation)},null,2);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
