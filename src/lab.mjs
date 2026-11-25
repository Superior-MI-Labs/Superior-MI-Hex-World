import {World,Clock,effect,effectActive} from "./core.mjs";
import {mesh,vertices,uniformShape,sampleSurface} from "./geometry.mjs";
const $=id=>document.getElementById(id),canvas=$("scene"),ctx=canvas.getContext("2d");
const base=await fetch("./examples/world.json").then(r=>{if(!r.ok)throw Error("World unavailable");return r.json()});
let world,grid,clock=new Clock(base.simulation),yaw=0,flame=null,last,drag=null;
const options=Array.from({length:7},(_,i)=>i===6?"Center":String(i+1));
options.forEach((name,i)=>$("vertex").add(new Option(name,i)));
const get=()=>world.get(0,0,0).shape;
function set(s){world.set(0,0,0,{material:s.upper.every((h,i)=>h===s.lower[i])?"air":"soil",shape:s});sync();}
function reset(n,s){grid={...base.grid,geometry_subdivisions:n};world=new World({...base,grid});world.defineChunk(0,0,0);set(s??uniformShape(n));}
function sync(){const n=grid.geometry_subdivisions,i=Number($("vertex").value),s=get();$("height").max=n;$("height").value=s[$("surface").value][i];$("heightValue").value=(Number($("height").value)*grid.vertical_ft/n)+" ft";}
function move(value){const s=get(),i=Number($("vertex").value),layer=$("surface").value,n=grid.geometry_subdivisions;let h=Math.max(0,Math.min(n,Math.round(value)));h=layer==="upper"?Math.max(h,s.lower[i]):Math.min(h,s.upper[i]);s[layer][i]=h;set(s);}
reset(base.grid.geometry_subdivisions);
$("resolution").onchange=()=>{const old=grid.geometry_subdivisions,n=Number($("resolution").value),s=get();for(const k of ["lower","upper"])s[k]=s[k].map(h=>Math.round(h*n/old));reset(n,s);};
$("surface").onchange=sync;$("vertex").onchange=sync;$("height").oninput=()=>move(Number($("height").value));
const presets={Full:[1,1,1,1,1,1,1],Half:[.5,.5,.5,.5,.5,.5,.5],Slope:[1,1,.5,0,0,.5,.5],Corner:[1,0,1,1,1,1,1],Peak:[0,0,0,0,0,0,1],Basin:[1,1,1,1,1,1,0],Empty:[0,0,0,0,0,0,0]};
for(const [name,h] of Object.entries(presets)){const b=document.createElement("button");b.textContent=name;b.onclick=()=>set({lower:Array(7).fill(0),upper:h.map(v=>Math.round(v*grid.geometry_subdivisions))});$("presets").append(b);}
const ceiling=document.createElement("button");ceiling.textContent="Raised slab";ceiling.onclick=()=>set(uniformShape(grid.geometry_subdivisions,grid.geometry_subdivisions/2));$("presets").append(ceiling);
$("mode").onchange=()=>clock.configure($("mode").value);$("step").onclick=()=>clock.advance(6);$("fire").onclick=()=>flame=effect({behavior:"persistent"},clock.simulation);$("timed").onclick=()=>flame=effect({behavior:"timed",duration:5},clock.simulation);$("rotate").onclick=()=>yaw=(yaw+1)%6;
const scale=46,verticalScale=Math.sqrt(2/3);
function view([x,y,z]){const a=yaw*Math.PI/3,c=Math.cos(a),s=Math.sin(a),v=x*s+y*c;return {x:450+scale*(x*c-y*s),y:365+scale*(v/Math.sqrt(3)-z*verticalScale),depth:v*verticalScale+z/Math.sqrt(3)};}
function polygon(p,fill,stroke){ctx.beginPath();p.forEach(({x,y},i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function line(a,b,color){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.stroke();}
function pos(e){const b=canvas.getBoundingClientRect();return [(e.clientX-b.left)*canvas.width/b.width,(e.clientY-b.top)*canvas.height/b.height];}
canvas.onpointerdown=e=>{if(e.button!==0)return;const [x,y]=pos(e),p=vertices(get(),grid)[$("surface").value].map(view);let i=-1,d=20;for(let j=0;j<7;j++){const dist=Math.hypot(x-p[j].x,y-p[j].y);if(dist<d){i=j;d=dist;}}if(i<0)return;$("vertex").value=i;sync();drag={id:e.pointerId,y,h:Number($("height").value)};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(drag?.id!==e.pointerId)return;move(drag.h+(drag.y-pos(e)[1])/(scale*verticalScale*grid.vertical_ft/grid.geometry_subdivisions));};
canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>drag=null;
function frame(ms){const dt=last===undefined?0:Math.min(.1,(ms-last)/1000);last=ms;clock.animate(dt);clock.advance(dt,"realtime");ctx.clearRect(0,0,900,450);const s=get(),v=vertices(s,grid);
  ctx.setLineDash([5,5]);for(let i=0;i<=grid.geometry_subdivisions;i++){polygon(v.lower.slice(0,6).map(([x,y])=>view([x,y,i*grid.vertical_ft/grid.geometry_subdivisions])),null,"#49616f");}ctx.setLineDash([]);
  const faces=mesh(s,grid).map(f=>({...f,p:f.points.map(view)}));faces.sort((a,b)=>a.p.reduce((sum,p)=>sum+p.depth,0)-b.p.reduce((sum,p)=>sum+p.depth,0));
  for(const f of faces){const [a,b,c]=f.p,area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(area<=1e-8)continue;polygon(f.p,f.kind==="top"?"#88a769":f.kind==="bottom"?"#624c3d":"#927254",$("wire").checked?"#35473c":null);}
  if(flame&&effectActive(flame,clock.simulation)){const p=view([0,0,sampleSurface(s,grid,0,0)]);for(let i=0;i<5;i++){ctx.fillStyle=i%2?"#ffcf69":"#ec783c";ctx.beginPath();ctx.ellipse(p.x+i*8-16,p.y-15,7,17+7*Math.sin(clock.visual*9+i),0,0,Math.PI*2);ctx.fill();}}
  const active=$("surface").value,selected=Number($("vertex").value);v[active].map(view).forEach((p,i)=>{if($("wire").checked)line(view([v[active][i][0],v[active][i][1],0]),p,"#7896af");ctx.beginPath();ctx.arc(p.x,p.y,i===selected?8:5,0,Math.PI*2);ctx.fillStyle=i===selected?"#f2bd60":"#d5e3ed";ctx.fill();ctx.strokeStyle="#243a4a";ctx.stroke();ctx.fillStyle="#fff";ctx.font="14px system-ui";ctx.fillText(options[i],p.x+10,p.y-9);});
  $("status").textContent=JSON.stringify({grid,cell:world.get(0,0,0),mesh_triangles:faces.length,simulation_seconds:clock.simulation.toFixed(2),visual_seconds:clock.visual.toFixed(2),effect:flame?.behavior??"none",active:!!flame&&effectActive(flame,clock.simulation)},null,2);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
