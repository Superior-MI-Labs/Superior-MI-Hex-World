import {World,Clock,effect,effectActive,physicalPosition} from "./core.mjs";
import {vertices,uniformShape,sampleSurface,hasVolume} from "./geometry.mjs";
import {editVertex,cellFaces} from "./terrain.mjs";
import {project,pickFace,billboard} from "./camera.mjs";
import {createRenderer} from "./gpu.mjs";
import {createAtlasSprite} from "./assets.mjs";
const $=id=>document.getElementById(id),canvas=$("scene"),ctx=canvas.getContext("2d");
const gpu=createRenderer($("terrain"));
const base=await fetch("./examples/world.json").then(r=>{if(!r.ok)throw Error("World unavailable");return r.json()});
let world,grid,clock=new Clock(base.simulation),yaw=0,flame=null,last,drag=null,selected=[0,0,0],dirty=true,faces=[],handles=[],scale=24;
const ground=Array.from({length:5},(_,i)=>i-2).flatMap(q=>Array.from({length:5},(_,i)=>i-2).filter(r=>Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2).map(r=>[q,r,0]));
const domain=ground.flatMap(([q,r])=>[-2,-1,0,1,2].map(z=>[q,r,z]));
let actor=null,actorAddress=[0,0,0],spriteRequest=0;
async function loadActor(){const request=++spriteRequest;try{const next=await createAtlasSprite({manifest:$("manifest").value,asset:$("asset").value,state:$("actorState").value});await next.update(0);if(request!==spriteRequest)return;actor=next;$("assetStatus").textContent="Atlas sprite loaded";}catch(e){if(request===spriteRequest){actor=null;$("assetStatus").textContent=e.message;}}}
$("loadActor").onclick=loadActor;$("placeActor").onclick=()=>actorAddress=[...selected];
const options=Array.from({length:7},(_,i)=>i===6?"Center":String(i+1));
options.forEach((name,i)=>$("vertex").add(new Option(name,i)));
const get=()=>world.get(...selected).shape;
function reset(n){grid={...base.grid,geometry_subdivisions:n};world=new World({...base,grid});for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)world.defineChunk(q,r,z);for(const [q,r] of ground)for(const z of [-1,0])world.set(q,r,z,{material:"soil",shape:uniformShape(n)});selected=[0,0,0];actorAddress=[0,0,0];flame=null;dirty=true;sync();}
function sync(){$("level").value=selected[2];const n=grid.geometry_subdivisions,i=Number($("vertex").value),s=get();$("height").max=n;$("height").value=s[$("surface").value][i];$("heightValue").value=(Number($("height").value)*grid.vertical_ft/n)+" ft";}
function move(value){const i=Number($("vertex").value),n=grid.geometry_subdivisions;try{editVertex(world,selected,i,$("surface").value,Math.max(0,Math.min(n,Math.round(value))),{connected:$("connected").checked});dirty=true;$("message").textContent="";}catch(e){$("message").textContent=e.message;}sync();}
function set(s){world.set(...selected,{material:hasVolume(s)?"soil":"air",shape:s});dirty=true;sync();}
reset(base.grid.geometry_subdivisions);
$("level").onchange=()=>{selected=[selected[0],selected[1],Number($("level").value)];sync();};
loadActor();
$("reset").onclick=()=>reset(grid.geometry_subdivisions);
$("resolution").onchange=()=>{const old=grid.geometry_subdivisions,n=Number($("resolution").value),save=world.snapshot();save.world.grid.geometry_subdivisions=n;for(const c of save.chunks)for(const v of [c.defaultCell,...c.cells.map(e=>e.value)])for(const k of ["lower","upper"])v.shape[k]=v.shape[k].map(h=>Math.round(h*n/old));world=World.restore(save);grid=world.config.grid;dirty=true;sync();};
$("surface").onchange=sync;$("vertex").onchange=sync;$("height").oninput=()=>move(Number($("height").value));
const presets={Full:[1,1,1,1,1,1,1],Half:[.5,.5,.5,.5,.5,.5,.5],Slope:[1,1,.5,0,0,.5,.5],Corner:[1,0,1,1,1,1,1],Peak:[0,0,0,0,0,0,1],Basin:[1,1,1,1,1,1,0],Empty:[0,0,0,0,0,0,0]};
for(const [name,h] of Object.entries(presets)){const b=document.createElement("button");b.textContent=name;b.title="Replace selected cell only";b.onclick=()=>set({lower:Array(7).fill(0),upper:h.map(v=>Math.round(v*grid.geometry_subdivisions))});$("presets").append(b);}
const ceiling=document.createElement("button");ceiling.textContent="Raised slab";ceiling.onclick=()=>set(uniformShape(grid.geometry_subdivisions,grid.geometry_subdivisions/2));$("presets").append(ceiling);
$("save").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(world.snapshot(),null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download="hex-world.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$("load").onchange=async()=>{try{const file=$("load").files[0];if(!file)return;if(file.size>5e6)throw Error("Lab import limit 5 MB");const next=World.restore(JSON.parse(await file.text())),g=next.config.grid;if(g.horizontal_ft!==base.grid.horizontal_ft||g.vertical_ft!==base.grid.vertical_ft||![2,4].includes(g.geometry_subdivisions)||!domain.every(a=>next.get(...a)))throw Error("This lab previews a 19-column, five-level domain with 2/4 subdivisions");world=next;grid=g;selected=[0,0,0];$("resolution").value=g.geometry_subdivisions;dirty=true;flame=null;sync();$("message").textContent="World imported";}catch(e){$("message").textContent=e.message;}finally{$("load").value="";}};
$("mode").onchange=()=>clock.configure($("mode").value);$("step").onclick=()=>clock.advance(6);$("fire").onclick=()=>flame={address:[...selected],instance:effect({behavior:"persistent"},clock.simulation)};$("timed").onclick=()=>flame={address:[...selected],instance:effect({behavior:"timed",duration:5},clock.simulation)};$("rotate").onclick=()=>yaw=(yaw+1)%6;$("zoom").oninput=()=>scale=Number($("zoom").value);
const verticalScale=Math.sqrt(2/3);
function view(p){return project(p,{yaw,scale,width:canvas.width,height:canvas.height});}
function projectLocal(a,p){const o=physicalPosition(...a,grid);return view([o.x+p[0],o.y+p[1],o.z+p[2]]);}
function path(p){ctx.beginPath();p.forEach(({x,y},i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function polygon(p,fill,stroke){path(p);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function pos(e){const b=canvas.getBoundingClientRect();return [(e.clientX-b.left)*canvas.width/b.width,(e.clientY-b.top)*canvas.height/b.height];}

canvas.onpointerdown=e=>{if(e.button!==0)return;const [x,y]=pos(e);let i=-1,d=15;for(let j=0;j<handles.length;j++){const dist=Math.hypot(x-handles[j].x,y-handles[j].y);if(dist<d){i=j;d=dist;}}if(i>=0){$("vertex").value=i;sync();drag={id:e.pointerId,y,h:Number($("height").value)};canvas.setPointerCapture(e.pointerId);return;}
  const hit=pickFace(faces,x,y,view);if(hit){selected=[...hit.address];sync();return;}
  // Empty cells can be selected at their base footprint when not occluded.
  for(const a of domain){if(a[2]!==selected[2]||hasVolume(world.get(...a).shape))continue;path(vertices(uniformShape(0),grid).upper.slice(0,6).map(p=>projectLocal(a,p)));if(ctx.isPointInPath(x,y)){selected=[...a];sync();return;}}
};
canvas.onpointermove=e=>{if(drag?.id===e.pointerId)move(drag.h+(drag.y-pos(e)[1])/(scale*verticalScale*grid.vertical_ft/grid.geometry_subdivisions));};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>drag=null;
function frame(ms){const dt=last===undefined?0:Math.min(.1,(ms-last)/1000);last=ms;clock.animate(dt);clock.advance(dt,"realtime");ctx.clearRect(0,0,900,450);
  if(dirty){faces=domain.flatMap(a=>cellFaces(world,a,grid));dirty=false;}
  let sprite=null;
  if(actor&&$("showActor").checked){
    actor.update(clock.visual*1000).catch(e=>{$("assetStatus").textContent=e.message;actor=null;});
    const a=actorAddress,s=world.get(...a)?.shape;
    if(s&&hasVolume(s)){const o=physicalPosition(...a,grid),z=sampleSurface(s,grid,0,0);sprite={image:actor.image,revision:actor.revision,points:billboard([o.x,o.y,o.z+z],yaw,actor.width,actor.height,actor.pivot)};}
  }
  gpu.render(faces,view,{selected,pattern:$("pattern").checked,sprite});
  if($("wire").checked){
    for(const a of domain){if(a[2]!==selected[2]||hasVolume(world.get(...a).shape))continue;polygon(vertices(uniformShape(0),grid).upper.slice(0,6).map(p=>projectLocal(a,p)),null,"#344b56");}
    const v=vertices(get(),grid)[$("surface").value].map(p=>projectLocal(selected,p));
    for(let i=0;i<6;i++)polygon([v[6],v[i],v[(i+1)%6]],null,"#d2e3c3");
  }
  if(flame&&effectActive(flame.instance,clock.simulation)){const a=flame.address,s=world.get(...a).shape,p=projectLocal(a,[0,0,sampleSurface(s,grid,0,0)]);for(let i=0;i<5;i++){ctx.fillStyle=i%2?"#ffcf69":"#ec783c";ctx.beginPath();ctx.ellipse(p.x+i*8-16,p.y-15,7,17+7*Math.sin(clock.visual*9+i),0,0,Math.PI*2);ctx.fill();}}
  const s=get(),active=$("surface").value;handles=vertices(s,grid)[active].map(p=>projectLocal(selected,p));
  handles.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,i===Number($("vertex").value)?7:4,0,Math.PI*2);ctx.fillStyle=i===Number($("vertex").value)?"#f2bd60":"#d5e3ed";ctx.fill();ctx.strokeStyle="#243a4a";ctx.stroke();ctx.fillStyle="#fff";ctx.font="12px system-ui";ctx.fillText(options[i],p.x+7,p.y-7);});
  $("status").textContent=JSON.stringify({grid,selected,cell:world.get(...selected),mesh_triangles:faces.length,renderer:"WebGL2",atlas_sprite:!!actor,simulation_seconds:clock.simulation.toFixed(2),visual_seconds:clock.visual.toFixed(2),effect:flame?.instance.behavior??"none",active:!!flame&&effectActive(flame.instance,clock.simulation)},null,2);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
