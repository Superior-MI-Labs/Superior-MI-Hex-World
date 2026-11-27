// Spatial host conditions and pure visual responses. No physics or renderer state.
import {stableUnit} from "./materials.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const record=v=>v&&typeof v==="object"&&!Array.isArray(v);
const token=v=>typeof v==="string"&&v.length>0&&v.length<=200;
const ints=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(Number.isSafeInteger);
export const CALM=Object.freeze({velocity_ft_s:Object.freeze([0,0]),gust:0});
export function validateWind(w){
  assert(record(w)&&Array.isArray(w.velocity_ft_s)&&w.velocity_ft_s.length===2&&w.velocity_ft_s.every(v=>finite(v,-150,150))&&Math.hypot(...w.velocity_ft_s)<=150&&finite(w.gust??0,0,1),"Invalid wind");
  return {velocity_ft_s:[...w.velocity_ft_s],gust:w.gust??0};
}
export const SEASONS=Object.freeze(["spring","summer","autumn","winter"]);
export const DEFAULT_CLIMATE=Object.freeze({season:"summer",temperature_c:20,precipitation:"none",intensity:0});
export function validateClimate(value=DEFAULT_CLIMATE){
  assert(record(value)&&SEASONS.includes(value.season)&&finite(value.temperature_c,-100,100)&&["none","rain","snow","hail"].includes(value.precipitation)&&finite(value.intensity,0,1)&&(value.precipitation!=="none"||value.intensity===0),"Invalid climate");
  return {season:value.season,temperature_c:value.temperature_c,precipitation:value.precipitation,intensity:value.intensity};
}
export const DEFAULT_LIGHTING=Object.freeze({ambient:.57,direction:Object.freeze([-.45,-.35,.82]),occlusion:.4,sprite_strength:.35,shadow_strength:.45});
export function validateLighting(l){
  assert(record(l)&&finite(l.ambient,0,1)&&Array.isArray(l.direction)&&l.direction.length===3&&l.direction.every(v=>finite(v,-1e6,1e6))&&Math.hypot(...l.direction)>0,"Invalid lighting");
  const result={ambient:l.ambient,direction:[...l.direction]};
  for(const k of ["occlusion","sprite_strength","shadow_strength"]){assert(finite(l[k]??DEFAULT_LIGHTING[k],0,1),"Invalid lighting "+k);result[k]=l[k]??DEFAULT_LIGHTING[k];}
  return result;
}
// Host-owned light source, independent of artwork and collision.
export function validateLightSource(l){
  assert(record(l)&&Array.isArray(l.color)&&l.color.length===3&&l.color.every(v=>finite(v,0,1))&&finite(l.radius_ft,.1,60)&&finite(l.intensity,0,2)&&finite(l.offset_z_ft??0,-20,100)&&finite(l.flicker??0,0,1)&&finite(l.emissive??0,0,1),"Invalid point light");
  return {color:[...l.color],radius_ft:l.radius_ft,intensity:l.intensity,offset_z_ft:l.offset_z_ft??0,flicker:l.flicker??0,emissive:l.emissive??0};
}
// Local fill height is a fraction of the cell, not a second solid shape.
export function validateWater(w){
  assert(record(w)&&finite(w.fill,0,1)&&Array.isArray(w.flow_ft_s??[0,0])&&(w.flow_ft_s??[0,0]).length===2&&(w.flow_ft_s??[0,0]).every(v=>finite(v,-30,30))&&Math.hypot(...(w.flow_ft_s??[0,0]))<=30,"Invalid water component");
  assert(w.fixed===undefined||typeof w.fixed==="boolean","Invalid fixed water setting");
  return {fill:w.fill,flow_ft_s:[...(w.flow_ft_s??[0,0])],...(w.fixed===true?{fixed:true}:{})};
}
export function validateEnvironment(e={wind:CALM,zones:[]}){
  assert(record(e)&&Array.isArray(e.zones??[])&&(e.zones??[]).length<=128,"Invalid environment");
  assert(e.water_simulation===undefined||typeof e.water_simulation==="boolean","Invalid water simulation setting");
  const ids=new Set(),zones=(e.zones??[]).map(z=>{
    assert(record(z)&&token(z.id)&&!ids.has(z.id)&&ints(z.center,2)&&Number.isInteger(z.radius)&&z.radius>=0&&z.radius<=128&&ints(z.levels,2)&&z.levels[0]<=z.levels[1],"Invalid wind zone");
    assert(z.wind!==undefined||z.climate!==undefined,"Empty environmental zone");
    ids.add(z.id);return {id:z.id,center:[...z.center],radius:z.radius,levels:[...z.levels],...(z.wind!==undefined?{wind:validateWind(z.wind)}:{}),...(z.climate!==undefined?{climate:validateClimate(z.climate)}:{})};
  });
  return {wind:validateWind(e.wind??CALM),climate:validateClimate(e.climate),zones,...(e.water_simulation!==undefined?{water_simulation:e.water_simulation}:{}),...(e.lighting!==undefined?{lighting:validateLighting(e.lighting)}:{})};
}
function fieldAt(field,address,key,fallback){
  let value=field[key]??fallback;
  for(const zone of field.zones){
    const dq=address[0]-zone.center[0],dr=address[1]-zone.center[1];
    if(zone[key]!==undefined&&address[2]>=zone.levels[0]&&address[2]<=zone.levels[1]&&Math.max(Math.abs(dq),Math.abs(dr),Math.abs(dq+dr))<=zone.radius)value=zone[key];
  }
  return value;
}
export const windAt=(field,address)=>fieldAt(field,address,"wind",CALM);
export const climateAt=(field,address)=>fieldAt(field,address,"climate",DEFAULT_CLIMATE);
export function sampleWind(w,point,seconds){
  const phase=point[0]*.17+point[1]*.13+seconds*1.8;
  const factor=1+w.gust*(.7*Math.sin(phase)+.3*Math.sin(phase*.61+1.4));
  return w.velocity_ft_s.map(v=>v*factor);
}
export function validateWindResponse(w){
  assert(record(w)&&finite(w.bend??0,0,1)&&finite(w.reference_speed_ft_s??20,.1,150)&&Array.isArray(w.states??[])&&(w.states??[]).length<=16,"Invalid wind response");
  let previous=-1;
  const states=(w.states??[]).map(s=>{
    assert(record(s)&&finite(s.min_speed_ft_s,0,300)&&s.min_speed_ft_s>previous&&token(s.state),"Invalid wind state threshold");previous=s.min_speed_ft_s;
    return {min_speed_ft_s:s.min_speed_ft_s,state:s.state};
  });
  return {bend:w.bend??0,reference_speed_ft_s:w.reference_speed_ft_s??20,states};
}
export function windState(response,wind,neutral=null){
  let state=neutral;if(!response)return state;
  // Use sustained speed, not gusts, to avoid state thrashing.
  const speed=Math.hypot(...wind.velocity_ft_s);
  for(const s of response.states)if(speed>=s.min_speed_ft_s)state=s.state;
  return state;
}
export function windOffset(response,wind,height){
  if(!response||!response.bend)return [0,0];
  const speed=Math.hypot(...wind);
  if(speed<1e-8)return [0,0];
  const amount=height*response.bend*Math.min(1,speed/response.reference_speed_ft_s);
  return wind.map(v=>v/speed*amount);
}
// Combine contact and wind on the same original quad; cap total tip displacement.
export function composeBend(neutral,contact,offset,height){
  const dx=contact[0][0]-neutral[0][0]+offset[0],dy=contact[0][1]-neutral[0][1]+offset[1],d=Math.hypot(dx,dy);
  if(d<1e-8)return neutral;
  const scale=Math.min(1,height/d);
  return neutral.map((p,i)=>i<2?[p[0]+dx*scale,p[1]+dy*scale,p[2]]:p);
}

