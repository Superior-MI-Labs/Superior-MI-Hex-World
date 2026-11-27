// The public catalog is discovery metadata; the actual archive is qualified at load.
import {spriteBinding} from "./entities.mjs";
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
export const ATLAS_CATALOG="https://superior-mi-labs.github.io/Superior-MI-Icon-Atlas/public-catalog.json";
export function resolveCatalog(index,reference){
  const base=new URL(reference);
  assert(["http:","https:"].includes(base.protocol)&&!base.username&&!base.password,"Invalid catalog URL");
  assert(index?.schema==="smi-public-catalog/1"&&Array.isArray(index.packs)&&Array.isArray(index.assets)&&index.packs.length<=1024&&index.assets.length<=50000,"Invalid Atlas catalog");
  const packs=new Map(),entries=[],seen=new Set();
  for(const p of index.packs){
    if(!p.zip||p.archived)continue;
    assert(typeof p.id==="string"&&!packs.has(p.id),"Duplicate catalog pack");
    assert(typeof p.zip==="string"&&/^demo\/[a-zA-Z0-9_-]+\.zip$/.test(p.zip)&&typeof p.archive_sha256==="string"&&/^[a-f0-9]{64}$/.test(p.archive_sha256),"Catalog pack lacks safe pinned ZIP");
    packs.set(p.id,{manifest:new URL(p.zip,base).href,archive_sha256:p.archive_sha256});
  }
  for(const a of index.assets){
    if(a.legacy||!packs.has(a.pack)||a.discovery==="hidden")continue;
    assert(typeof a.id==="string"&&!seen.has(a.id),"Duplicate catalog asset");seen.add(a.id);
    const binding=spriteBinding({...packs.get(a.pack),asset:a.id});
    entries.push({id:a.id,pack:a.pack,visual_qa:a.visual_qa??"unknown",name:String(a.name??a.id),domain:String(a.domain??""),kind:a.kind,license:String(a.license??""),discovery:a.discovery??"standalone",capabilities:Array.isArray(a.capabilities)?a.capabilities.filter(x=>typeof x==="string"):[],binding});
  }
  return entries;
}
export async function fetchCatalog(reference=ATLAS_CATALOG,fetcher=fetch){
  const url=new URL(reference,globalThis.location?.href);assert(["http:","https:"].includes(url.protocol)&&!url.username&&!url.password,"Invalid catalog URL");
  const r=await fetcher(url,{credentials:"omit",redirect:"error"});assert(r.ok,"Atlas catalog unavailable");
  const limit=24*1024*1024,reader=r.body.getReader(),decoder=new TextDecoder();let length=0,content="";
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;assert(length<=limit,"Catalog exceeds limit");content+=decoder.decode(value,{stream:true});}content+=decoder.decode();}
  catch(e){await reader.cancel();throw e;}
  return resolveCatalog(JSON.parse(content),url.href);
}
export function searchCatalog(entries,query="",capability="",components=false,domain=""){
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(a=>(components||a.discovery==="standalone")&&(!domain||a.domain===domain)&&(!capability||a.capabilities.includes(capability))&&terms.every(t=>[a.id,a.name,a.domain,...a.capabilities].join(" ").toLowerCase().includes(t))).slice(0,200);
}
