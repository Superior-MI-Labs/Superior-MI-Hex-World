import {physicalPosition,effectActive} from "./core.mjs";
import {sampleSurface,hasVolume} from "./geometry.mjs";
import {anchorHeight} from "./entities.mjs";
import {validateLightSource} from "./environment.mjs";
// Contact shadow geometry is projected onto the same top triangles as terrain.
export function contactShadows(faces,objects){
  const surfaces=new Map();
  for(const f of faces){if(f.kind!=="top")continue;const k=f.address.join(","),list=surfaces.get(k)??[];list.push(f);surfaces.set(k,list);}
  const out=[];
  for(const o of objects){
    if(!Number.isFinite(o.radius)||o.radius<=0)continue;
    for(const f of surfaces.get(o.address.join(","))??[])out.push({points:f.points,uv:f.points.map(([x,y])=>[.5+(x-o.point[0])/(2*o.radius),.5+(y-o.point[1])/(2*o.radius)]),opacity:o.opacity??.35});
  }
  return out;
}

// Camera-independent top-surface ambient occlusion. Six nearby probes above
// each shared vertex detect real solid terrain, not artwork or hidden faces.
// Unknown cells are not counted as occluders; lighting is presentation only.
export function terrainOcclusion(world,faces){
  const g=world.config.grid,cells=new Map(),vertices=new Map(),radius=g.horizontal_ft*.20,lift=g.vertical_ft*.10;
  function blocked(x,y,z){
    const r=2*y/(Math.sqrt(3)*g.horizontal_ft),q=x/g.horizontal_ft-r/2,s=-q-r;
    let a=Math.round(q),b=Math.round(r),c=Math.round(s);
    const da=Math.abs(a-q),db=Math.abs(b-r),dc=Math.abs(c-s);
    if(da>db&&da>dc)a=-b-c;else if(db>dc)b=-a-c;
    const level=Math.floor(z/g.vertical_ft),k=[a,b,level].join(",");
    if(![a,b,level].every(Number.isSafeInteger))return false;
    if(!cells.has(k))cells.set(k,world.get(a,b,level));
    const cell=cells.get(k);if(!cell||cell.material==="air")return false;
    const o=physicalPosition(a,b,level,g),lo=sampleSurface(cell.shape,g,x-o.x,y-o.y,"lower"),hi=sampleSurface(cell.shape,g,x-o.x,y-o.y);
    return lo!==undefined&&hi!==undefined&&z-o.z>lo+1e-8&&z-o.z<hi-1e-8;
  }
  function at(p){
    const k=p.map(v=>v.toFixed(6)).join(",");if(vertices.has(k))return vertices.get(k);
    let count=0;
    for(let i=0;i<6;i++){const a=i*Math.PI/3;if(blocked(p[0]+radius*Math.cos(a),p[1]+radius*Math.sin(a),p[2]+lift))count++;}
    const value=count/6;vertices.set(k,value);return value;
  }
  return faces.map(f=>f.kind==="top"?{...f,occlusion:f.points.map(at)}:f);
}
// Approximate directional shadows from upright object bounds using the same
// soft radial texture as contact shadows. Project onto visible terrain on
// the caster's support level, rather than drawing a screen-space decal.
export function directionalShadows(faces,objects,light,grid,{limit=20000}={}){
  const out=[],surfaces=new Map(),[dx,dy,dz]=light.direction,horizontal=Math.hypot(dx,dy),len=Math.hypot(dx,dy,dz);
  if(dz<=0||horizontal<1e-8||!light.shadow_strength||light.ambient>=1)return {faces:out,truncated:false};
  const ux=-dx/horizontal,uy=-dy/horizontal,vx=-uy,vy=ux,step=grid.horizontal_ft;
  for(const f of faces)if(f.kind==="top"){const k=f.address.join(","),list=surfaces.get(k)??[];list.push(f);surfaces.set(k,list);}
  for(const o of objects){
    if(!Number.isFinite(o.height)||o.height<=0||!Number.isFinite(o.radius)||o.radius<=0)continue;
    // Capped projection keeps near-horizon shadows bounded.
    const length=Math.min(step*3,o.height*horizontal/Math.max(dz,len*.15)),long=length/2+o.radius,wide=o.radius;
    const center=[o.point[0]+ux*length/2,o.point[1]+uy*length/2],radius=Math.ceil((length+wide)/step)+2;
    const [q,r,z]=o.address;
    for(let a=-radius;a<=radius;a++)for(let b=Math.max(-radius,-a-radius);b<=Math.min(radius,-a+radius);b++)for(const f of surfaces.get([q+a,r+b,z].join(","))??[]){
      // Do not cast upwards onto higher terrain. Cross-level shadows require
      // an actual light visibility solution and are deliberately excluded.
      if(f.points.some(p=>p[2]>o.point[2]+1e-6))continue;
      const uv=f.points.map(([x,y])=>{const sx=x-center[0],sy=y-center[1];return [.5+(sx*vx+sy*vy)/(2*wide),.5+(sx*ux+sy*uy)/(2*long)];});
      if([0,1].some(i=>uv.every(v=>v[i]<0)||uv.every(v=>v[i]>1)))continue;
      if(out.length>=limit)return {faces:out,truncated:true};
      out.push({points:f.points,uv,opacity:(o.opacity??.35)*light.shadow_strength*(1-light.ambient)});
    }
  }
  return {faces:out,truncated:false};
}
export function spriteShade(light){
  return light?1-(1-light.ambient)*(light.sprite_strength??0)*.5:1;
}

