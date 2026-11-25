import {World,Clock,effect,effectActive,physicalPosition} from "./core.mjs";
import {vertices,uniformShape,sampleSurface,hasVolume} from "./geometry.mjs";
import {editVertex,cellFaces,vertexLimits} from "./terrain.mjs";
import {faceKey,faceHandles,handleKey,handleLabel,nearestHandle} from "./editor.mjs";
import {project,pickFace,billboard} from "./camera.mjs";
import {createRenderer} from "./gpu.mjs";
import {createAtlasSprite} from "./assets.mjs";
import {validateMaterials,surface,appearance,ignite,advanceSurface,withSurface,stableUnit} from "./materials.mjs";
const $=id=>document.getElementById(id),canvas=$("scene"),ctx=canvas.getContext("2d");
const gpu=createRenderer($("terrain"));
const base=await fetch("./examples/world.json").then(r=>{if(!r.ok)throw Error("World unavailable");return r.json()});
const catalog=validateMaterials(await fetch("./examples/materials.json").then(r=>{if(!r.ok)throw Error("Materials unavailable");return r.json();}));
let world,grid,clock=new Clock(base.simulation),yaw=0,flame=null,last,drag=null,selected=[0,0,0],dirty=true,faces=[],handles=[],scale=24;
const ground=Array.from({length:5},(_,i)=>i-2).flatMap(q=>Array.from({length:5},(_,i)=>i-2).filter(r=>Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2).map(r=>[q,r,0]));
const domain=ground.flatMap(([q,r])=>[-2,-1,0,1,2].map(z=>[q,r,z]));
let actor=null,actorAddress=[0,0,0],spriteRequest=0;
// Temporary transparent vertical artwork, not an Atlas release.
const tufts=new Map(catalog.vegetation.variants.map(v=>{
  const c=document.createElement("canvas");c.width=c.height=64;const g=c.getContext("2d");
  for(let i=0;i<13;i++){const t=stableUnit(v.id,[i],"blade"),x=12+40*t,top=8+35*stableUnit(v.id,[i],"height");g.fillStyle="rgb("+v.color.map(n=>Math.round(n*255*(.7+t*.4))).join(",")+")";g.beginPath();g.moveTo(30+i%4,62);g.quadraticCurveTo(x,35,x,top);g.quadraticCurveTo(x+6,38,34+i%4,62);g.fill();}
  return [v.id,c];
}));
async function loadActor(){const request=++spriteRequest;try{const next=await createAtlasSprite({manifest:$("manifest").value,asset:$("asset").value,state:$("actorState").value});await next.update(0);if(request!==spriteRequest)return;actor=next;$("assetStatus").textContent="Atlas sprite loaded";}catch(e){if(request===spriteRequest){actor=null;$("assetStatus").textContent=e.message;}}}
$("loadActor").onclick=loadActor;$("placeActor").onclick=()=>actorAddress=[...selected];
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
function reset(){const n=base.grid.geometry_subdivisions;grid={...base.grid};world=new World({...base,grid});for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)world.defineChunk(q,r,z);for(const [q,r] of ground)for(const z of [-1,0])world.set(q,r,z,withSurface({material:"soil",shape:uniformShape(n)}, {growth:z===0?.65:0}));selected=[0,0,0];faceSelect.value="upper";actorAddress=[0,0,0];flame=null;dirty=true;sync();}
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
function simulate(seconds){if(seconds<=0)return;const edits=[];for(const address of domain){const c=world.get(...address),s=c.components?.surface;if(s?.burn>0)edits.push({address,value:withSurface(c,advanceSurface(s,seconds,catalog.vegetation.burn_seconds))});}if(edits.length){world.apply(edits);dirty=true;sync();}}

