// Derived horizontal free surfaces, clipped against the existing solid fan.
import {physicalPosition} from "./core.mjs";
import {vertices} from "./geometry.mjs";
const EPS=1e-8;
function clip(poly,depth){
  const out=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=depth(a)-EPS,db=depth(b)-EPS;
    if(da>=0)out.push(a);
    if((da>=0)!==(db>=0)){const t=da/(da-db);out.push(a.map((v,j)=>v+(b[j]-v)*t));}
  }
  return out;
}
export function waterFaces(world,address,grid=world.config.grid){
  const c=world.get(...address),w=c?.components?.water;
  if(!w||w.fill<=0)return [];
  const level=w.fill*grid.vertical_ft,o=physicalPosition(...address,grid),v=vertices(c.shape,grid),out=[];
  // Unknown is not air; suppress the top of a continued water column.
  const above=w.fill===1?world.get(address[0],address[1],address[2]+1):null;
  if(w.fill===1&&(!above||above.components?.water?.fill>0))return [];
  function emit(poly,depth){
    for(let i=1;i+1<poly.length;i++){
      const tri=[poly[0],poly[i],poly[i+1]],a=tri[0],b=tri[1],c=tri[2];
      if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<=EPS)continue;
      out.push({kind:"water",address:[...address],points:tri.map(p=>[o.x+p[0],o.y+p[1],o.z+level]),depth:tri.map(p=>Math.max(0,depth(p))),flow:[...w.flow_ft_s]});
    }
  }
  for(let i=0;i<6;i++){
    const ids=[6,i,(i+1)%6],poly=ids.map(k=>[...v.upper[k].slice(0,2),v.lower[k][2],v.upper[k][2]]);
    if(above&&ids.every(k=>above.shape.lower[k]===0)&&ids.some(k=>above.shape.upper[k]>0))continue;
    if(ids.every(k=>c.shape.lower[k]===c.shape.upper[k])){emit(poly,()=>level);continue;}
    emit(clip(poly,p=>p[2]-level),()=>level);
    emit(clip(poly,p=>level-p[3]),p=>level-p[3]);
  }
  return out;
}
export function buildWaterSurfaces(world,addresses){
  const g=world.config.grid,out=[];
  for(const a of addresses)for(const f of waterFaces(world,a,g))out.push(f);
  return out;
}
