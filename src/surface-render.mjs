// All transition values are derived render attributes, never world state.
import {physicalPosition} from "./core.mjs";
import {cornerRefs,EDGE_NEIGHBORS,oppositeEdge,vertices} from "./geometry.mjs";
import {appearance,transitionSettings} from "./materials.mjs";
import {TerrainFaceCache} from "./terrain.mjs";
const mix=(a,b,t)=>a+(b-a)*t;
const vector=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));
function blendWeights(a,b,t){
  const weights=new Map();
  for(const [k,v] of a)weights.set(k,v*(1-t));
  for(const [k,v] of b)weights.set(k,(weights.get(k)??0)+v*t);
  return [...weights].filter(([,v])=>v>0).sort(([a],[b])=>a<b?-1:a>b?1:0);
}
const combine=(a,b,t)=>t===0?a:t===1?b:({color:vector(a.color,b.color,t),cover:vector(a.cover,b.cover,t),vegetation:mix(a.vegetation,b.vegetation,t),weights:blendWeights(a.weights,b.weights,t)});
const avg=items=>items.reduce((acc,v,i)=>i?combine(acc,v,1/(i+1)):v,null);
const key=a=>a.join(",");
const clamp=v=>Math.min(1,Math.max(0,v));
export function decorateTerrain(world,addresses,catalog,{enabled=true,cache=new TerrainFaceCache(world)}={}){
  const grid=world.config.grid,seed=world.config.id,style=transitionSettings(catalog.transitions),records=new Map(),corners=new Map();
  function record(address){
    const k=key(address);if(records.has(k))return records.get(k);
    const cell=world.get(...address),faces=cache.get(address);
    const r=cell?{address,cell,faces,top:new Set(faces.filter(f=>f.kind==="top").map(f=>f.triangle)),app:{...appearance(catalog,seed,address,cell,"top"),weights:[[cell.material,1]]}}:null;
    records.set(k,r);return r;
  }
  function connected(a,b){
    const e=EDGE_NEIGHBORS.findIndex(([q,r])=>a.address[0]+q===b.address[0]&&a.address[1]+r===b.address[1]);
    if(e<0)return false;const o=oppositeEdge(e);
    if(!a.top.has(e)||!b.top.has(o))return false;
    const x=a.cell.shape.upper,y=b.cell.shape.upper;
    return x[e]===y[(o+1)%6]&&x[(e+1)%6]===y[o];
  }
  function corner(r,i){
    if(!enabled||i===6||!style.edge_strength)return r.app;
    const k=key(r.address)+":"+i;if(corners.has(k))return corners.get(k);
    const participants=cornerRefs(...r.address,i).map(ref=>record(ref.address)).filter(v=>v&&v.top.size);
    const group=new Set([r]);let grew=true;
    while(grew){grew=false;for(const p of participants)if(!group.has(p)&&[...group].some(q=>connected(p,q))){group.add(p);grew=true;}}
    const sorted=[...group].sort((a,b)=>key(a.address).localeCompare(key(b.address)));
    const result=combine(r.app,avg(sorted.map(p=>p.app)),style.edge_strength);corners.set(k,result);return result;
  }
  const result=[];
  for(const address of addresses){
    const r=record(address);if(!r)continue;
    const origin=physicalPosition(...address,grid),v=vertices(r.cell.shape,grid);
    for(const face of r.faces){
      const app=face.kind==="top"?r.app:appearance(catalog,seed,address,r.cell,face.kind);
      let attributes,vegetation=app.vegetation;
      if(face.kind==="top"){
        const points=[6,face.triangle,(face.triangle+1)%6].map(i=>corner(r,i));
        attributes=points.map(p=>({color:p.color,cover:p.cover,rim:-1,materialWeights:p.weights}));
        vegetation=Object.hasOwn(catalog.materials,r.cell.material)&&catalog.materials[r.cell.material].vegetation?avg(points).vegetation:0;
      }else if(face.kind==="side"&&enabled&&style.cliff_bleed_ft>0&&r.top.has(face.edge)){
        const e=face.edge,j=(e+1)%6,a=v.upper[e],b=v.upper[j],dx=b[0]-a[0],dy=b[1]-a[1];
        const c0=corner(r,e),c1=corner(r,j);
        attributes=face.points.map(([x,y,z])=>{
          const t=clamp(((x-origin.x-a[0])*dx+(y-origin.y-a[1])*dy)/(dx*dx+dy*dy)),h=mix(a[2],b[2],t)+origin.z;
          const c=vector(c0.cover,c1.cover,t);
          return {color:app.color,cover:[0,c[1],c[2]],rim:Math.max(0,h-z)};
        });
      }
      result.push({...face,...app,vegetation,...(attributes?{attributes}: {})});
    }
  }
  return result;
}