// One light contribution contract, used by objects and existing fire effects.
export const MAX_POINT_LIGHTS=24;
const FIRE_LIGHT=Object.freeze(validateLightSource({color:[1,.48,.16],radius_ft:12,intensity:1.15,offset_z_ft:1.5,flicker:.25}));
function flicker(id,t,amount){
  let hash=2166136261;for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);
  const phase=(hash>>>0)/4294967296*Math.PI*2;
  return 1-amount*(.5+.3*Math.sin(t*9+phase)+.2*Math.sin(t*17-phase));
}
export function collectPointLights(world,{simulationTime=0,visualTime=0,poses=new Map(),displayed=()=>true}={}){
  const g=world.config.grid,out=[];
  function add(id,point,l){
    if(!l.intensity||!l.color.some(v=>v>0))return;
    out.push({id,point:[point[0],point[1],point[2]+l.offset_z_ft],radius:l.radius_ft,color:l.color,intensity:l.intensity*flicker(id,visualTime,l.flicker)});
  }
  for(const e of world.entities()){
    if(!e.light)continue;const h=anchorHeight(e,world.get(...e.address),g);if(h===undefined)continue;
    const o=physicalPosition(...e.address,g),pose=poses.get(e.id);
    if(!displayed(pose?.address??e.address))continue;
    add("entity:"+e.id,pose?.point??[o.x+e.offset_ft[0],o.y+e.offset_ft[1],o.z+h],e.light);
  }
  // Co-located fire effects and burning surface share a single source.
  const fires=new Map();
  for(const e of world.effects())if(e.kind==="fire"&&effectActive(e.instance,simulationTime))fires.set(e.address.join(","),e.address);
  for(const a of world.burningAddresses())fires.set(a.join(","),a);
  for(const [key,a] of fires){
    if(!displayed(a))continue;const cell=world.get(...a);if(!cell)continue;
    const o=physicalPosition(...a,g),z=sampleSurface(cell.shape,g,0,0);
    if(z!==undefined&&hasVolume(cell.shape))add("fire:"+key,[o.x,o.y,o.z+z],FIRE_LIGHT);
  }
  return out;
}
// Select the strongest candidates intersecting rendered world bounds, with
// deterministic ID ties. The limit is a rendering budget, not saved state.
export function selectPointLights(lights,faces,sprites=[],limit=MAX_POINT_LIGHTS){
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(const items of [faces,sprites])for(const f of items)for(const p of f.points)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
  if(lo[0]===Infinity)return {lights:[],omitted:0};
  const candidates=[];
  for(const l of lights){
    const distance=Math.hypot(...l.point.map((v,i)=>Math.max(lo[i]-v,0,v-hi[i])));
    if(distance>=l.radius)continue;
    candidates.push({l,score:l.intensity*(1-distance/l.radius)**2});
  }
  candidates.sort((a,b)=>b.score-a.score||(a.l.id<b.l.id?-1:a.l.id>b.l.id?1:0));
  return {lights:candidates.slice(0,limit).map(v=>v.l),omitted:Math.max(0,candidates.length-limit)};
}