// Lightweight, read-only precipitation presentation. Only topmost rendered
// terrain triangles in each column participate; no claim of roof/sky simulation.
// The caller supplies the real, uncut terrain and a camera-visible subset.
export function precipitationPlan(faces,visible,field,seed,{limit=192}={}){
  assert(Number.isSafeInteger(limit)&&limit>=0&&limit<=1024,"Invalid precipitation budget");
  if(!limit||![field.climate,...field.zones.map(z=>z.climate)].some(c=>c?.intensity>0&&c.precipitation!=="none"))return [];
  const column=a=>a.slice(0,2).join(","),top=new Map(),climates=new Map(),winds=new Map(),candidates=[];
  for(const f of faces)if(f.kind==="top"){const key=column(f.address);top.set(key,Math.max(top.get(key)??-Infinity,f.address[2]));}
  for(const f of visible){
    if(f.kind!=="top"||f.address[2]!==top.get(column(f.address)))continue;
    const key=f.address.join(",");
    if(!climates.has(key))climates.set(key,climateAt(field,f.address));
    const c=climates.get(key);if(!c.intensity||c.precipitation==="none")continue;
    const id=[...f.address,f.triangle];
    if(stableUnit(seed,id,"precipitation-density")>=c.intensity)continue;
    if(!winds.has(key))winds.set(key,windAt(field,f.address));
    const u=Math.sqrt(stableUnit(seed,id,"precipitation-u")),v=stableUnit(seed,id,"precipitation-v");
    const weights=[1-u,u*(1-v),u*v],point=[0,1,2].map(i=>f.points.reduce((n,p,j)=>n+p[i]*weights[j],0));
    candidates.push({id,point,kind:c.precipitation,wind:winds.get(key),phase:stableUnit(seed,id,"precipitation-phase"),rank:stableUnit(seed,id,"precipitation-priority")});
  }
  candidates.sort((a,b)=>a.rank-b.rank||a.id.join(",").localeCompare(b.id.join(",")));
  return candidates.slice(0,limit);
}
export function precipitationParticle(sample,seconds){
  const snow=sample.kind==="snow",hail=sample.kind==="hail",height=8,speed=snow?2.5:hail?24:18;
  const progress=((seconds*speed/height+sample.phase)%1+1)%1,remaining=(1-progress)*height;
  const wind=sampleWind(sample.wind,sample.point,seconds),length=Math.hypot(...wind);
  const drift=length?Math.min(.9,length*.08)*remaining/height:0;
  return {kind:sample.kind,point:[sample.point[0]-(length?wind[0]/length*drift:0),sample.point[1]-(length?wind[1]/length*drift:0),sample.point[2]+remaining],width:snow?.22:hail?.18:.12,height:snow?.22:hail?.18:.95};
}
