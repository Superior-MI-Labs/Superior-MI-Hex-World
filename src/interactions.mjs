// Data-only spatial interactions. No scripts, rendering dependencies or game rules.
import {hasVolume} from "./geometry.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
const token=s=>typeof s==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(s);
const finite=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max;
const key=a=>a.join(",");
const same=(a,b)=>key(a)===key(b);
const fields=["growth","health","moisture","leaves","snow","scorch"];
export function interactionTags(tags=[]){
  assert(Array.isArray(tags)&&tags.length<=32&&tags.every(token),"Invalid interaction tags");
  return [...new Set(tags)].sort();
}
export function validateInteractions(p){
  assert(p?.schema==="smi-hex-interactions/1"&&Array.isArray(p.rules)&&p.rules.length<=128,"Invalid interaction profile");
  const ids=new Set();
  for(const r of p.rules){
    assert(token(r.id)&&!ids.has(r.id)&&["enter","leave","use"].includes(r.event),"Invalid interaction rule");ids.add(r.id);
    const m=r.match;
    assert(m&&["cell","entity"].includes(m.kind),"Invalid interaction target");
    interactionTags(m.tags);
    if(m.material!==undefined)assert(m.kind==="cell"&&token(m.material),"Invalid material selector");
    if(m.surface!==undefined){
      assert(m.kind==="cell"&&m.surface&&typeof m.surface==="object"&&!Array.isArray(m.surface),"Invalid surface selector");
      for(const [k,v] of Object.entries(m.surface))assert(fields.includes(k)&&Array.isArray(v)&&v.length===2&&finite(v[0],0,1)&&finite(v[1],v[0],1),"Invalid surface range");
    }
    assert(token(r.signal),"Invalid interaction signal");
    if(r.bend!==undefined){
      const b=r.bend;
      assert(r.event==="enter"&&b&&finite(b.radius_ft,.1,20)&&finite(b.vertical_ft,.1,20)&&finite(b.strength,0,1),"Invalid contact response");
    }
  }
  return structuredClone(p);
}
export function cellTarget(address,cell){
  return cell?{kind:"cell",address:[...address],tags:cell.components?.interaction_tags??[],material:cell.material,surface:cell.components?.surface,solid:hasVolume(cell.shape)}:null;
}
export function entityTarget(e){return {kind:"entity",id:e.id,address:[...e.address],tags:e.interaction_tags??[]};}
function matches(r,t){
  if(!t||r.match.kind!==t.kind)return false;
  const m=r.match;
  if(!(m.tags??[]).every(tag=>t.tags.includes(tag)))return false;
  if(m.material!==undefined&&m.material!==t.material)return false;
  if(m.surface!==undefined){
    if(!t.solid||!t.surface)return false;
    for(const [k,[lo,hi]] of Object.entries(m.surface))if(!finite(t.surface[k],lo,hi))return false;
  }
  return true;
}
export function responsesFor(profile,event,target){
  return profile.rules.filter(r=>r.event===event&&matches(r,target));
}
export function contactResponse(profile,target){
  // Deterministic first matching response; one deformation, no stacked impulses.
  return responsesFor(profile,"enter",target).find(r=>r.bend)?.bend??null;
}
function indexEntities(world,actorId){
  const index=new Map();
  for(const e of world.entities()){
    if(e.id===actorId)continue;
    const k=key(e.address),list=index.get(k)??[];list.push(entityTarget(e));index.set(k,list);
  }
  for(const list of index.values())list.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return index;
}
function eventFor(profile,event,actorId,target,step,from,to){
  return {event,actor_id:actorId,target:{kind:target.kind,address:[...target.address],...(target.id?{id:target.id}:{})},step,from:[...from],to:[...to],signals:responsesFor(profile,event,target).map(r=>({rule:r.id,signal:r.signal}))};
}
// Called on a route already validated by navigation, before the single world commit.
export function routeInteractions(world,actorId,path,profile){
  const p=validateInteractions(profile),actor=world.getEntity(actorId);
  assert(actor&&Array.isArray(path)&&path.length>0&&same(actor.address,path[0]),"Invalid interaction route");
  const index=indexEntities(world,actorId),events=[];
  for(let i=1;i<path.length;i++){
    const from=path[i-1],to=path[i];
    if(same(from,to))continue;
    for(const [event,address] of [["leave",from],["enter",to]]){
      const target=cellTarget(address,world.get(...address));assert(target,"Unknown interaction cell");
      for(const t of [target,...(index.get(key(address))??[])])events.push(eventFor(p,event,actorId,t,i,from,to));
    }
  }
  return events;
}
// Reach is checked by navigation. This resolver only handles the specified target.
export function useInteraction(world,actorId,address,profile,targetId=null){
  const p=validateInteractions(profile),actor=world.getEntity(actorId);
  assert(actor,"Unknown interaction actor");
  let t;
  if(targetId!==null){const e=world.getEntity(targetId);assert(e&&e.id!==actorId&&same(e.address,address),"Unknown interaction target");t=entityTarget(e);}
  else t=cellTarget(address,world.get(...address));
  assert(t,"Unknown interaction target");
  return eventFor(p,"use",actorId,t,0,actor.address,address);
}
// Pure world-space visual response. Keeps bottom edge fixed and eases toward
// zero at the edge of a contact radius. Never modifies terrain or entity records.
export function bendBillboard(points,root,height,contacts,response,exclude=null){
  if(!response)return points;
  let dx=0,dy=0;
  for(const c of contacts){
    if(c.id===exclude||Math.abs(c.point[2]-root[2])>=response.vertical_ft)continue;
    const x=root[0]-c.point[0],y=root[1]-c.point[1],d=Math.hypot(x,y);
    if(d>=response.radius_ft||d<1e-8)continue;
    const w=(1-d/response.radius_ft)**2*(1-Math.abs(c.point[2]-root[2])/response.vertical_ft);
    dx+=x/d*w;dy+=y/d*w;
  }
  const len=Math.hypot(dx,dy);if(len<1e-8)return points;
  const factor=height*response.strength*Math.min(1,len)/len;
  return points.map((p,i)=>i<2?[p[0]+dx*factor,p[1]+dy*factor,p[2]]:p);
}
