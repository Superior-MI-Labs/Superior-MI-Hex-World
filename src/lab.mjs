import {World,Clock,effect,effectActive,physicalPosition} from "./core.mjs";
import {vertices,uniformShape,sampleSurface,hasVolume} from "./geometry.mjs";
import {editVertex,vertexLimits,TerrainFaceCache} from "./terrain.mjs";
import {decorateTerrain} from "./surface-render.mjs";
import {faceKey,faceHandles,handleKey,handleLabel,nearestHandle} from "./editor.mjs";
import {project,pickFace,billboard,visibleTriangle} from "./camera.mjs";
import {createRenderer} from "./gpu.mjs";
import {createAtlasSprite,createAtlasMask,resolveAtlasBinding} from "./assets.mjs";
import {ATLAS_CATALOG,fetchCatalog,searchCatalog} from "./catalog.mjs";
import {appearanceOptions,dispatchAppearance,collisionSelection} from "./asset-interactions.mjs";
import {fetchStyle,vegetationSamples,vegetationRaster,vegetationWind,scatterRaster} from "./art-style.mjs";
import {EXPLORATION_PROFILE,explorationConfig,viewportBounds,loadViewport} from "./region.mjs";
import {placeObject,anchorHeight,visualKey,spriteBinding,directionalBinding,visualSelection,colliderActive,validateCollider} from "./entities.mjs";
import {validateMovement,planObjectMove,moveObject,interactObject,routeWaypoints,sampleRoute,routeGeometryStamp} from "./navigation.mjs";
import {cutawayView,cutawayMask,traceVisibility} from "./visibility.mjs";
import {SETTLEMENT,settlementGround,settlementDomain,settlementStart,buildSettlement} from "./settlement.mjs";
import {contactShadows,terrainOcclusion,directionalShadows,collectPointLights,selectPointLights} from "./lighting.mjs";
import {objectVolumes} from "./collision.mjs";
import {buildScatterPlan,promoteSample} from "./scatter.mjs";
import {CALM,DEFAULT_LIGHTING,validateLighting,validateLightSource,validateWindResponse,windAt,climateAt,sampleWind,windState,windOffset,composeBend} from "./environment.mjs";
import {validateInteractions,interactionTags,cellTarget,entityTarget,contactResponse,bendBillboard} from "./interactions.mjs";
import {validatePrefab,planPrefab,placePrefab,capturePrefab} from "./prefabs.mjs";
import {validateMaterials,surface,ignite,advanceSurface,withSurface,stableUnit} from "./materials.mjs";
const $=id=>document.getElementById(id),canvas=$("scene"),ctx=canvas.getContext("2d");
const gpu=createRenderer($("terrain"));
const base=await fetch("./examples/world.json").then(r=>{if(!r.ok)throw Error("World unavailable");return r.json()});
const movement=validateMovement(await fetch("./examples/movement.json").then(r=>{if(!r.ok)throw Error("Movement profile unavailable");return r.json();}));
const defaultInteractions=validateInteractions(await fetch("./examples/interactions.json").then(r=>{if(!r.ok)throw Error("Interactions unavailable");return r.json();}));
let interactions=defaultInteractions;
const catalog=validateMaterials(await fetch("./examples/materials.json").then(r=>{if(!r.ok)throw Error("Materials unavailable");return r.json();}));
let scatterPlan=[],scatterDirty=true,scatterChoices=[],scatterChoiceKey="";
let lastCollisionRevision=-1;
let world,grid,clock=new Clock(base.simulation),yaw=0,last,drag=null,selected=[0,0,0],dirty=true,faces=[],handles=[],scale=24,panX=0,panY=50,meshCache;
const island=Array.from({length:5},(_,i)=>i-2).flatMap(q=>Array.from({length:5},(_,i)=>i-2).filter(r=>Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2).map(r=>[q,r,0]));
const islandDomain=island.flatMap(([q,r])=>[-2,-1,0,1,2].map(z=>[q,r,z]));
let ground=island,domain=islandDomain,worldMode="island",regionKey="",cameraKey="",activeChunks=0;
function camera(){return {yaw,scale,width:canvas.width,height:canvas.height,panX,panY};}
function refreshRegion(force=false){
  if(worldMode!=="exploration")return;
  const current=JSON.stringify(camera());if(!force&&current===cameraKey)return;cameraKey=current;
  const bounds=viewportBounds(camera(),grid,undefined,Math.ceil(scale*5)),key=JSON.stringify(bounds);
  if(!force&&key===regionKey)return;
  const loaded=loadViewport(world,bounds);regionKey=key;domain=loaded.addresses;ground=domain.filter(a=>a[2]===0);activeChunks=loaded.chunks.length;dirty=true;
  if(!force)syncConstruction();
}
const prefabCatalog=(await fetch("./examples/prefabs.json").then(r=>{if(!r.ok)throw Error("Prefabs unavailable");return r.json();})).map(validatePrefab);
let capture=new Map(),captureAnchor=null;
const prefabSelect=$("prefab");for(const p of prefabCatalog)prefabSelect.add(new Option(p.name,p.id));
const demoVisual={manifest:"./examples/atlas-character/manifest.json",asset:"smi.example.robot.states",state:"idle",height_ft:4,walk_state:"walk"};
let actor=null,spriteRequest=0,art=null,activeBinding=demoVisual;
const spriteCache=new Map();
function requestSprite(binding){
  const key=visualKey(binding)+(binding.requireState?":strict-state":"");
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
let preview=null,routePreview=null,visibilityPreview=null;
const playback=new Map();
let interactionEvents=[],contactByCell=new Map();
const fixtureWind=validateWindResponse({bend:.4,reference_speed_ft_s:20});
function windInput(){const a=Number($("windAngle").value)*Math.PI/180,s=Number($("windSpeed").value);return {velocity_ft_s:[s*Math.cos(a),s*Math.sin(a)],gust:Number($("windGust").value)};}
function syncWind(){const e=world.environment,w=e.wind; $("windSpeed").value=Math.hypot(...w.velocity_ft_s);$("windAngle").value=(Math.atan2(w.velocity_ft_s[1],w.velocity_ft_s[0])*180/Math.PI+360)%360;$("windGust").value=w.gust;$("windStatus").textContent=e.zones.length+" local zones";}
function updateWind(mode){try{const e=world.environment;
  if(mode==="global")e.wind=windInput();
  else if(mode==="clear")e.zones=e.zones.flatMap(z=>{const {wind,...rest}=z;return rest.climate?[rest]:[];});
  else {const id="lab:"+selected.join(","),zone={id,center:selected.slice(0,2),radius:Number($("windRadius").value),levels:[selected[2],selected[2]],wind:mode==="shelter"?CALM:windInput()};e.zones=e.zones.filter(z=>z.id!==id);e.zones.push(zone);}
  world.setEnvironment(e);$("windStatus").textContent=e.zones.length+" local zones";
}catch(e){$("windStatus").textContent=e.message;}}
$("applyWind").onclick=()=>updateWind("global");$("localWind").onclick=()=>updateWind("local");$("shelterWind").onclick=()=>updateWind("shelter");$("clearWind").onclick=()=>updateWind("clear");
function syncLighting(){
  const l=world.environment.lighting??art?.profile.lighting??DEFAULT_LIGHTING,[x,y,z]=l.direction;
  $("sunAzimuth").value=(Math.atan2(y,x)*180/Math.PI+360)%360;
  $("sunElevation").value=Math.asin(z/Math.hypot(x,y,z))*180/Math.PI;
  $("sunAmbient").value=l.ambient;
  $("lightStatus").textContent=world.environment.lighting?"World lighting override":"Style lighting";
}
$("applyLighting").onclick=()=>{try{
  const e=world.environment,a=Number($("sunAzimuth").value)*Math.PI/180,b=Number($("sunElevation").value)*Math.PI/180;
  e.lighting=validateLighting({...art?.profile.lighting,ambient:Number($("sunAmbient").value),direction:[Math.cos(a)*Math.cos(b),Math.sin(a)*Math.cos(b),Math.sin(b)]});world.setEnvironment(e);syncLighting();
}catch(e){$("lightStatus").textContent=e.message;}};
$("resetLighting").onclick=()=>{const e=world.environment;delete e.lighting;world.setEnvironment(e);syncLighting();};
$("ambientOcclusion").onchange=()=>{dirty=true;};
function syncClimate(){const c=world.environment.climate;$("season").value=c.season;$("temperature").value=c.temperature_c;$("precipitation").value=c.precipitation;$("precipIntensity").value=c.intensity;$("climateStatus").textContent="World climate loaded";}
function updateClimate(local){try{
  const e=world.environment,kind=$("precipitation").value,c={season:$("season").value,temperature_c:Number($("temperature").value),precipitation:kind,intensity:kind==="none"?0:Number($("precipIntensity").value)};
  if(local){const id="climate:"+selected.join(",");e.zones=e.zones.filter(z=>z.id!==id);e.zones.push({id,center:selected.slice(0,2),radius:Number($("windRadius").value),levels:[selected[2],selected[2]],climate:c});}
  else e.climate=c;
  world.setEnvironment(e);$("climateStatus").textContent=local?"Local climate applied":"World climate applied";
}catch(e){$("climateStatus").textContent=e.message;}}
$("applyClimate").onclick=()=>updateClimate(false);$("localClimate").onclick=()=>updateClimate(true);
$("clearClimate").onclick=()=>{const e=world.environment;e.zones=e.zones.flatMap(z=>{const {climate,...rest}=z;return rest.wind?[rest]:[];});world.setEnvironment(e);$("climateStatus").textContent="Local climate cleared";};
const parseTags=s=>interactionTags(s.split(",").map(v=>v.trim()).filter(Boolean));
function setInteractions(profile){interactions=validateInteractions(profile);contactByCell.clear();showEvents([]);$("interactionProfileStatus").textContent=interactions.rules.length+" rules loaded";}
$("importInteractions").onchange=async()=>{try{const f=$("importInteractions").files[0];if(!f)return;if(f.size>256000)throw Error("Interaction profile exceeds 256 KB");setInteractions(JSON.parse(await f.text()));}catch(e){$("interactionProfileStatus").textContent="Previous profile retained: "+e.message;}finally{$("importInteractions").value="";}};
$("resetInteractions").onclick=()=>setInteractions(defaultInteractions);
function showEvents(events){interactionEvents=events;const signals=events.flatMap(e=>e.signals.map(s=>s.signal));$("interactionStatus").textContent=events.length+" spatial events; "+(signals.join(", ")||"no matching signals");}
$("setCellTags").onclick=()=>{try{const c=world.get(...selected);world.set(...selected,{...c,components:{...c.components,interaction_tags:parseTags($("cellTags").value)}});dirty=true;sync();}catch(e){$("interactionStatus").textContent=e.message;}};
$("setObjectTags").onclick=()=>{try{world.setEntityTags($("objects").value,parseTags($("objectTags").value));syncConstruction();}catch(e){$("interactionStatus").textContent=e.message;}};
const usingObjects=new Set();
async function useSelected(targetId=null){
  const owner=world,actorId=$("movingObject").value,address=[...selected];
  if(targetId&&usingObjects.has(targetId))return;
  if(targetId)usingObjects.add(targetId);
  try{
    let result=interactObject(owner,actorId,address,movement,interactions,targetId);
    if(!result.ok){$("interactionStatus").textContent=result.reason;return;}
    const e=targetId?owner.getEntity(targetId):null;
    let response=null;
    if(e){
      const {next}=await qualifyBinding(e.visual),contract=next.contract;
      // Camera changes must not change the semantics of an object event.
      if(e.visual.views&&contract.behavior?.on?.use){
        for(const view of new Set(e.visual.views)){
          const v=await requestSprite({...directionalBinding(e.visual,0),asset:view}).promise;
          if(!v||!globalThis.VisualAtlasCollections.equivalent({inputs:v.contract.inputs,behavior:v.contract.behavior},{inputs:contract.inputs,behavior:contract.behavior}))throw Error("Directional use contracts disagree");
        }
      }
      response=dispatchAppearance(contract,visualSelection(e.visual),"use");
      if(response){response.selection=collisionSelection(contract,response.selection,e.collider);const {inputs,slots,preset,...base}=e.visual;await qualifyBinding({...base,...response.selection});}
      if(world!==owner||JSON.stringify(owner.getEntity(targetId))!==JSON.stringify(e))return;
      result=interactObject(owner,actorId,address,movement,interactions,targetId);
      if(!result.ok){$("interactionStatus").textContent=result.reason;return;}
      if(response){owner.setEntityAppearance(targetId,response.selection);syncCollider();syncObjectLight();syncAppearance();}
    }
    showEvents(result.events);
    if(response)$("interactionStatus").textContent+="; visual use applied"+(response.events.length?": "+response.events.map(x=>x.name).join(", "):"");
  }catch(e){$("interactionStatus").textContent=e.message;}
  finally{if(targetId)usingObjects.delete(targetId);}
}
$("useCell").onclick=()=>useSelected();$("useObject").onclick=()=>{if($("objects").value)useSelected($("objects").value);};
const cutLevel=()=> $("cutaway").value==="all"?null:Number($("cutaway").value);
let cutCenter=null;
const cutOptions=()=>({center:cutCenter,radius:Number($("cutRadius").value)});
const displayedAddress=a=>cutLevel()===null||!cutawayMask(cutLevel(),cutOptions())(a);
function refreshCutaway(){
  dirty=true;visibilityPreview=null;
  if(!displayedAddress(selected)){selected=[selected[0],selected[1],cutLevel()];faceSelect.value="upper";sync();}
  $("cutStatus").textContent=cutCenter?"Centered at "+cutCenter.join(", "):"Global cutaway";
}
$("cutaway").onchange=refreshCutaway;
$("cutRadius").onchange=refreshCutaway;
$("localCut").onclick=()=>{cutCenter=selected.slice(0,2);if(cutLevel()===null)$("cutaway").value="0";refreshCutaway();};
$("globalCut").onclick=()=>{cutCenter=null;refreshCutaway();};
function eye(address){const c=world.get(...address);if(!c||!hasVolume(c.shape))throw Error("Select solid support");const o=physicalPosition(...address,grid);return [o.x,o.y,o.z+sampleSurface(c.shape,grid,0,0)+movement.height_ft*.85];}
$("checkSight").onclick=()=>{try{const actor=world.getEntity($("movingObject").value);if(!actor)throw Error("Select an object");const from=eye(actor.address),to=eye(selected),result=traceVisibility(world,from,to);visibilityPreview={from,to,result};$("sightStatus").textContent=result.status+(result.address?" at "+result.address.join(", "):"");}catch(e){$("sightStatus").textContent=e.message;visibilityPreview=null;}};
function syncMovement(){
  const menu=$("movingObject"),old=menu.value,items=world.entities();
  if([...menu.options].map(o=>o.value).join("|")!==items.map(e=>e.id).join("|")){menu.replaceChildren(...items.map(e=>new Option(e.id,e.id)));if(items.some(e=>e.id===old))menu.value=old;}
  $("previewRoute").disabled=$("moveObject").disabled=!items.length;routePreview=null;visibilityPreview=null;$("sightStatus").textContent="";$("routeStatus").textContent="";
}
$("movingObject").onchange=()=>{routePreview=null;$("routeStatus").textContent="";};
function routeAction(commit){try{
  const id=$("movingObject").value,result=commit?moveObject(world,id,[...selected],movement,{interactions,presentation:true}):planObjectMove(world,id,[...selected],movement);
  if(commit&&result.ok){
    const points=result.points;showEvents(result.events);
    if($("animateWalk").checked&&points.length>1)playback.set(id,{points,path:result.path,stamp:routeGeometryStamp(world,result.path,movement),started:clock.visual});else playback.delete(id);
    syncConstruction();
  }
  routePreview=commit?null:result.ok?{...result,points:routeWaypoints(world,result.path,movement,{exclude:[id]})}:result;$("routeStatus").textContent=result.ok?(commit?"Moved: ":"Route: ")+(result.path.length-1)+" steps":result.reason;
}catch(e){$("routeStatus").textContent=e.message;routePreview=null;}}
$("previewRoute").onclick=()=>routeAction(false);$("moveObject").onclick=()=>routeAction(true);
function downloadJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function registerPrefab(p){if(prefabCatalog.some(x=>x.id===p.id))throw Error("Prefab ID already exists");prefabCatalog.push(p);prefabSelect.add(new Option(p.name,p.id));prefabSelect.value=p.id;syncConstruction();}
$("captureCell").onclick=()=>{const c=world.get(...selected);if(!c||!hasVolume(c.shape)){$("message").textContent="Select a solid cell";return;}const k=selected.join(",");if(capture.has(k))capture.delete(k);else{if(!capture.size)captureAnchor=[...selected];capture.set(k,[...selected]);}if(!capture.size)captureAnchor=null;syncConstruction();};
$("clearCapture").onclick=()=>{capture.clear();captureAnchor=null;syncConstruction();};
$("exportPrefab").onclick=()=>{try{const p=capturePrefab(world,[...capture.values()],captureAnchor,{id:crypto.randomUUID(),name:$("prefabName").value.trim()||"Custom construction"});registerPrefab(p);downloadJSON(p,"hex-prefab.json");$("message").textContent="Prefab captured and exported";}catch(e){$("message").textContent=e.message;}};
$("importPrefab").onchange=async()=>{try{const f=$("importPrefab").files[0];if(!f)return;if(f.size>2e6)throw Error("Prefab exceeds 2 MB");registerPrefab(validatePrefab(JSON.parse(await f.text())));$("message").textContent="Prefab imported";}catch(e){$("message").textContent=e.message;}finally{$("importPrefab").value="";}};
function syncConstruction(){
  $("captureCount").textContent=capture.size+" selected cells";$("exportPrefab").disabled=!capture.size;
  try{const {plan}=prefabPlan(),inDomain=new Set(domain.map(a=>a.join(","))),outside=plan.edits.some(e=>!inDomain.has(e.address.join(",")));
    preview=plan;$("prefabStatus").textContent=outside?"Outside active editor region":plan.conflicts.length?"Blocked: "+plan.conflicts[0].reason:plan.edits.length+" cells ready";
    $("placePrefab").disabled=outside||plan.conflicts.length>0;
  }catch(e){preview=null;$("prefabStatus").textContent=e.message;$("placePrefab").disabled=true;}
  const menu=$("objects"),old=menu.value,items=world.entities().filter(e=>e.address.every((v,i)=>v===selected[i]));
  menu.replaceChildren(...items.map(e=>new Option(e.visual.asset+" · "+e.id,e.id)));if(items.some(e=>e.id===old))menu.value=old;
  $("removeObject").disabled=$("setObjectTags").disabled=$("useObject").disabled=$("rotateObject").disabled=!items.length;
  $("objectOrientation").textContent=items.length?((world.getEntity(menu.value)?.orientation_steps??0)*60)+"°":"No object";
  $("objectTags").value=world.getEntity(menu.value)?.interaction_tags?.join(", ")??"";
  syncCollider();syncObjectLight();syncAppearance();syncMovement();
}
for(const key of ["prefab","prefabRotation","prefabOffset"])$(key).onchange=syncConstruction;
$("placePrefab").onclick=()=>{try{const {p,anchor,turns}=prefabPlan();if($("placePrefab").disabled)return;placePrefab(world,p,anchor,turns);dirty=true;sync();$("message").textContent=p.name+" placed";}catch(e){$("message").textContent=e.message;}};
$("objects").onchange=()=>{const e=world.getEntity($("objects").value);$("objectTags").value=e?.interaction_tags?.join(", ")??"";$("objectOrientation").textContent=e?((e.orientation_steps??0)*60)+"°":"No object";syncCollider();syncObjectLight();syncAppearance();};
function syncObjectLight(){
  const e=world.getEntity($("objects").value),l=e?.light;
  $("applyObjectLight").disabled=!e;$("removeObjectLight").disabled=!e||!l;
  $("objectLightColor").value="#"+(l?.color??[1,.48,.16]).map(v=>Math.round(v*255).toString(16).padStart(2,"0")).join("");
  for(const [id,key,fallback] of [["objectLightRadius","radius_ft",12],["objectLightIntensity","intensity",1],["objectLightOffset","offset_z_ft",2],["objectLightFlicker","flicker",.15],["objectEmissive","emissive",.7]])$(id).value=l?.[key]??fallback;
  $("objectLightStatus").textContent=l?"Light attached":"No attached light";
}
$("applyObjectLight").onclick=()=>{try{
  const color=$("objectLightColor").value.slice(1).match(/../g).map(v=>parseInt(v,16)/255);
  world.setEntityLight($("objects").value,validateLightSource({color,radius_ft:Number($("objectLightRadius").value),intensity:Number($("objectLightIntensity").value),offset_z_ft:Number($("objectLightOffset").value),flicker:Number($("objectLightFlicker").value),emissive:Number($("objectEmissive").value)}));syncObjectLight();
}catch(e){$("objectLightStatus").textContent=e.message;}};
$("removeObjectLight").onclick=()=>{try{world.setEntityLight($("objects").value,null);syncObjectLight();}catch(e){$("objectLightStatus").textContent=e.message;}};
function syncCollider(){
  const e=world.getEntity($("objects").value),c=e?.collider,d=c?.disabled_when;
  $("applyCollider").disabled=!e;$("colliderRadius").value=c?.radius_ft??0;$("colliderHeight").value=c?.height_ft??4;
  $("colliderInput").value=d?.input??"";$("colliderEquals").value=d?JSON.stringify(d.equals):"true";
  $("colliderActive").textContent=c?(colliderActive(e)?"Blocking":"Disabled by input"):"No collider";
}
$("applyCollider").onclick=async()=>{
  const id=$("objects").value,owner=world,e=world.getEntity(id);if(!e)return;
  const request=++appearanceRequest;
  try{
    const r=Number($("colliderRadius").value),h=Number($("colliderHeight").value),input=$("colliderInput").value.trim();
    const c=r===0?null:validateCollider({kind:"cylinder",radius_ft:r,height_ft:h,...(input?{disabled_when:{input,equals:JSON.parse($("colliderEquals").value)}}:{})});
    let selection=null;
    if(c?.disabled_when){
      const {next}=await qualifyBinding(e.visual);selection=collisionSelection(next.contract,visualSelection(e.visual),c);
      const {inputs,slots,preset,...base}=e.visual;await qualifyBinding({...base,...selection});
    }
    if(request!==appearanceRequest||world!==owner||JSON.stringify(owner.getEntity(id))!==JSON.stringify(e))return;
    world.setEntityCollider(id,c,selection);syncConstruction();$("colliderStatus").textContent=r===0?"Collider removed":"Collider applied";
  }catch(err){if(request===appearanceRequest)$("colliderStatus").textContent=err.message;}
};
$("rotateObject").onclick=()=>{const e=world.getEntity($("objects").value);if(e){world.setEntityOrientation(e.id,((e.orientation_steps??0)+1)%6);syncConstruction();}};
$("removeObject").onclick=()=>{playback.delete($("objects").value);world.removeEntity($("objects").value);syncConstruction();};

// Temporary transparent vertical artwork, not an Atlas release.
const tufts=new Map(catalog.vegetation.variants.map(v=>{
  const c=document.createElement("canvas");c.width=c.height=64;const g=c.getContext("2d");
  for(let i=0;i<13;i++){const t=stableUnit(v.id,[i],"blade"),x=12+40*t,top=8+35*stableUnit(v.id,[i],"height");g.fillStyle="rgb("+v.color.map(n=>Math.round(n*255*(.7+t*.4))).join(",")+")";g.beginPath();g.moveTo(30+i%4,62);g.quadraticCurveTo(x,35,x,top);g.quadraticCurveTo(x+6,38,34+i%4,62);g.fill();}
  return [v.id,c];
}));
async function qualifyBinding(raw){
  const binding=spriteBinding(raw),views=binding.views?Array.from({length:6},(_,i)=>directionalBinding(binding,i)):[directionalBinding(binding,0)];
  const unique=new Map(views.map(v=>[v.asset,v]));
  for(const v of unique.values()){
    const states=[...new Set([v.walk_state,...(v.wind?.states??[]).map(w=>w.state)].filter(Boolean))];
    const base=requestSprite({...v,...(binding.views&&v.state!==null?{requireState:true}:{})});
    if(!await base.promise)throw Error(base.error);
    for(const state of states){const alternate=requestSprite({...v,state,requireState:true});if(!await alternate.promise)throw Error(alternate.error);}
  }
  const next=await requestSprite(views[0]).promise;if(!next)throw Error("Sprite unavailable");
  return {binding,next};
}
async function loadBinding(raw){
  const request=++spriteRequest;$("assetStatus").textContent="Loading sprite";
  try{const resolved=await resolveAtlasBinding(raw),{binding,next}=await qualifyBinding(resolved.binding);if(request!==spriteRequest)return;actor=next;activeBinding=binding;$("assetStatus").textContent="Atlas sprite loaded";$("spatialStatus").textContent=resolved.warnings.join("; ")||("Height "+binding.height_ft+" ft · "+(binding.views?"6 views":"billboard")+(binding.wind?" · wind-responsive":""));}
  catch(e){if(request===spriteRequest){actor=null;$("assetStatus").textContent=e.message;$("spatialStatus").textContent="";}}
}
let appearanceRequest=0,appearanceKey=null,inspectRequest=0;
function syncAppearance(){
  const e=world.getEntity($("objects").value),key=e?e.id+":"+visualKey(e.visual):null;
  $("applyAppearance").disabled=$("inspectAppearance").disabled=!e;
  if(key===appearanceKey)return;
  appearanceKey=key;inspectRequest++;$("objectAppearance").value=JSON.stringify(e?visualSelection(e.visual):{},null,2);$("appearanceControls").replaceChildren();
  if(e)inspectAppearance(e);
}
async function inspectAppearance(e=world.getEntity($("objects").value)){
  if(!e)return;const request=++inspectRequest,owner=world;
  try{
    const {next}=await qualifyBinding(e.visual);
    if(request!==inspectRequest||world!==owner||$("objects").value!==e.id)return;
    drawAppearanceControls(next.contract,visualSelection(e.visual));
  }catch(err){if(request===inspectRequest)$("appearanceStatus").textContent=err.message;}
}
function drawAppearanceControls(contract,selection){
  const host=$("appearanceControls");host.replaceChildren();
  const options=appearanceOptions(contract,selection);if(!options)return;
  const edit=(patch)=>{const next=visualSelection({...selection,...patch});$("objectAppearance").value=JSON.stringify(next,null,2);drawAppearanceControls(contract,next);};
  const field=(name,el)=>{const label=document.createElement("label");label.append(name+" ",el);host.append(label);};
  if(Object.keys(contract.presets).length){const el=document.createElement("select");el.id="generatedPreset";el.add(new Option("Default",""));for(const k of Object.keys(contract.presets))el.add(new Option(k,k));el.value=selection.preset??"";el.onchange=()=>edit({preset:el.value||null,inputs:{},slots:{}});field("Preset",el);}
  for(const [key,def] of Object.entries(contract.inputs)){
    let el;if(def.type==="enum"){el=document.createElement("select");for(const v of def.values)el.add(new Option(v,v));el.value=options.inputs[key];}
    else{el=document.createElement("input");el.type=def.type==="boolean"?"checkbox":"number";if(def.type==="boolean")el.checked=options.inputs[key];else{el.value=options.inputs[key];if(def.min!==undefined)el.min=def.min;if(def.max!==undefined)el.max=def.max;el.step=def.step??"any";}}
    el.dataset.visualInput=key;el.onchange=()=>edit({inputs:{...selection.inputs,[key]:def.type==="boolean"?el.checked:def.type==="number"?Number(el.value):el.value}});field(key,el);
  }
  for(const [key,slot] of Object.entries(contract.slots)){
    const el=document.createElement("select");el.dataset.visualSlot=key;for(const v of slot.options)el.add(new Option(v,v));el.value=options.slots[key];el.onchange=()=>edit({slots:{...selection.slots,[key]:el.value}});field(key,el);
  }
  const info=document.createElement("p");info.textContent=contract.behavior?.on?.use?"Supports reach-checked world use":"No authored world-use event";host.append(info);
}
$("inspectAppearance").onclick=()=>inspectAppearance();
let catalogEntries=[],catalogMatches=[],catalogRequest=0;
function refreshCatalog(){
  catalogMatches=searchCatalog(catalogEntries,$("catalogSearch").value,$("catalogCapability").value,$("catalogComponents").checked);
  const menu=$("catalogAssets");menu.replaceChildren(...catalogMatches.map((a,i)=>new Option(a.name+" · "+a.domain+" · "+a.license,String(i))));
  $("catalogStatus").textContent=catalogMatches.length+" shown (maximum 200); actual archive validated on load";$("loadCatalogAsset").disabled=!catalogMatches.length;
}
$("refreshCatalog").onclick=async()=>{
  const request=++catalogRequest;$("catalogStatus").textContent="Loading Atlas catalog";
  try{const entries=await fetchCatalog($("catalogURL").value);if(request!==catalogRequest)return;catalogEntries=entries;
    const menu=$("catalogCapability");menu.replaceChildren(new Option("All capabilities",""),...[...new Set(entries.flatMap(a=>a.capabilities))].sort().map(k=>new Option(k,k)));refreshCatalog();
  }catch(e){if(request===catalogRequest)$("catalogStatus").textContent=e.message;}
};
for(const k of ["catalogSearch","catalogCapability","catalogComponents"])$(k).oninput=refreshCatalog;
$("loadCatalogAsset").onclick=()=>{const a=catalogMatches[Number($("catalogAssets").value)];if(a){const {height_ft,...source}=a.binding;loadBinding($("overrideCatalogHeight").checked?{...source,height_ft:Number($("objectHeight").value)}:source);}};

$("applyAppearance").onclick=async()=>{
  const id=$("objects").value,e=world.getEntity(id),request=++appearanceRequest,owner=world;if(!e)return;
  try{const text=$("objectAppearance").value; if(text.length>32000)throw Error("Selection too large");
    let selection=visualSelection(JSON.parse(text));const {preset,inputs,slots,...base}=e.visual;
    $("appearanceStatus").textContent="Checking selected views";
    const {next}=await qualifyBinding({...base,...selection});
    if(e.collider?.disabled_when){selection=collisionSelection(next.contract,selection,e.collider);await qualifyBinding({...base,...selection});}
    if(request!==appearanceRequest||world!==owner||JSON.stringify(world.getEntity(id))!==JSON.stringify(e))return;
    world.setEntityAppearance(id,selection);appearanceKey=null;syncCollider();syncObjectLight();syncAppearance();$("appearanceStatus").textContent="Appearance applied";
  }catch(err){if(request===appearanceRequest)$("appearanceStatus").textContent=err.message;}
};
$("loadChest").onclick=()=>loadBinding({manifest:"./examples/chest-fixture/manifest.json",asset:"fixture.chest",height_ft:3,preset:"closed"});
function loadActor(){
  return loadBinding({manifest:$("manifest").value,asset:$("asset").value,state:$("actorState").value,height_ft:Number($("objectHeight").value),...(Number($("objectWindBend").value)>0||$("objectWindState").value.trim()?{wind:{bend:Number($("objectWindBend").value),reference_speed_ft_s:20,states:$("objectWindState").value.trim()?[{min_speed_ft_s:8,state:$("objectWindState").value.trim()}]:[]}}:{})});
}
$("importObjectBinding").onchange=async()=>{try{const f=$("importObjectBinding").files[0];if(!f)return;if(f.size>32000)throw Error("Binding exceeds 32 KB");await loadBinding(JSON.parse(await f.text()));}catch(e){$("assetStatus").textContent=e.message;}finally{$("importObjectBinding").value="";}};
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
  const n=base.grid.geometry_subdivisions;grid={...base.grid};
  world=worldMode==="settlement"?buildSettlement(base,prefabCatalog,demoVisual):new World(worldMode==="exploration"?explorationConfig(base):base);
  meshCache=new TerrainFaceCache(world);playback.clear();showEvents([]);selected=worldMode==="settlement"?[...settlementStart]:[0,0,0];faceSelect.value="upper";clock=new Clock(base.simulation);$("mode").value=base.simulation.mode;capture.clear();captureAnchor=null;regionKey="";cameraKey="";$("cutaway").value="all";cutCenter=null;$("cutStatus").textContent="Global cutaway";
  if(worldMode==="exploration"){yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;refreshRegion(true);}
  else if(worldMode==="settlement"){ground=settlementGround;domain=settlementDomain;activeChunks=0;yaw=0;scale=16;panX=0;panY=65;$("zoom").value=16;}
  else{ground=island;domain=islandDomain;activeChunks=0;for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)world.defineChunk(q,r,z);for(const [q,r] of ground)for(const z of [-1,0])world.set(q,r,z,withSurface({material:"soil",shape:uniformShape(n)}, {growth:z===0?.65:0}));}
  if(worldMode!=="settlement")placeObject(world,{id:"demo-actor",address:[0,0,0],anchor:"surface",visual:demoVisual});
  $("worldMode").value=worldMode;dirty=true;syncWind();syncClimate();syncLighting();sync();
}
$("worldMode").onchange=()=>{const next=$("worldMode").value;if(next===worldMode)return;if(!confirm("Start a new world? Export your current world first if you want to keep it.")){$("worldMode").value=worldMode;return;}worldMode=next;reset();};
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
  $("cellTags").value=c.components?.interaction_tags?.join(", ")??"";
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
$("extinguish").onclick=()=>{const c=world.get(...selected);if(hasVolume(c.shape))modifySurface(s=>({...s,burn:0}));for(const e of world.effects())if(e.address.every((v,i)=>v===selected[i]))world.removeEffect(e.id);};
function simulate(seconds){if(seconds<=0)return;const edits=[];for(const address of world.burningAddresses()){const c=world.get(...address),s=c.components?.surface;if(s?.burn>0)edits.push({address,value:withSurface(c,advanceSurface(s,seconds,catalog.vegetation.burn_seconds))});}if(edits.length){world.apply(edits);dirty=true;sync();}}