reset();
$("level").onchange=()=>{selected=[selected[0],selected[1],Number($("level").value)];sync();};
loadActor();
$("reset").onclick=reset;
$("surface").onchange=sync;$("vertex").onchange=sync;$("connected").onchange=sync;$("height").oninput=()=>move(Number($("height").value));
const presets={Full:[1,1,1,1,1,1,1],Half:[.5,.5,.5,.5,.5,.5,.5],Slope:[1,1,.5,0,0,.5,.5],Corner:[1,0,1,1,1,1,1],Peak:[0,0,0,0,0,0,1],Basin:[1,1,1,1,1,1,0],Empty:[0,0,0,0,0,0,0]};
for(const [name,h] of Object.entries(presets)){const b=document.createElement("button");b.textContent=name;b.title="Replace selected cell only";b.onclick=()=>set({lower:Array(7).fill(0),upper:h.map(v=>Math.round(v*grid.geometry_subdivisions))});$("presets").append(b);}
const ceiling=document.createElement("button");ceiling.textContent="Raised slab";ceiling.onclick=()=>set(uniformShape(grid.geometry_subdivisions,grid.geometry_subdivisions/2));$("presets").append(ceiling);
$("save").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(world.snapshot(),null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="hex-world.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$("load").onchange=async()=>{try{const file=$("load").files[0];if(!file)return;if(file.size>5e6)throw Error("Lab import limit 5 MB");const next=World.restore(JSON.parse(await file.text())),g=next.config.grid;if(g.horizontal_ft!==base.grid.horizontal_ft||g.vertical_ft!==base.grid.vertical_ft||g.geometry_subdivisions!==2||!domain.every(a=>next.get(...a)))throw Error("This lab previews a 19-column, five-level domain with two subdivisions");world=next;grid=g;selected=[0,0,0];faceSelect.value="upper";dirty=true;flame=null;sync();$("message").textContent="World imported";}catch(e){$("message").textContent=e.message;}finally{$("load").value="";}};
$("mode").onchange=()=>clock.configure($("mode").value);$("step").onclick=()=>{const before=clock.simulation;clock.advance(6);simulate(clock.simulation-before);};$("fire").onclick=()=>flame={address:[...selected],instance:effect({behavior:"persistent"},clock.simulation)};$("timed").onclick=()=>flame={address:[...selected],instance:effect({behavior:"timed",duration:5},clock.simulation)};$("rotate").onclick=()=>yaw=(yaw+1)%6;$("zoom").oninput=()=>scale=Number($("zoom").value);
const verticalScale=Math.sqrt(2/3);
function view(p){return project(p,{yaw,scale,width:canvas.width,height:canvas.height});}
function projectLocal(a,p){const o=physicalPosition(...a,grid);return view([o.x+p[0],o.y+p[1],o.z+p[2]]);}
function path(p){ctx.beginPath();p.forEach(({x,y},i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function polygon(p,fill,stroke){path(p);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function pos(e){const b=canvas.getBoundingClientRect();return [(e.clientX-b.left)*canvas.width/b.width,(e.clientY-b.top)*canvas.height/b.height];}

canvas.onpointerdown=e=>{if(e.button!==0)return;const [x,y]=pos(e),handle=nearestHandle(handles,x,y,vertexSelect.value);
  if(handle){vertexSelect.value=handleKey(handle);sync();drag={id:e.pointerId,y,h:get()[handle.layer][handle.index],ref:{layer:handle.layer,index:handle.index}};canvas.setPointerCapture(e.pointerId);return;}
  const hit=pickFace(faces,x,y,view);if(hit){selected=[...hit.address];selectFace(faceKey(hit));return;}
  // Empty cells can be selected at their base footprint when not occluded.
  for(const a of domain){if(a[2]!==selected[2]||hasVolume(world.get(...a).shape))continue;path(vertices(uniformShape(0),grid).upper.slice(0,6).map(p=>projectLocal(a,p)));if(ctx.isPointInPath(x,y)){selected=[...a];selectFace("upper");return;}}
};
canvas.onpointermove=e=>{if(drag?.id===e.pointerId)move(drag.h+(drag.y-pos(e)[1])/(scale*verticalScale*grid.vertical_ft/grid.geometry_subdivisions),drag.ref);};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>drag=null;
function frame(ms){const dt=last===undefined?0:Math.min(.1,(ms-last)/1000);last=ms;clock.animate(dt);const before=clock.simulation;clock.advance(dt,"realtime");simulate(clock.simulation-before);ctx.clearRect(0,0,900,450);
  if(dirty){faces=domain.flatMap(a=>{const c=world.get(...a);return cellFaces(world,a,grid).map(f=>({...f,...appearance(catalog,base.id,a,c,f.kind)}));});dirty=false;}
  let sprite=null;
  if(actor&&$("showActor").checked){
    actor.update(clock.visual*1000).catch(e=>{$("assetStatus").textContent=e.message;actor=null;});
    const a=actorAddress,s=world.get(...a)?.shape;
    if(s&&hasVolume(s)){const o=physicalPosition(...a,grid),z=sampleSurface(s,grid,0,0);sprite={image:actor.image,revision:actor.revision,points:billboard([o.x,o.y,o.z+z],yaw,actor.width,actor.height,actor.pivot)};}
  }
  const sprites=[];
  if($("vegetation").checked)for(const f of faces){
    if(f.kind!=="top"||f.vegetation<=0||stableUnit(base.id,f.address,"tuft"+f.triangle)>f.vegetation)continue;
    const p=[0,1,2].map(i=>f.points.reduce((s,v)=>s+v[i]/3,0)),h=.55+f.vegetation*1.1;
    sprites.push({image:tufts.get(f.variant),revision:0,points:billboard(p,yaw,h*.9,h)});
  }
  if(sprite)sprites.push(sprite);
  gpu.render(faces,view,{selected,pattern:$("pattern").checked,sprites});
  if($("wire").checked){
    for(const a of domain){if(a[2]!==selected[2]||hasVolume(world.get(...a).shape))continue;polygon(vertices(uniformShape(0),grid).upper.slice(0,6).map(p=>projectLocal(a,p)),null,"#344b56");}

  }
  function drawFire(a){const s=world.get(...a).shape,p=projectLocal(a,[0,0,sampleSurface(s,grid,0,0)]);for(let i=0;i<5;i++){ctx.fillStyle=i%2?"#ffcf69":"#ec783c";ctx.beginPath();ctx.ellipse(p.x+i*8-16,p.y-15,7,17+7*Math.sin(clock.visual*9+i),0,0,Math.PI*2);ctx.fill();}}
  if(flame&&effectActive(flame.instance,clock.simulation))drawFire(flame.address);
  for(const a of domain)if(world.get(...a).components?.surface?.burn>0)drawFire(a);
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
  $("status").textContent=JSON.stringify({grid,selected,face:activeFace(),vertex:activeRef(),handles:handles.map(({layer,index,x,y})=>({layer,index,x,y})),cell:world.get(...selected),mesh_triangles:faces.length,renderer:"WebGL2",atlas_sprite:!!actor,simulation_seconds:clock.simulation.toFixed(2),visual_seconds:clock.visual.toFixed(2),effect:flame?.instance.behavior??"none",active:!!flame&&effectActive(flame.instance,clock.simulation)},null,2);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