reset();
$("level").onchange=()=>{const z=Number($("level").value);if(!displayedAddress([0,0,z])){$("cutaway").value="all";dirty=true;}selected=[selected[0],selected[1],z];sync();};
loadActor();
let artRequest=0;
const fixtureStyle="./examples/meadow-style.json";
async function loadArt(reference){
  const request=++artRequest;$("artStatus").textContent="Loading art profile";
  try{const next=await fetchStyle(reference,catalog);
    if(request!==artRequest)return;
    gpu.setTerrainStyle(next);art=next;scatterDirty=true;syncLighting();
    $("artStatus").textContent=next.profile.id==="fantasy-meadow-fixture"?"Atlas meadow fixture loaded":"Atlas art loaded: "+next.profile.id;
    $("scatterStatus").textContent=next.scatter.size+" decorative families"+(next.scatterWarnings.length?"; "+next.scatterWarnings.join("; "):"");
  }catch(e){if(request===artRequest)$("artStatus").textContent=(art?"Previous style retained: ":"Procedural fallback: ")+e.message;}
}
$("loadArt").onclick=()=>loadArt($("artURL").value.trim());
$("resetArt").onclick=()=>{$("artURL").value=fixtureStyle;loadArt(fixtureStyle);};
$("promoteScatter").onclick=()=>{try{if(dirty||scatterDirty)throw Error("Wait for terrain refresh");const sample=scatterChoices.find(s=>s.key===$("scatterChoice").value&&s.address.every((v,i)=>v===selected[i]));if(!sample||!art)throw Error("Select a decorative sample");promoteSample(world,art,sample,crypto.randomUUID());dirty=true;sync();$("message").textContent="Decoration promoted to persistent object";}catch(e){$("message").textContent=e.message;}};
loadArt(fixtureStyle);
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
$("reset").onclick=()=>{if(worldMode!=="island"&&!confirm("Reset world and discard edits?"))return;reset();};
$("surface").onchange=sync;$("vertex").onchange=sync;$("connected").onchange=sync;$("height").oninput=()=>move(Number($("height").value));
const presets={Full:[1,1,1,1,1,1,1],Half:[.5,.5,.5,.5,.5,.5,.5],Slope:[1,1,.5,0,0,.5,.5],Corner:[1,0,1,1,1,1,1],Peak:[0,0,0,0,0,0,1],Basin:[1,1,1,1,1,1,0],Empty:[0,0,0,0,0,0,0]};
for(const [name,h] of Object.entries(presets)){const b=document.createElement("button");b.textContent=name;b.title="Replace selected cell only";b.onclick=()=>set({lower:Array(7).fill(0),upper:h.map(v=>Math.round(v*grid.geometry_subdivisions))});$("presets").append(b);}
const ceiling=document.createElement("button");ceiling.textContent="Raised slab";ceiling.onclick=()=>set(uniformShape(grid.geometry_subdivisions,grid.geometry_subdivisions/2));$("presets").append(ceiling);
$("save").onclick=()=>{world.setClockState(clock.snapshot());downloadJSON(world.snapshot(),"hex-world.json");};
$("load").onchange=async()=>{try{
  const file=$("load").files[0];if(!file)return;if(file.size>25e6)throw Error("Lab import limit 25 MB");
  const next=World.restore(JSON.parse(await file.text())),g=next.config.grid,cfg=next.config,generated=cfg.generation?.profile===EXPLORATION_PROFILE,settlement=cfg.scene===SETTLEMENT;
  if(g.horizontal_ft!==base.grid.horizontal_ft||g.vertical_ft!==base.grid.vertical_ft||g.geometry_subdivisions!==2||g.chunk_size.some((n,i)=>n!==base.grid.chunk_size[i])||(!generated&&(cfg.generation||!((settlement?settlementDomain:islandDomain).every(a=>next.get(...a))))))throw Error("Unsupported laboratory world profile");
  if(generated){if(typeof cfg.generation.seed!=="string"||!cfg.generation.seed)throw Error("Invalid generation seed");loadViewport(next,viewportBounds({yaw:0,scale:24,width:canvas.width,height:canvas.height,panX:0,panY:50},g,undefined,120));}
  world=next;meshCache=new TerrainFaceCache(world);grid=g;worldMode=generated?"exploration":settlement?"settlement":"island";playback.clear();showEvents([]);$("cutaway").value="all";cutCenter=null;$("cutStatus").textContent="Global cutaway";selected=[0,0,0];faceSelect.value="upper";dirty=true;clock=next.clockState?Clock.restore(next.clockState):new Clock(cfg.simulation);$("mode").value=clock.snapshot().mode;capture.clear();captureAnchor=null;regionKey="";cameraKey="";
  yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;$("worldMode").value=worldMode;
  if(generated)refreshRegion(true);else{ground=settlement?settlementGround:island;domain=settlement?settlementDomain:islandDomain;activeChunks=0;}
  syncWind();syncClimate();syncLighting();sync();$("message").textContent="World imported";
}catch(e){$("message").textContent=e.message;}finally{$("load").value="";}};
$("mode").onchange=()=>clock.configure($("mode").value);$("step").onclick=()=>{const before=clock.simulation;clock.advance(6);simulate(clock.simulation-before);};function addFire(definition){world.putEffect({id:crypto.randomUUID(),kind:"fire",address:[...selected],instance:effect(definition,clock.simulation)});}
$("fire").onclick=()=>addFire({behavior:"persistent"});$("timed").onclick=()=>addFire({behavior:"timed",duration:5});$("rotate").onclick=()=>yaw=(yaw+1)%6;$("zoom").oninput=()=>scale=Number($("zoom").value);
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
  if(dirty){scatterDirty=true;const level=cutLevel(),renderWorld=level===null?world:cutawayView(world,level,cutOptions());faces=decorateTerrain(renderWorld,level===null?domain:domain.filter(displayedAddress),catalog,{enabled:$("transitions").checked,...(level===null?{cache:meshCache}:{})});if($("ambientOcclusion").checked)faces=terrainOcclusion(world,faces);dirty=false;for(const [id,motion] of playback)if(motion.stamp!==routeGeometryStamp(world,motion.path,movement))playback.delete(id);contactByCell=new Map();}
  if(lastCollisionRevision!==world.collisionRevision){lastCollisionRevision=world.collisionRevision;for(const [id,motion] of playback)if(motion.stamp!==routeGeometryStamp(world,motion.path,movement))playback.delete(id);}
  const sprites=[],seed=world.config.id,styled=art&&$("artStyle").checked,poses=new Map(),contacts=[];
  for(const [id,motion] of playback){const pose=sampleRoute(motion.points,(clock.visual-motion.started)*10);if(pose.done){playback.delete(id);continue;}poses.set(id,pose);contacts.push({id,point:pose.point});}
  let bent=0,windBent=0,animatedFoliage=0,seasonalFoliage=0;const field=world.environment,windEnabled=$("windVisual").checked,windCache=new Map(),climateCache=new Map(),updated=new Set();
  function climateFor(address){const k=address.join(",");if(!climateCache.has(k))climateCache.set(k,climateAt(field,address));return climateCache.get(k);}
  function windFor(address){if(!windEnabled)return CALM;const key=address.join(",");if(!windCache.has(key))windCache.set(key,windAt(field,address));return windCache.get(key);}
  function flex(points,root,height,response,exclude=null,wind=CALM,capability=null){
    const contact=$("brushContact").checked&&contacts.length?bendBillboard(points,root,height,contacts,response,exclude):points;
    if(contact!==points)bent++;
    const offset=windOffset(capability,sampleWind(wind,root,clock.visual),height);
    if(Math.hypot(...offset)>1e-8)windBent++;
    return composeBend(points,contact,offset,height);
  }
  function animateRaster(r){if(r.animated&&!updated.has(r)){updated.add(r);r.update(clock.visual*1000).catch(e=>{$("artStatus").textContent="Animation error: "+e.message;});}}

  function cellContact(address){const k=address.join(",");if(!contactByCell.has(k))contactByCell.set(k,contactResponse(interactions,cellTarget(address,world.get(...address))));return contactByCell.get(k);}

  const visible=faces.filter(f=>visibleTriangle(f,view,canvas.width,canvas.height,scale*5));
  const shadowObjects=[];let scatterInstances=0;
  if(scatterDirty){
    scatterDirty=false;scatterPlan=[];
    try{if(art?.scatter.size){scatterPlan=buildScatterPlan(world,domain,art.profile,{cache:meshCache});$("scatterStatus").textContent=art.scatter.size+" decorative families"+(art.scatterWarnings.length?"; "+art.scatterWarnings.join("; "):"");}}
    catch(e){$("scatterStatus").textContent=e.message;}
  }
  const choices=styled&&$("scatter").checked?scatterPlan.filter(s=>s.address.every((v,i)=>v===selected[i])&&displayedAddress(s.address)&&scale>s.lod_px):[];
  const choiceKey=JSON.stringify(choices.map(s=>s.key));
  if(choiceKey!==scatterChoiceKey){scatterChoiceKey=choiceKey;const menu=$("scatterChoice"),old=menu.value;menu.replaceChildren(...choices.map(s=>new Option(s.family+" / "+s.variant,s.key)));if(choices.some(s=>s.key===old))menu.value=old;}
  scatterChoices=choices;$("promoteScatter").disabled=!choices.length;
  if(styled&&$("scatter").checked)for(const sample of scatterPlan){
    if(scale<=sample.lod_px||!displayedAddress(sample.address))continue;
    const wind=windFor(sample.address),v=scatterRaster(art,sample,wind,climateFor(sample.address).season,yaw);if(!v)continue;
    const {r,height}=v,p=sample.point,w=height*r.pixelWidth/r.pixelHeight,screen=view(p),margin=scale*Math.max(w,height)*2;
    if(screen.x<-margin||screen.x>canvas.width+margin||screen.y<-margin||screen.y>canvas.height+margin)continue;
    animateRaster(r);
    sprites.push({image:r.image,revision:r.revision,points:flex(billboard(p,yaw,w,height,r.pivot),p,height,sample.contact&&contacts.length?cellContact(sample.address):null,null,wind,v.wind)});scatterInstances++;
    if(sample.shadow)shadowObjects.push({address:sample.address,point:p,height,radius:Math.min(grid.horizontal_ft/2,w*.45),opacity:.35});
  }
  if($("vegetation").checked)for(const f of visible){
    if(f.kind!=="top"||f.vegetation<=0)continue;
    if(styled){
      for(const sample of vegetationSamples(f,seed,art.profile,scale)){
        const wind=windFor(f.address),season=climateFor(f.address).season,r=vegetationRaster(art,sample.variant,wind,season);if(!r)continue;animateRaster(r);const seasonal=art.seasonalRasters.get(season)?.get(sample.variant);if(seasonal)seasonalFoliage++;if(r!==(seasonal??art.vegetation.get(sample.variant)))animatedFoliage++;
        sprites.push({image:r.image,revision:r.revision,points:flex(billboard(sample.point,yaw,sample.height*r.pixelWidth/r.pixelHeight,sample.height,r.pivot),sample.point,sample.height,contacts.length?cellContact(f.address):null,null,wind,vegetationWind(art.profile,sample.variant,season))});
      }
    }else if(stableUnit(seed,f.address,"tuft"+f.triangle)<=f.vegetation){
      const p=[0,1,2].map(i=>f.points.reduce((sum,v)=>sum+v[i]/3,0)),h=.55+f.vegetation*1.1;
      sprites.push({image:tufts.get(f.variant),revision:0,points:flex(billboard(p,yaw,h*.9,h),p,h,contacts.length?cellContact(f.address):null,null,windFor(f.address),fixtureWind)});
    }
  }
  let objectInstances=0,unresolvedObjects=0;
  if($("showActor").checked)for(const e of world.entities()){
    const h=anchorHeight(e,world.get(...e.address),grid);if(h===undefined){unresolvedObjects++;continue;}
    const o=physicalPosition(...e.address,grid);let p=[o.x+e.offset_ft[0],o.y+e.offset_ft[1],o.z+h],address=e.address,walking=false;
    const pose=poses.get(e.id);if(pose){p=pose.point;address=pose.address;walking=true;}
    if(!displayedAddress(address))continue;const screen=view(p);
    const margin=scale*e.visual.height_ft*4;if(screen.x<-margin||screen.x>canvas.width+margin||screen.y<-margin||screen.y>canvas.height+margin)continue;
    const viewBinding=directionalBinding(e.visual,yaw,e.orientation_steps??0),wind=windFor(address),state=windState(viewBinding.wind,wind,viewBinding.state),binding=walking&&viewBinding.walk_state?{...viewBinding,state:viewBinding.walk_state,requireState:true}:state===viewBinding.state?viewBinding:{...viewBinding,state,requireState:true};
    const entry=requestSprite(binding),s=entry.sprite??requestSprite(viewBinding).sprite;
    if(!s){unresolvedObjects++;continue;}
    s.update(clock.visual*1000).catch(err=>{entry.error=err.message;entry.sprite=null;});
    sprites.push({image:s.image,revision:s.revision,emissive:e.light?.emissive??0,points:flex(billboard(p,yaw,s.width,s.height,s.pivot),p,s.height,contacts.length?contactResponse(interactions,entityTarget(e)):null,e.id,wind,e.visual.wind)});objectInstances++;
    if(e.anchor==="surface"&&Math.abs(e.offset_ft[2])<1e-8)shadowObjects.push({address,point:p,height:s.height,radius:Math.min(grid.horizontal_ft/2,s.width*.45),opacity:.48});
  }
  const light=field.lighting??(styled?art.profile.lighting:null),shadows=$("contactShadows").checked?contactShadows(visible,shadowObjects):[];
  const sun=light&&$("directionalShadows").checked?directionalShadows(visible,shadowObjects,light,grid):{faces:[],truncated:false};
  const local=$("pointLights").checked?selectPointLights(collectPointLights(world,{simulationTime:clock.simulation,visualTime:clock.visual,poses,displayed:displayedAddress}),visible,sprites):{lights:[],omitted:0};
  gpu.render(visible,view,{pointLights:local.lights,selected,pattern:$("pattern").checked,sprites,transitions:catalog.transitions,debug:$("transitionDebug").checked,style:styled?art.profile:null,lighting:light,softSprites:$("softSprites").checked,shadows:[...shadows,...sun.faces]});
  if($("wire").checked){
    for(const a of domain){if(a[2]!==selected[2])continue;const p=projectLocal(a,[0,0,0]);if(p.x<-scale*5||p.x>canvas.width+scale*5||p.y<-scale*5||p.y>canvas.height+scale*5||hasVolume(world.get(...a).shape))continue;polygon(vertices(uniformShape(0),grid).upper.slice(0,6).map(p=>projectLocal(a,p)),null,"#344b56");}

  }
  function drawFire(a){if(!displayedAddress(a))return;const s=world.get(...a).shape,p=projectLocal(a,[0,0,sampleSurface(s,grid,0,0)]);for(let i=0;i<5;i++){ctx.fillStyle=i%2?"#ffcf69":"#ec783c";ctx.beginPath();ctx.ellipse(p.x+i*8-16,p.y-15,7,17+7*Math.sin(clock.visual*9+i),0,0,Math.PI*2);ctx.fill();}}
  const activeEffects=world.effects().filter(e=>effectActive(e.instance,clock.simulation));
  for(const e of activeEffects)drawFire(e.address);
  for(const a of world.burningAddresses())drawFire(a);
  if(routePreview?.ok){ctx.beginPath();let pen=false;for(const waypoint of routePreview.points){if(!displayedAddress(waypoint.address)){pen=false;continue;}const p=view(waypoint.point);if(pen)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);pen=true;}ctx.strokeStyle="#64e3dc";ctx.lineWidth=3;ctx.stroke();ctx.lineWidth=1;}
  if(visibilityPreview){const {from,to,result}=visibilityPreview,a=view(from),b=view(to);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=result.status==="clear"?"#85e4a0":"#f29a85";ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);}
  for(const address of capture.values()){if(!displayedAddress(address))continue;const c=world.get(...address);if(c&&hasVolume(c.shape))polygon(vertices(c.shape,grid).upper.slice(0,6).map(p=>projectLocal(address,p)),null,"#c59df5");}
  if($("previewPrefab").checked&&preview){
    for(const e of preview.edits){const v=vertices(e.value.shape,grid),blocked=preview.conflicts.some(c=>c.address.every((x,i)=>x===e.address[i])),color=blocked?"#f08072":"#88d9ed";
      polygon(v.upper.slice(0,6).map(p=>projectLocal(e.address,p)),null,color);
      polygon(v.lower.slice(0,6).map(p=>projectLocal(e.address,p)),null,color);
    }
  }
  if($("showColliders").checked)try{for(const c of objectVolumes(world)){
    if(!displayedAddress(c.address))continue;
    const ring=z=>Array.from({length:24},(_,i)=>view([c.center[0]+c.radius*Math.cos(i*Math.PI/12),c.center[1]+c.radius*Math.sin(i*Math.PI/12),z]));
    const lower=ring(c.bottom),upper=ring(c.top);polygon(lower,null,"#f2b45c");polygon(upper,null,"#f2b45c");for(let i=0;i<24;i+=6){ctx.beginPath();ctx.moveTo(lower[i].x,lower[i].y);ctx.lineTo(upper[i].x,upper[i].y);ctx.strokeStyle="#f2b45c";ctx.stroke();}
  }}catch(e){$("colliderStatus").textContent=e.message;}
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
  $("status").textContent=JSON.stringify({grid,selected,face:activeFace(),vertex:activeRef(),handles:handles.map(({layer,index,x,y})=>({layer,index,x,y})),cell:world.get(...selected),world_mode:worldMode,cutaway:cutLevel(),cutaway_center:cutCenter,moving_presentations:playback.size,bent_sprites:bent,wind_bent_sprites:windBent,wind_state_sprites:animatedFoliage,seasonal_sprites:seasonalFoliage,selected_climate:climateAt(field,selected),wind_zones:field.zones.length,selected_wind:windAt(field,selected),interaction_events:interactionEvents,interaction_rules:interactions.rules.length,resident_chunks:world.chunkCount,active_chunks:activeChunks,active_cells:domain.length,mesh_cache_entries:meshCache.size,mesh_triangles:faces.length,visible_triangles:visible.length,vegetation_instances:sprites.length-objectInstances-scatterInstances,scatter_instances:scatterInstances,ambient_occlusion_faces:visible.filter(f=>f.occlusion?.some(v=>v>0)).length,directional_shadow_faces:sun.faces.length,shadow_budget_reached:sun.truncated,point_lights:local.lights.length,point_lights_omitted:local.omitted,lighting:light,scatter_candidates:scatterPlan.length,scatter_families:styled?art.scatter.size:0,object_instances:objectInstances,world_objects:world.entityCount,selected_object_view:(()=>{const e=world.getEntity($("objects").value);return e?directionalBinding(e.visual,yaw,e.orientation_steps??0).asset:null;})(),route_steps:routePreview?.ok?routePreview.path.length-1:null,unresolved_objects:unresolvedObjects,art_style:styled?art.profile.id:null,transitions:$("transitions").checked,transition_triangles:faces.filter(f=>f.attributes&&f.kind==="top").length,camera:{yaw,scale,panX,panY},renderer:"WebGL2",atlas_sprite:!!actor,simulation_seconds:clock.simulation.toFixed(2),visual_seconds:clock.visual.toFixed(2),effect:activeEffects.at(-1)?.instance.behavior??"none",active:activeEffects.length>0,world_effects:world.effects().length,active_effects:activeEffects.length,capture_cells:capture.size},null,2);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
