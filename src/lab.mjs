import {World,Clock,effect,effectActive,physicalPosition} from "./core.mjs";
import {vertices,uniformShape,sampleSurface,hasVolume} from "./geometry.mjs";
import {surfaceColumn,planSurfaceSculpt} from "./surface-sculpt.mjs";
import {planVertexEdit,vertexLimits,TerrainFaceCache} from "./terrain.mjs";
import {buildWaterSurfaces,stepWater,waterTicks} from "./water.mjs";
import {decorateTerrain} from "./surface-render.mjs";
import {faceKey,faceHandles,handleKey,handleLabel,nearestHandle,selectionEdges,selectionBrush,mergeSelection,CellEditHistory,makeEditPlan,inspectEditPlan,applyEditPlan,cellShape,cellMaterial,cellWater,hexStroke,exportBuildContext} from "./editor.mjs";
import {entityOccupancy,planObjectPlacement,planGrove,planGrade,planPath,planWoodlandClearing,planWeatherExposure} from "./builder.mjs";
import {project,pickFace,billboard,visibleTriangle,wrapYaw,turnCamera,sampleTurn,cameraKeys,viewportSize,vertexDragDelta,VERTICAL_PROJECTION} from "./camera.mjs";
import {bindWorkspace} from "./workspace.mjs";
import {bindCatalogView} from "./catalog-view.mjs";
import {bindSceneView} from "./scene-view.mjs";
import {createRenderer} from "./gpu.mjs";
import {FrameSamples} from "./profiling.mjs";
import {createAtlasSprite,createAtlasMask,resolveAtlasBinding,AnimationPhasePool} from "./assets.mjs";
import {ATLAS_CATALOG,fetchCatalog,searchCatalog,catalogBrowseOptions} from "./catalog.mjs";
import {appearanceOptions,dispatchAppearance,collisionSelection} from "./asset-interactions.mjs";
import {fetchStyle,loadStyle,validateStyle,validateStyleVariants,woodlandPreviewStyle,vegetationSamples,vegetationRaster,vegetationWind,scatterRaster} from "./art-style.mjs";
import {LEVELS,EXPLORATION_PROFILE,explorationConfig,viewportBounds,loadViewport} from "./region.mjs";
import {placeObject,anchorHeight,visualKey,spriteBinding,directionalBinding,visualSelection,colliderActive,validateCollider} from "./entities.mjs";
import {validateMovement,planObjectMove,moveObject,interactObject,routeWaypoints,sampleRoute,routeGeometryStamp} from "./navigation.mjs";
import {cutawayView,cutawayMask,traceVisibility} from "./visibility.mjs";
import {SETTLEMENT,settlementGround,settlementDomain,settlementStart,buildSettlement} from "./settlement.mjs";
import {contactShadows,terrainOcclusion,directionalShadows,collectPointLights,selectPointLights,PointShadowCache} from "./lighting.mjs";
import {objectVolumes} from "./collision.mjs";
import {buildScatterPlan,promoteSample} from "./scatter.mjs";
import {CALM,validateWater,DEFAULT_LIGHTING,validateLighting,validateLightSource,validateWindResponse,windAt,climateAt,sampleWind,windState,windOffset,composeBend,precipitationPlan,precipitationParticle} from "./environment.mjs";
import {validateInteractions,interactionTags,cellTarget,entityTarget,contactResponse,bendBillboard} from "./interactions.mjs";
import {validatePrefab,planPrefab,capturePrefab} from "./prefabs.mjs";
import {validateMaterials,surface,ignite,advanceSurface,withSurface,stableUnit,surfaceSubmerged} from "./materials.mjs";
const $=id=>document.getElementById(id),canvas=$("scene"),ctx=canvas.getContext("2d");
const terrainCanvas=$("terrain"),viewport=$("viewport"),gpu=createRenderer(terrainCanvas),workspace=bindWorkspace();
let viewportPending=viewportSize(viewport.clientWidth,viewport.clientHeight);
new ResizeObserver(([entry])=>{viewportPending=viewportSize(entry.contentRect.width,entry.contentRect.height);}).observe(viewport);
function resizeViewport(){if(!viewportPending||drag)return;const {width,height}=viewportPending;viewportPending=null;if(canvas.width===width&&canvas.height===height)return;canvas.width=terrainCanvas.width=width;canvas.height=terrainCanvas.height=height;}
const base=await fetch("./examples/world.json").then(r=>{if(!r.ok)throw Error("World unavailable");return r.json()});
const movement=validateMovement(await fetch("./examples/movement.json").then(r=>{if(!r.ok)throw Error("Movement profile unavailable");return r.json();}));
const defaultInteractions=validateInteractions(await fetch("./examples/interactions.json").then(r=>{if(!r.ok)throw Error("Interactions unavailable");return r.json();}));
let interactions=defaultInteractions;
const catalog=validateMaterials(await fetch("./examples/materials.json").then(r=>{if(!r.ok)throw Error("Materials unavailable");return r.json();}));
let scatterPlan=[],scatterDirty=true,scatterChoices=[],scatterChoiceKey="";
let lastCollisionRevision=-1;
let world,grid,clock=new Clock(base.simulation),yaw=0,last,drag=null,selected=[0,0,0],dirty=true,faces=[],waterSurfaces=[],handles=[],scale=24,panX=0,panY=50,meshCache;
const island=Array.from({length:5},(_,i)=>i-2).flatMap(q=>Array.from({length:5},(_,i)=>i-2).filter(r=>Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r))<=2).map(r=>[q,r,0]));
const islandDomain=island.flatMap(([q,r])=>[-2,-1,0,1,2].map(z=>[q,r,z]));
let ground=island,domain=islandDomain,worldMode="island",regionKey="",cameraKey="",activeChunks=0;
let regionBounds=null,wireCells=new Map(),history=null,stagedPlan=null,gesture=null,waypoints=[];
let renderYaw=0,turn=null,selection=[[0,0,0]],keys=new Set(),visibleCache=null,grassCache=new WeakMap(),shadowCache=null,weatherCache=null;
const pointShadowCache=new PointShadowCache();
function camera(){return {yaw:renderYaw,alignment_deg:Number($("cameraAlignment").value),scale,width:canvas.width,height:canvas.height,panX,panY};}
function refreshRegion(force=false){
  if(worldMode!=="exploration")return;
  const current=JSON.stringify(camera());if(!force&&current===cameraKey)return;cameraKey=current;
  const requested=viewportBounds(camera(),grid,undefined,Math.ceil(scale*5)),size=b=>(b.q[1]-b.q[0]+1)*(b.r[1]-b.r[0]+1)*(b.z[1]-b.z[0]+1);
  if(!force&&regionKey&&regionBounds&&["q","r","z"].every(k=>regionBounds[k][0]<=requested[k][0]&&regionBounds[k][1]>=requested[k][1])&&size(regionBounds)<=size(requested)*2)return;
  const padded={q:[requested.q[0]-2,requested.q[1]+2],r:[requested.r[0]-2,requested.r[1]+2],z:requested.z},bounds=size(padded)<=30000?padded:requested;
  const loaded=loadViewport(world,bounds);regionBounds=bounds;regionKey=JSON.stringify(bounds);domain=loaded.addresses;ground=domain.filter(a=>a[2]===0);activeChunks=loaded.chunks.length;dirty=true;
  if(!force)syncConstruction();
}
const prefabCatalog=(await fetch("./examples/prefabs.json").then(r=>{if(!r.ok)throw Error("Prefabs unavailable");return r.json();})).map(validatePrefab);
let capture=new Map(),captureAnchor=null;
const prefabSelect=$("prefab");for(const p of prefabCatalog)prefabSelect.add(new Option(p.name,p.id));
const demoVisual={manifest:"./examples/atlas-character/manifest.json",asset:"smi.example.robot.states",state:"idle",height_ft:4,walk_state:"walk"};
let actor=null,spriteRequest=0,art=null,activeBinding=demoVisual;
const palette=new Map();let paletteRequest=0;
function refreshPalette(){const host=$("assetPalette");host.replaceChildren();for(const [key,v] of palette){const b=document.createElement("button"),thumb=document.createElement("canvas");b.type="button";b.title=v.binding.asset;thumb.width=48;thumb.height=48;thumb.style.cssText="width:48px;height:48px;vertical-align:middle;border:0";const w=v.image.width,h=v.image.height,s=Math.min(48/w,48/h);thumb.getContext("2d").drawImage(v.image,(48-w*s)/2,(48-h*s)/2,w*s,h*s);b.append(thumb,document.createTextNode(" "+v.binding.asset));b.onclick=()=>loadBinding(v.binding);host.append(b);}}
$("pinAsset").onclick=()=>{if(!actor||$("paintLoadedAsset").disabled)return;paletteRequest++;const key=visualKey(activeBinding);if(!palette.has(key)&&palette.size>=24){$("paletteStatus").textContent="Palette limit 24";return;}palette.set(key,{binding:structuredClone(activeBinding),image:actor.image});refreshPalette();$("paletteStatus").textContent=palette.size+" pinned assets";};
$("clearPalette").onclick=()=>{paletteRequest++;palette.clear();refreshPalette();$("paletteStatus").textContent="Palette cleared";};
$("exportPalette").onclick=()=>downloadJSON([...palette.values()].map(v=>v.binding),"hex-asset-palette.json");
$("importPalette").onchange=async()=>{
  const file=$("importPalette").files[0];$("importPalette").value="";if(!file)return;
  const request=++paletteRequest;
  try{
    if(file.size>512000)throw Error("Palette exceeds 512 KB");
    const raw=JSON.parse(await file.text());
    if(!Array.isArray(raw)||raw.length>24)throw Error("Palette must contain up to 24 sprite bindings");
    const next=new Map();
    for(const source of raw){
      // Keep saved pins/height/state intact; re-qualify actual rasters before commit.
      const {binding,next:raster}=await qualifyBinding(spriteBinding(source));
      if(request!==paletteRequest)return;
      const key=visualKey(binding);if(next.has(key))throw Error("Duplicate palette binding");
      next.set(key,{binding,image:raster.image});
    }
    if(request!==paletteRequest)return;
    palette.clear();for(const [key,value] of next)palette.set(key,value);
    refreshPalette();$("paletteStatus").textContent=palette.size+" imported assets";
  }catch(e){if(request===paletteRequest)$("paletteStatus").textContent="Previous palette retained: "+e.message;}
};
const spriteCache=new Map(),phasePool=new AnimationPhasePool();let phaseFailures=new WeakSet();
function clearAnimationPhases(){phasePool.clear();phaseFailures=new WeakSet();}
function requestSprite(binding,retry=false){
  const key=visualKey(binding)+(binding.requireState?":strict-state":"");
  if(retry&&spriteCache.get(key)?.error)spriteCache.delete(key);
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
let waterReport=null;
function syncWaterMode(){$("simulateWater").checked=world.environment.water_simulation===true;$("waterSimStatus").textContent=$("simulateWater").checked?"Simulation enabled":"Authored water only";waterReport=null;}
$("simulateWater").onchange=()=>{world.setEnvironment({...world.environment,water_simulation:$("simulateWater").checked});syncWaterMode();};
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
$("setCellTags").onclick=()=>{try{const tags=parseTags($("cellTags").value);editSelected(c=>({...c,components:{...c.components,interaction_tags:tags}}),"Cell tags");}catch(e){$("interactionStatus").textContent=e.message;}};
$("setObjectTags").onclick=()=>{try{const e=world.getEntity($("objects").value);if(e)commitObjects([{id:e.id,value:{...e,interaction_tags:parseTags($("objectTags").value)}}],"Object tags");}catch(e){$("interactionStatus").textContent=e.message;}};
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
  if(!displayedAddress(selected)){selected=[selected[0],selected[1],cutLevel()];selection=[[...selected]];faceSelect.value="upper";sync();}
  $("cutStatus").textContent=cutCenter?"Centered at "+cutCenter.join(", "):"Global cutaway";if(selectionMode.value==="surface")sync();
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
$("exportPrefab").onclick=()=>{try{const p=capturePrefab(world,[...capture.values()],captureAnchor,{id:crypto.randomUUID(),name:$("prefabName").value.trim()||"Custom construction",includeObjects:$("captureObjects").checked});registerPrefab(p);downloadJSON(p,"hex-prefab.json");$("message").textContent="Prefab captured and exported";}catch(e){$("message").textContent=e.message;}};
$("importPrefab").onchange=async()=>{try{const f=$("importPrefab").files[0];if(!f)return;if(f.size>2e6)throw Error("Prefab exceeds 2 MB");const p=validatePrefab(JSON.parse(await f.text()));await qualifyObjects((p.objects??[]).map(value=>({value})));registerPrefab(p);$("message").textContent="Prefab imported";}catch(e){$("message").textContent=e.message;}finally{$("importPrefab").value="";}};
const sceneView=bindSceneView(id=>selectSceneObject(id,false),id=>selectSceneObject(id,true));
function selectSceneObject(id,focus){
  const e=world.getEntity(id);if(!e)return;
  if(drag){$("sceneStatus").textContent="Finish the current gesture first";return;}
  const inRegion=domain.some(a=>a.every((v,i)=>v===e.address[i]));
  if(!inRegion&&(!world.config.generation||!LEVELS.includes(e.address[2]))){$("sceneStatus").textContent="Object is outside the active editor region";return;}
  if(!inRegion&&!focus){focus=true;}
  if(!displayedAddress(e.address)){$("sceneStatus").textContent="Object is hidden by the current cutaway";return;}
  if(focus){
    if(!inRegion&&worldMode!=="exploration"){$("sceneStatus").textContent="Object is outside the active editor region";return;}
    const h=anchorHeight(e,world.get(...e.address),grid)??0,o=physicalPosition(...e.address,grid),p=view([o.x+e.offset_ft[0],o.y+e.offset_ft[1],o.z+h]);panX+=canvas.width/2-p.x;panY+=canvas.height/2-p.y;
    if(worldMode==="exploration")refreshRegion(true);
  }
  if(!domain.some(a=>a.every((v,i)=>v===e.address[i]))){$("sceneStatus").textContent="Object remains outside the active editor region";return;}
  $("paintTool").value="select";$("paintTool").dispatchEvent(new Event("change",{bubbles:true}));
  selected=[...e.address];selection=[[...selected]];faceSelect.value="upper";sync();$("objects").value=id;$("objects").dispatchEvent(new Event("change",{bubbles:true}));$("sceneStatus").textContent="Selected "+e.visual.asset;
  if(!focus)workspace.openPanel("assetPanel");
}
function syncConstruction(){
  $("captureCount").textContent=capture.size+" selected cells";$("exportPrefab").disabled=!capture.size;
  try{const {plan}=prefabPlan(),inDomain=new Set(domain.map(a=>a.join(","))),outside=plan.edits.some(e=>!inDomain.has(e.address.join(",")));
    preview=plan;$("prefabStatus").textContent=outside?"Outside active editor region":plan.conflicts.length?"Blocked: "+plan.conflicts[0].reason:plan.edits.length+" cells ready";
    $("placePrefab").disabled=outside||plan.conflicts.length>0;
  }catch(e){preview=null;$("prefabStatus").textContent=e.message;$("placePrefab").disabled=true;}
  const menu=$("objects"),old=menu.value,entities=world.entities(),items=entities.filter(e=>e.address.every((v,i)=>v===selected[i]));
  menu.replaceChildren(...items.map(e=>new Option(e.visual.asset+" · "+e.id,e.id)));if(items.some(e=>e.id===old))menu.value=old;
  $("removeObject").disabled=$("setObjectTags").disabled=$("useObject").disabled=$("rotateObject").disabled=!items.length;
  $("objectOrientation").textContent=items.length?((world.getEntity(menu.value)?.orientation_steps??0)*60)+"°":"No object";
  $("objectTags").value=world.getEntity(menu.value)?.interaction_tags?.join(", ")??"";
  syncCollider();syncObjectLight();syncAppearance();syncMovement();sceneView.sync(world,entities);
}
for(const key of ["prefab","prefabRotation","prefabOffset"])$(key).onchange=syncConstruction;
$("placePrefab").onclick=()=>{try{const {p,plan}=prefabPlan();if($("placePrefab").disabled)return;if(plan.conflicts.length)throw Error("Prefab blocked");if(plan.entities?.length)commitObjects(plan.entities,"Place "+p.name,plan.edits);else commitCells(plan.edits,"Place "+p.name);$("message").textContent=p.name+" placed";}catch(e){$("message").textContent=e.message;}};
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
  const e=world.getEntity($("objects").value);if(!e)return;const light=validateLightSource({color,radius_ft:Number($("objectLightRadius").value),intensity:Number($("objectLightIntensity").value),offset_z_ft:Number($("objectLightOffset").value),flicker:Number($("objectLightFlicker").value),emissive:Number($("objectEmissive").value)});commitObjects([{id:e.id,value:{...e,light}}],"Object light");syncObjectLight();
}catch(e){$("objectLightStatus").textContent=e.message;}};
$("removeObjectLight").onclick=()=>{try{const e=world.getEntity($("objects").value);if(!e)return;const {light,...value}=e;commitObjects([{id:e.id,value}],"Remove light");syncObjectLight();}catch(e){$("objectLightStatus").textContent=e.message;}};
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
    const {collider:previous,...rest}=e,{inputs,slots,preset,...base}=e.visual;commitObjects([{id,value:{...rest,visual:selection===null?e.visual:{...base,...selection},...(c?{collider:c}:{})}}],"Object collider");$("colliderStatus").textContent=r===0?"Collider removed":"Collider applied";
  }catch(err){if(request===appearanceRequest)$("colliderStatus").textContent=err.message;}
};
$("rotateObject").onclick=()=>{const e=world.getEntity($("objects").value);if(e){commitObjects([{id:e.id,value:{...e,orientation_steps:((e.orientation_steps??0)+1)%6}}],"Rotate object");}};
$("removeObject").onclick=()=>{const id=$("objects").value;if(world.getEntity(id))commitObjects([{id,value:null}],"Remove object");};

// Small host-generated weather textures share the existing GPU sprite path.
// They are not published Atlas assets or persistent effects.
const weatherTextures=new Map(["rain","snow","hail"].map(kind=>{
  const c=document.createElement("canvas");c.width=8;c.height=kind==="rain"?32:8;const g=c.getContext("2d");
  g.fillStyle=kind==="rain"?"#b6d8ed":"#f1f6ff";
  if(kind==="rain")g.fillRect(2,1,4,30);else{g.beginPath();g.arc(4,4,3,0,Math.PI*2);g.fill();}
  return [kind,c];
}));
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
    const base=requestSprite({...v,...(binding.views&&v.state!==null?{requireState:true}:{})},true);
    if(!await base.promise)throw Error(base.error);
    for(const state of states){const alternate=requestSprite({...v,state,requireState:true},true);if(!await alternate.promise)throw Error(alternate.error);}
  }
  const next=await requestSprite(views[0],true).promise;if(!next)throw Error("Sprite unavailable");
  return {binding,next};
}
async function loadBinding(raw){
  const request=++spriteRequest;$("assetStatus").textContent="Loading sprite";$("loadedAsset").textContent="Loading "+(raw.asset??"asset")+"…";$("placeActor").disabled=$("paintLoadedAsset").disabled=true;
  try{const resolved=await resolveAtlasBinding(raw),{binding,next}=await qualifyBinding(resolved.binding);if(request!==spriteRequest)return;actor=next;activeBinding=binding;$("loadedAsset").textContent=binding.asset+" · "+binding.height_ft+" ft";$("placeActor").disabled=$("paintLoadedAsset").disabled=false;$("assetStatus").textContent="Atlas sprite loaded";$("spatialStatus").textContent=resolved.warnings.join("; ")||("Height "+binding.height_ft+" ft · "+(binding.views?"6 views":"billboard")+(binding.wind?" · wind-responsive":"")+(next.emissiveMask?" · emissive mask":""));return true;}
  catch(e){if(request===spriteRequest){actor=null;$("loadedAsset").textContent="Asset unavailable: "+e.message;$("placeActor").disabled=$("paintLoadedAsset").disabled=true;$("assetStatus").textContent=e.message;$("spatialStatus").textContent="";}}
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
let catalogEntries=[],catalogMatches=[],catalogRequest=0;const catalogView=bindCatalogView();
const browseMenus={category_path:"catalogCategory",perspective:"catalogPerspective",theme:"catalogTheme",medium:"catalogMedium",family:"catalogFamily"};
function refreshCatalog(){
  const browse=Object.fromEntries(Object.entries(browseMenus).map(([k,id])=>[k,$(id).value]));
  catalogMatches=searchCatalog(catalogEntries,$("catalogSearch").value,$("catalogCapability").value,$("catalogComponents").checked,$("catalogDomain").value,browse);
  const menu=$("catalogAssets"),previous=menu.value;menu.replaceChildren(...catalogMatches.map(a=>new Option(a.name+" · "+a.domain+(a.family?" · "+a.family:"")+" · "+a.license+" · art review: "+a.visual_qa,a.id)));
  if(catalogMatches.some(a=>a.id===previous))menu.value=previous;
  $("catalogStatus").textContent=catalogMatches.length+" shown (maximum 200); actual archive validated on load";$("loadCatalogAsset").disabled=$("loadAndPaint").disabled=!catalogMatches.length;catalogView.update(catalogMatches);
}
$("refreshCatalog").onclick=async()=>{
  const request=++catalogRequest;$("catalogStatus").textContent="Loading Atlas catalog";
  try{const entries=await fetchCatalog($("catalogURL").value);if(request!==catalogRequest)return;catalogEntries=entries;
    const domain=$("catalogDomain"),domains=[...new Set(entries.map(a=>a.domain).filter(Boolean))].sort();domain.replaceChildren(new Option("All domains",""),...domains.map(k=>new Option(k,k)));domain.value=domains.includes("world-environment")?"world-environment":"";
    const menu=$("catalogCapability");menu.replaceChildren(new Option("All capabilities",""),...[...new Set(entries.flatMap(a=>a.capabilities))].sort().map(k=>new Option(k,k)));
    const options=catalogBrowseOptions(entries);
    for(const [key,id] of Object.entries(browseMenus)){const select=$(id),previous=select.value,values=options[key];select.replaceChildren(new Option("All",""),...values.map(v=>new Option(v,v)));select.value=values.includes(previous)?previous:"";select.disabled=!values.length;}
    refreshCatalog();
  }catch(e){if(request===catalogRequest)$("catalogStatus").textContent=e.message;}
};
for(const k of ["catalogSearch","catalogCapability","catalogComponents","catalogDomain",...Object.values(browseMenus)])$(k).oninput=refreshCatalog;
function activateAssetBrush(){
  if(!actor||$("paintLoadedAsset").disabled||drag)return;
  $("usePalette").checked=false;$("objectDensity").value="1";workspace.closeDock();workspace.activateTool("objects");canvas.focus({preventScroll:true});
}
$("paintLoadedAsset").onclick=activateAssetBrush;
async function loadCatalogSelection(paint=false){
  const a=catalogMatches.find(e=>e.id===$("catalogAssets").value);if(!a)return;
  const {height_ft,...source}=a.binding,owner=world,previousTool=$("paintTool").value;
  const loaded=await loadBinding($("overrideCatalogHeight").checked?{...source,height_ft:Number($("objectHeight").value)}:source);
  if(paint&&loaded&&world===owner&&$("paintTool").value===previousTool&&$("catalogAssets").value===a.id&&$("assetDock").getClientRects().length&&$("catalogDock").getClientRects().length)activateAssetBrush();
}
$("loadCatalogAsset").onclick=()=>loadCatalogSelection();
$("loadAndPaint").onclick=()=>loadCatalogSelection(true);

$("applyAppearance").onclick=async()=>{
  const id=$("objects").value,e=world.getEntity(id),request=++appearanceRequest,owner=world;if(!e)return;
  try{const text=$("objectAppearance").value; if(text.length>32000)throw Error("Selection too large");
    let selection=visualSelection(JSON.parse(text));const {preset,inputs,slots,...base}=e.visual;
    $("appearanceStatus").textContent="Checking selected views";
    const {next}=await qualifyBinding({...base,...selection});
    if(e.collider?.disabled_when){selection=collisionSelection(next.contract,selection,e.collider);await qualifyBinding({...base,...selection});}
    if(request!==appearanceRequest||world!==owner||JSON.stringify(world.getEntity(id))!==JSON.stringify(e))return;
    commitObjects([{id,value:{...e,visual:{...base,...selection}}}],"Object appearance");appearanceKey=null;syncCollider();syncObjectLight();syncAppearance();$("appearanceStatus").textContent="Appearance applied";
  }catch(err){if(request===appearanceRequest)$("appearanceStatus").textContent=err.message;}
};
$("loadChest").onclick=()=>loadBinding({manifest:"./examples/chest-fixture/manifest.json",asset:"fixture.chest",height_ft:3,preset:"closed"});
function loadActor(){
  return loadBinding({manifest:$("manifest").value,asset:$("asset").value,state:$("actorState").value,height_ft:Number($("objectHeight").value),...(Number($("objectWindBend").value)>0||$("objectWindState").value.trim()?{wind:{bend:Number($("objectWindBend").value),reference_speed_ft_s:20,states:$("objectWindState").value.trim()?[{min_speed_ft_s:8,state:$("objectWindState").value.trim()}]:[]}}:{})});
}
$("importObjectBinding").onchange=async()=>{try{const f=$("importObjectBinding").files[0];if(!f)return;if(f.size>32000)throw Error("Binding exceeds 32 KB");await loadBinding(JSON.parse(await f.text()));}catch(e){$("assetStatus").textContent=e.message;}finally{$("importObjectBinding").value="";}};
$("loadActor").onclick=loadActor;
$("placeActor").onclick=()=>{try{if(!actor)throw Error("Load a sprite first");const id=crypto.randomUUID();commitObjects([{id,value:{id,address:[...selected],anchor:"surface",visual:activeBinding}}],"Place object");$("objects").value=id;$("objects").dispatchEvent(new Event("change",{bubbles:true}));$("message").textContent="Object placed";}catch(e){$("message").textContent=e.message;}};
const faceSelect=$("surface"),vertexSelect=$("vertex"),selectionMode=$("selectionMode");
const surfaceMode=()=>selectionMode.value==="surface"&&$("paintTool").value==="select"&&cutLevel()===null;
const sculptOptions=()=>({levels:LEVELS,connected:$("connected").checked,whole:$("sculptWhole").checked,allowed:a=>displayedAddress(a)&&domain.some(b=>b.every((v,i)=>v===a[i]))});
let surfaceCache=null,hoverColumn=null;
function currentSurface(){
  const k=selected.slice(0,2).join(",");
  if(surfaceCache?.owner===world&&surfaceCache.rev===world.geometryRevision&&surfaceCache.key===k)return surfaceCache;
  let profile=null,error="";try{profile=surfaceColumn(world,selected,LEVELS);if(!profile)error="No solid surface; use cell mode to create terrain";}catch(e){error=e.message;}
  return surfaceCache={owner:world,rev:world.geometryRevision,key:k,profile,error};
}
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
function selectAddress(a,key,extend=false){try{selection=mergeSelection(selection,selectionBrush(world,a,Number($("brushRadius").value),displayedAddress),extend);selected=selection.find(v=>v.join(",")===a.join(","))??selection.at(-1);selectFace(key);}catch(e){$("message").textContent=e.message;}}
function commitCells(edits,label){if(history.apply(edits,label,gesture))dirty=true;sync();}
function commitObjects(entities,label,edits=[]){const plan=makeEditPlan(world,edits,label,entities);if(applyEditPlan(world,history,plan)){dirty||=edits.length>0;for(const e of entities)playback.delete(e.id);}sync();}
function editSelected(fn,label="Selection edit"){commitCells(selection.map(address=>({address,value:fn(world.get(...address),address)})),label);}
function replayEdit(undo){try{if(drag?.brush||drag?.sculpt)throw Error("Finish or cancel brush stroke first");const label=undo?history.undo():history.redo();if(label){dirty=true;playback.clear();sync();$("historyStatus").textContent=(undo?"Undid ":"Redid ")+label;}}catch(e){$("historyStatus").textContent=e.message;}}
$("undoEdit").onclick=()=>replayEdit(true);$("redoEdit").onclick=()=>replayEdit(false);
function selectFace(key){faceSelect.value=key;sync();}
function selectSurface(address){
  try{const p=surfaceColumn(world,address,LEVELS);if(!p)throw Error("No solid surface");selected=[...p.address];selection=[[...selected]];faceSelect.value="upper";sync();$("sculptStatus").textContent="Drag exposed surface vertices; release to apply; Escape cancels";}catch(e){$("sculptStatus").textContent=e.message;}
}

const get=()=>world.get(...selected).shape;
function reset(){
  clearAnimationPhases();stagedPlan=null;drag=null;gesture=null;waypoints=[];$("planStatus").textContent="";$("pathStatus").textContent="No waypoints";$("applyEditPlan").disabled=true;
  const n=base.grid.geometry_subdivisions;grid={...base.grid};
  world=worldMode==="settlement"?buildSettlement(base,prefabCatalog,demoVisual):new World(worldMode==="exploration"?explorationConfig(base):base);
  history=new CellEditHistory(world);meshCache=new TerrainFaceCache(world);playback.clear();showEvents([]);selected=worldMode==="settlement"?[...settlementStart]:[0,0,0];selection=[[...selected]];turn=null;renderYaw=yaw=0;keys.clear();faceSelect.value="upper";clock=new Clock(base.simulation);$("mode").value=base.simulation.mode;capture.clear();captureAnchor=null;regionKey="";cameraKey="";$("cutaway").value="all";cutCenter=null;$("cutStatus").textContent="Global cutaway";
  if(worldMode==="exploration"){yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;refreshRegion(true);}
  else if(worldMode==="settlement"){ground=settlementGround;domain=settlementDomain;activeChunks=0;yaw=0;scale=16;panX=0;panY=65;$("zoom").value=16;}
  else{ground=island;domain=islandDomain;activeChunks=0;for(let q=-1;q<=0;q++)for(let r=-1;r<=0;r++)for(let z=-1;z<=0;z++)world.defineChunk(q,r,z);for(const [q,r] of ground)for(const z of [-1,0])world.set(q,r,z,withSurface({material:"soil",shape:uniformShape(n)}, {growth:z===0?.65:0}));}
  if(worldMode!=="settlement")placeObject(world,{id:"demo-actor",address:[0,0,0],anchor:"surface",visual:demoVisual});
  $("worldMode").value=worldMode;dirty=true;syncWind();syncClimate();syncLighting();syncWaterMode();sync();
}
$("worldMode").onchange=()=>{const next=$("worldMode").value;if(next===worldMode)return;if(!confirm("Start a new world? Export your current world first if you want to keep it.")){$("worldMode").value=worldMode;return;}worldMode=next;reset();};
function sync(){
  selection=selection.filter(a=>displayedAddress(a));if(!selection.some(a=>a.join(",")===selected.join(",")))selection=[[...selected]];
  $("selectionCount").textContent=selection.length+" selected";$("undoEdit").disabled=!history.canUndo;$("redoEdit").disabled=!history.canRedo;$("historyStatus").textContent=history.counts.undo+" undo · "+history.counts.redo+" redo";$("exportLastPlan").disabled=!history.canUndo;$("level").value=selected[2];refreshVertexOptions();
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
  const water=c.components?.water;$("waterFill").value=water?.fill??0;$("waterFlowX").value=water?.flow_ft_s[0]??0;$("waterFlowY").value=water?.flow_ft_s[1]??0;$("waterFixed").checked=water?.fixed===true;
  $("waterStatus").textContent=water?.fill?((water.fill*grid.vertical_ft).toFixed(2)+" ft above cell base"):"Dry cell";
  const sculpt=surfaceMode(),surfaceSelected=selectionMode.value==="surface"&&$("paintTool").value==="select";faceSelect.disabled=surfaceSelected;slider.disabled||=surfaceSelected;vertexSelect.disabled=surfaceSelected;$("sculptWhole").disabled=!sculpt;
  if(selectionMode.value==="surface"){$("sculptStatus").textContent=sculpt?(currentSurface().error||"Drag exposed surface vertices; release to apply; Escape cancels"):"Surface mode requires Select and full world view";}
  syncConstruction();
}
function move(value,ref=activeRef()){
  const n=grid.geometry_subdivisions;try{const plan=planVertexEdit(world,selected,ref.index,ref.layer,Math.max(0,Math.min(n,Math.round(value))),{connected:$("connected").checked});commitCells(plan.edits,"Vertex edit");$("message").textContent="";}catch(e){$("message").textContent=e.message;}sync();
}
function set(s){const material=$("material").value;editSelected(old=>cellShape(old,s,material),"Terrain preset");}
function updateWater(clear=false){try{const w=clear?null:validateWater({fill:Number($("waterFill").value),flow_ft_s:[Number($("waterFlowX").value),Number($("waterFlowY").value)],fixed:$("waterFixed").checked});editSelected(c=>cellWater(c,w),"Water edit");}catch(e){$("waterStatus").textContent=e.message;}}
$("applyWater").onclick=()=>updateWater();$("drainWater").onclick=()=>updateWater(true);
function modifySurface(fn){editSelected(cell=>hasVolume(cell.shape)?withSurface(cell,fn(surface(cell.components?.surface),cell)):cell);}
for(const k of ["growth","health","moisture","leaves","snow","scorch"]){$(k).oninput=()=>modifySurface(s=>({...s,[k]:Number($(k).value)}));bindGesture($(k));}
$("material").onchange=()=>{const material=$("material").value;editSelected(cell=>cellMaterial(cell,material,catalog.materials[material].vegetation),"Material edit");};
$("reactive").onclick=()=>modifySurface((s,c)=>ignite(catalog,c,grid.geometry_subdivisions));
$("extinguish").onclick=()=>{const c=world.get(...selected);if(hasVolume(c.shape))modifySurface(s=>({...s,burn:0}));for(const e of world.effects())if(e.address.every((v,i)=>v===selected[i]))world.removeEffect(e.id);};
function simulate(seconds){if(seconds<=0)return;let waterChanged=false;
  if(world.environment.water_simulation)try{for(let i=0,n=waterTicks(clock.simulation-seconds,clock.simulation);i<n;i++){const result=stepWater(world);waterChanged||=result.edits.length>0;const {edits,...report}=result;waterReport=report;$("waterSimStatus").textContent=report.unsupported?report.unsupported+" unsupported wet cells held static":"Water transferred: "+report.moved_ft3.toFixed(3)+" ft³";}}catch(e){world.setEnvironment({...world.environment,water_simulation:false});$("simulateWater").checked=false;$("waterSimStatus").textContent=e.message+"; simulation disabled";}
  const edits=[];for(const address of world.burningAddresses()){const c=world.get(...address),s=c.components?.surface;if(s?.burn>0)edits.push({address,value:withSurface(c,surfaceSubmerged(c,grid.geometry_subdivisions)?{...s,burn:0}:advanceSurface(s,seconds,catalog.vegetation.burn_seconds))});}if(edits.length)world.apply(edits);if(edits.length||waterChanged){dirty=true;sync();}}

resizeViewport();reset();
$("level").onchange=()=>{const z=Number($("level").value);if(!displayedAddress([0,0,z])){$("cutaway").value="all";dirty=true;}selected=[selected[0],selected[1],z];selection=[[...selected]];sync();};
loadActor();
let artRequest=0;
const fixtureStyle="./examples/meadow-style.json";
async function loadArt(reference,prepare=()=>fetchStyle(reference,catalog)){
  const request=++artRequest;$("artStatus").textContent="Loading art profile";
  try{const next=await prepare();
    if(request!==artRequest)return;
    gpu.setTerrainStyle(next);clearAnimationPhases();art=next;scatterDirty=true;syncLighting();
    $("artStatus").textContent=next.profile.id==="fantasy-meadow-fixture"?"Atlas meadow fixture loaded":"Atlas art loaded: "+next.profile.id;
    $("scatterStatus").textContent=next.scatter.size+" decorative families"+(next.scatterWarnings.length?"; "+next.scatterWarnings.join("; "):"");
  }catch(e){if(request===artRequest)$("artStatus").textContent=(art?"Previous style retained: ":"Procedural fallback: ")+e.message;}
}
$("loadArt").onclick=()=>loadArt($("artURL").value.trim());
$("loadWoodlandPreview").onclick=()=>loadArt(null,async()=>{
  const url=new URL(fixtureStyle,location.href),response=await fetch(url);
  if(!response.ok)throw Error("Fixture ground style unavailable");
  const [fixture,entries]=await Promise.all([response.json(),fetchCatalog(ATLAS_CATALOG)]);
  return loadStyle(validateStyleVariants(woodlandPreviewStyle(fixture,entries,url.href),catalog));
});
$("exportArt").onclick=()=>{if(art)downloadJSON(art.profile,"hex-art-style.json");};
$("importArt").onchange=()=>{
  const file=$("importArt").files[0];$("importArt").value="";
  if(!file)return;
  loadArt(null,async()=>{
    if(file.size>1e6)throw Error("Style exceeds size limit");
    const profile=validateStyleVariants(validateStyle(JSON.parse(await file.text())),catalog);
    return loadStyle(profile);
  });
};
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
  commitCells(edits,"Surface demonstration");
}
$("transitionDemo").onchange=()=>{const k=$("transitionDemo").value;if(k)demoSurface(k);$("transitionDemo").value="";};
$("reset").onclick=()=>{if(worldMode!=="island"&&!confirm("Reset world and discard edits?"))return;reset();};
selectionMode.onchange=()=>{hoverColumn=null;if(surfaceMode())selectSurface(selected);sync();};
$("paintTool").addEventListener("change",sync);
$("surface").onchange=sync;$("vertex").onchange=sync;$("connected").onchange=sync;$("height").oninput=()=>move(Number($("height").value));bindGesture($("height"));
const presets={Full:[1,1,1,1,1,1,1],Half:[.5,.5,.5,.5,.5,.5,.5],Slope:[1,1,.5,0,0,.5,.5],Corner:[1,0,1,1,1,1,1],Peak:[0,0,0,0,0,0,1],Basin:[1,1,1,1,1,1,0],Empty:[0,0,0,0,0,0,0]};
for(const [name,h] of Object.entries(presets)){const b=document.createElement("button");b.textContent=name;b.title="Replace all selected cells";b.onclick=()=>set({lower:Array(7).fill(0),upper:h.map(v=>Math.round(v*grid.geometry_subdivisions))});$("presets").append(b);}
const ceiling=document.createElement("button");ceiling.textContent="Raised slab";ceiling.onclick=()=>set(uniformShape(grid.geometry_subdivisions,grid.geometry_subdivisions/2));$("presets").append(ceiling);
$("save").onclick=()=>{world.setClockState(clock.snapshot());downloadJSON(world.snapshot(),"hex-world.json");};
$("load").onchange=async()=>{try{
  const file=$("load").files[0];if(!file)return;if(file.size>25e6)throw Error("Lab import limit 25 MB");
  const next=World.restore(JSON.parse(await file.text())),g=next.config.grid,cfg=next.config,generated=cfg.generation?.profile===EXPLORATION_PROFILE,settlement=cfg.scene===SETTLEMENT;
  if(g.horizontal_ft!==base.grid.horizontal_ft||g.vertical_ft!==base.grid.vertical_ft||g.geometry_subdivisions!==2||g.chunk_size.some((n,i)=>n!==base.grid.chunk_size[i])||(!generated&&(cfg.generation||!((settlement?settlementDomain:islandDomain).every(a=>next.get(...a))))))throw Error("Unsupported laboratory world profile");
  if(generated){if(typeof cfg.generation.seed!=="string"||!cfg.generation.seed)throw Error("Invalid generation seed");loadViewport(next,viewportBounds({yaw:0,scale:24,width:canvas.width,height:canvas.height,panX:0,panY:50},g,undefined,120));}
  world=next;clearAnimationPhases();stagedPlan=null;drag=null;gesture=null;waypoints=[];$("planStatus").textContent="";$("pathStatus").textContent="No waypoints";$("applyEditPlan").disabled=true;history=new CellEditHistory(world);meshCache=new TerrainFaceCache(world);grid=g;worldMode=generated?"exploration":settlement?"settlement":"island";playback.clear();showEvents([]);$("cutaway").value="all";cutCenter=null;$("cutStatus").textContent="Global cutaway";selected=[0,0,0];selection=[[...selected]];turn=null;renderYaw=yaw=0;keys.clear();faceSelect.value="upper";dirty=true;clock=next.clockState?Clock.restore(next.clockState):new Clock(cfg.simulation);$("mode").value=clock.snapshot().mode;capture.clear();captureAnchor=null;regionKey="";cameraKey="";
  yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;$("worldMode").value=worldMode;
  if(generated)refreshRegion(true);else{ground=settlement?settlementGround:island;domain=settlement?settlementDomain:islandDomain;activeChunks=0;}
  syncWind();syncClimate();syncLighting();syncWaterMode();sync();$("message").textContent="World imported";
}catch(e){$("message").textContent=e.message;}finally{$("load").value="";}};
$("mode").onchange=()=>clock.configure($("mode").value);$("step").onclick=()=>{const before=clock.simulation;clock.advance(6);simulate(clock.simulation-before);};function addFire(definition){world.putEffect({id:crypto.randomUUID(),kind:"fire",address:[...selected],instance:effect(definition,clock.simulation)});}
$("fire").onclick=()=>addFire({behavior:"persistent"});$("timed").onclick=()=>addFire({behavior:"timed",duration:5});$("rotate").onclick=()=>rotateCamera(1);$("zoom").oninput=()=>scale=Number($("zoom").value);
function view(p){return project(p,camera());}
function projectLocal(a,p){const o=physicalPosition(...a,grid);return view([o.x+p[0],o.y+p[1],o.z+p[2]]);}
function path(p){ctx.beginPath();p.forEach(({x,y},i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
function polygon(p,fill,stroke){path(p);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
function pos(e){const b=canvas.getBoundingClientRect();return [(e.clientX-b.left)*canvas.width/b.width,(e.clientY-b.top)*canvas.height/b.height];}

function bindGesture(el){el.addEventListener("pointerdown",()=>gesture={});for(const event of ["pointerup","pointercancel","change","blur"])el.addEventListener(event,()=>gesture=null);}
function pickCell(x,y){
  const visible=visibleCache?.faces??faces,locked=selectionMode.value==="layer"&&$("paintTool").value==="select";
  const hit=pickFace(locked?visible.filter(f=>f.address[2]===selected[2]):visible,x,y,view);if(hit)return {address:hit.address,key:faceKey(hit)};
  const corners=vertices(uniformShape(0),grid).upper.slice(0,6);
  for(const a of domain){if(a[2]!==selected[2]||!displayedAddress(a)||hasVolume(world.get(...a).shape))continue;path(corners.map(p=>projectLocal(a,p)));if(ctx.isPointInPath(x,y))return {address:a,key:"upper"};}
  return null;
}
function brushTransform(){const mode=$("paintTool").value,material=$("paintMaterial").value;
  if(mode==="material")return c=>cellMaterial(c,material,catalog.materials[material].vegetation);
  if(mode==="full"||mode==="half"||mode==="empty"){const s=uniformShape(mode==="full"?grid.geometry_subdivisions:mode==="half"?grid.geometry_subdivisions/2:0);return c=>cellShape(c,s,material);}
  if(mode==="water"||mode==="drain"){const w=mode==="water"?validateWater({fill:Number($("paintWater").value),fixed:true}):null;return c=>cellWater(c,w);}
  return null;
}
function brushAt(hit){if(!hit)return;const a=hit.address;if(drag.previous&&a[2]!==drag.previous[2])return;
  const centers=drag.previous?hexStroke(drag.previous,a):[a],fresh=[];
  for(const center of centers)for(const address of selectionBrush(world,center,drag.radius,displayedAddress)){const key=address.join(",");if(!drag.cells.has(key)){drag.cells.set(key,address);fresh.push(address);}}
  if(drag.cells.size>512)throw Error("Brush exceeds 512 cells; use smaller strokes");drag.previous=a;
  if(!fresh.length)return;
  if(drag.mode==="objects"||drag.mode==="eraseObjects"){
    if(drag.mode==="objects"){
      const {entities}=planObjectPlacement(world,fresh,{bindings:drag.bindings,seed:drag.seed,density:drag.density,occupancy:drag.occupancy,idFor:()=>crypto.randomUUID(),allowWet:true});
      drag.objects.push(...entities.map(e=>({...e,expected:null})));
    }else for(const address of fresh)for(const e of drag.occupancy.get(address.join(","))??[])drag.objects.push({id:e.id,expected:e,value:null});
    if(drag.objects.length>512)throw Error("Object brush exceeds 512 objects");$("planStatus").textContent=drag.objects.length+" object edits in stroke";
  }else if(drag.transform){for(const address of fresh){const expected=world.get(...address);drag.edits.push({address,expected,value:drag.transform(expected)});}$("planStatus").textContent=drag.edits.length+" cells in stroke";}
  else{selection=mergeSelection(drag.base,[...drag.cells.values()],true);selected=selection.find(v=>v.join(",")===a.join(","))??selection.at(-1);faceSelect.value=hit.key;sync();}
}
function finishBrush(commit){const stroke=drag;drag=null;gesture=null;if(!stroke?.brush)return;
  if(!commit){if(stroke.mode==="select"){selection=stroke.original;selected=stroke.active;sync();}$("planStatus").textContent="Stroke canceled";return;}
  if(stroke.edits.length||stroke.objects.length){try{const plan={schema:"smi-hex-edit-plan/1",world_id:world.config.id,label:"Paint "+stroke.mode,edits:stroke.edits,entities:stroke.objects};if(applyEditPlan(world,history,plan)){dirty||=stroke.edits.length>0;for(const e of stroke.objects)playback.delete(e.id);}sync();$("planStatus").textContent="Stroke applied";}catch(e){$("planStatus").textContent=e.message;}}
}
canvas.onpointerdown=e=>{const [x,y]=pos(e);if(e.button===1||e.button===2){e.preventDefault();drag={id:e.pointerId,pan:true,x,y,panX,panY};canvas.setPointerCapture(e.pointerId);return;}if(e.button!==0)return;canvas.focus({preventScroll:true});const extend=e.shiftKey||e.ctrlKey||e.metaKey;const painting=$("paintTool").value!=="select",radius=Number($("brushRadius").value),handle=painting||extend||radius>0?null:nearestHandle(handles,x,y,vertexSelect.value);
  if(selectionMode.value==="surface"&&$("paintTool").value==="select"&&!surfaceMode()){$("sculptStatus").textContent="Switch to full world view or individual cell mode";return;}
  if(surfaceMode()){
    if(handle&&currentSurface().profile){const p=currentSurface().profile;drag={id:e.pointerId,sculpt:true,owner:world,rev:world.geometryRevision,y,h:p.heights[handle.index],index:handle.index,address:[...selected],options:sculptOptions(),plan:null,target:p.heights[handle.index]};canvas.setPointerCapture(e.pointerId);return;}
    const hit=pickCell(x,y);if(hit)selectSurface(hit.address);return;
  }
  if(handle){vertexSelect.value=handleKey(handle);sync();gesture={};drag={id:e.pointerId,y,h:get()[handle.layer][handle.index],ref:{layer:handle.layer,index:handle.index}};canvas.setPointerCapture(e.pointerId);return;}
  const hit=pickCell(x,y);if(!hit)return;
  if(painting||radius>0){
    try{const mode=$("paintTool").value,occupancy=mode==="objects"||mode==="eraseObjects"?entityOccupancy(world):new Map(),bindings=mode==="objects"?builderBindings():[];const density=Number($("objectDensity").value);if(!Number.isFinite(density)||density<0||density>1)throw Error("Invalid object density");drag={id:e.pointerId,brush:true,mode,radius,transform:brushTransform(),occupancy,bindings,seed:$("builderSeed").value,density,objects:[],cells:new Map(),edits:[],original:selection,active:selected,base:extend?selection:[],previous:null};brushAt(hit);canvas.setPointerCapture(e.pointerId);}catch(err){finishBrush(false);$("planStatus").textContent=err.message;}return;
  }
  selectAddress(hit.address,hit.key,extend);
};
function finishSculpt(commit){
  const stroke=drag;drag=null;gesture=null;if(!stroke?.sculpt)return;
  if(!commit){$("sculptStatus").textContent="Surface sculpt canceled";return;}
  if(!stroke.plan)return;
  try{
    if(world!==stroke.owner||world.geometryRevision!==stroke.rev)throw Error("Terrain changed during sculpt; retry");
    const plan=planSurfaceSculpt(world,stroke.address,stroke.index,stroke.target,stroke.options);
    if(JSON.stringify(plan)!==JSON.stringify(stroke.plan))throw Error("Surface changed during sculpt; retry");
    if(applyEditPlan(world,history,plan))dirty=true;
    const p=surfaceColumn(world,stroke.address,LEVELS);if(p){selected=[...p.address];selection=[[...selected]];}
    sync();$("sculptStatus").textContent="Surface sculpt applied";
  }catch(e){$("sculptStatus").textContent=e.message;}
}
canvas.onpointermove=e=>{
  if(!drag){if(surfaceMode()){const hit=pickCell(...pos(e));hoverColumn=null;if(hit)try{hoverColumn=surfaceColumn(world,hit.address,LEVELS)?.address??null;}catch{}}else hoverColumn=null;return;}
  if(drag.id!==e.pointerId)return;
  if(drag.sculpt){
    const target=Math.round(drag.h+vertexDragDelta(drag.y-pos(e)[1],scale,grid));
    if(target===drag.target)return;drag.target=target;drag.plan=null;
    try{if(world!==drag.owner||world.geometryRevision!==drag.rev)throw Error("Terrain changed during sculpt; retry");
      drag.plan=planSurfaceSculpt(world,drag.address,drag.index,target,drag.options);$("sculptStatus").textContent=(target*grid.vertical_ft/grid.geometry_subdivisions)+" ft elevation · "+drag.plan.edits.length+" cells proposed";
    }catch(err){$("sculptStatus").textContent=err.message;}return;
  }
  if(drag.brush){try{brushAt(pickCell(...pos(e)));}catch(err){finishBrush(false);$("planStatus").textContent=err.message;}return;}if(drag.pan){const [x,y]=pos(e);panX=drag.panX+x-drag.x;panY=drag.panY+y-drag.y;return;}move(drag.h+vertexDragDelta(drag.y-pos(e)[1],scale,grid),drag.ref);};
canvas.onpointerleave=()=>{hoverColumn=null;};
canvas.oncontextmenu=e=>e.preventDefault();
canvas.addEventListener("wheel",e=>{e.preventDefault();if(drag?.sculpt)return;const [x,y]=pos(e),next=Math.max(12,Math.min(48,scale*Math.exp(-e.deltaY*.001))),ratio=next/scale;panX=x-canvas.width/2-(x-canvas.width/2-panX)*ratio;panY=y-canvas.height/2-(y-canvas.height/2-panY)*ratio;scale=next;$("zoom").value=String(next);},{passive:false});
$("resetView").onclick=()=>{turn=null;renderYaw=yaw=0;scale=24;panX=0;panY=50;$("zoom").value=24;};
canvas.onpointerup=()=>{if(drag?.sculpt)finishSculpt(true);else if(drag?.brush)finishBrush(true);else{drag=null;gesture=null;}};
canvas.onpointercancel=canvas.onlostpointercapture=()=>{if(drag?.sculpt)finishSculpt(false);else if(drag?.brush)finishBrush(false);else{drag=null;gesture=null;}};
function rotateCamera(delta){yaw=wrapYaw(yaw+delta);turn=turnCamera(renderYaw,yaw,performance.now());}
$("clearSelection").onclick=()=>{selection=[[...selected]];sync();};
for(const k of Object.keys(catalog.materials))$("paintMaterial").add(new Option(k,k));
$("exportBuildContext").onclick=()=>{try{downloadJSON(exportBuildContext(world,selection,[...palette.values()].map(v=>v.binding)),"hex-build-context.json");}catch(e){$("planStatus").textContent=e.message;}};
$("exportLastPlan").onclick=()=>{const plan=history.latestPlan();if(plan)downloadJSON(plan,"hex-edit-plan.json");};
async function qualifyObjects(entities){const bindings=new Map(entities.filter(e=>e.value).map(e=>[visualKey(e.value.visual),e.value.visual]));if(bindings.size>64)throw Error("Plan exceeds 64 distinct visual bindings");for(const binding of bindings.values())await qualifyBinding(binding);}
let planRequest=0;
function builderBindings(){
  if($("usePalette").checked){const entries=[...palette.values()].map(v=>v.binding);if(!entries.length)throw Error("Pin assets to the palette first");return entries;}
  if(!actor||$("paintLoadedAsset").disabled)throw Error("Load a qualified asset first");return [activeBinding];
}
function stageBuilder(plan,notes=""){
  planRequest++;stagedPlan=inspectEditPlan(world,plan);
  $("planStatus").textContent=plan.label+": "+plan.edits.length+" cells; "+(plan.entities?.length??0)+" objects; "+stagedPlan.conflicts.length+" conflicts"+notes;
  $("applyEditPlan").disabled=!!stagedPlan.conflicts.length;
}
function builderSettings(){const material=$("paintMaterial").value;return {material,vegetation:catalog.materials[material].vegetation,height:Number($("gradeHeight").value)};}
function procedure(fn){try{fn();}catch(e){planRequest++;stagedPlan=null;$("applyEditPlan").disabled=true;$("planStatus").textContent=e.message;}}
$("addWaypoint").onclick=()=>{if(waypoints.length>=32){$("pathStatus").textContent="32 waypoint limit";return;}waypoints.push([...selected]);$("pathStatus").textContent=waypoints.map(a=>a.join(",")).join(" → ");};
$("clearWaypoints").onclick=()=>{waypoints=[];$("pathStatus").textContent="No waypoints";};
$("previewGrade").onclick=()=>procedure(()=>stageBuilder(planGrade(world,selection,builderSettings())));
$("previewExposure").onclick=()=>procedure(()=>stageBuilder(planWeatherExposure(world,selection,{seconds:Number($("exposureSeconds").value)}),"; selected surfaces only; no clock advance"));
$("previewPath").onclick=()=>procedure(()=>{
  const kind=$("pathKind").value,plan=planPath(world,waypoints,{...builderSettings(),kind,radius:Number($("pathRadius").value),fill:Number($("paintWater").value),speed:Number($("riverSpeed").value)});
  if(plan.edits.some(e=>!displayedAddress(e.address)))throw Error("Path crosses hidden cells");
  stageBuilder(plan);
});
$("previewGrove").onclick=()=>procedure(()=>{const {plan,skipped}=planGrove(world,selection,{bindings:builderBindings(),seed:$("builderSeed").value,density:Number($("objectDensity").value)});stageBuilder(plan,"; "+skipped+" skipped");});
$("previewWoodland").onclick=async()=>{
  const owner=world,anchor=[...selected],request=++planRequest;
  stagedPlan=null;$("applyEditPlan").disabled=true;$("planStatus").textContent="Resolving woodland preview assets";
  try{
    const entries=await fetchCatalog(ATLAS_CATALOG);
    async function resolve(id){
      const entry=entries.find(e=>e.id===id);
      if(!entry?.binding.archive_sha256||entry.license!=="CC0-1.0")throw Error("Missing approved preview asset: "+id);
      const {height_ft,...source}=entry.binding;
      return (await resolveAtlasBinding(source)).binding;
    }
    const [tree,chest]=await Promise.all([
      resolve("smi.world.fantasy.recovered.trees-20261125.painted-broadleaf-tree"),
      resolve("smi.world.fantasy.recovered.chests-20261125.weathered-wood-chest")
    ]);
    if(owner!==world||request!==planRequest)return;
    const plan=planWoodlandClearing(world,anchor,{tree,chest});
    if([...plan.edits.map(e=>e.address),...plan.entities.map(e=>e.value.address)].some(a=>!domain.some(b=>a.every((v,i)=>v===b[i]))||!displayedAddress(a)))throw Error("Clearing crosses the active editor region");
    await qualifyObjects(plan.entities);
    if(owner!==world||request!==planRequest)return;
    stageBuilder(plan,"; static chest preview; apply separately");
  }catch(e){if(owner===world&&request===planRequest)procedure(()=>{throw e;});}
};
$("exportStagedPlan").onclick=()=>{if(stagedPlan)downloadJSON(stagedPlan.plan,"hex-proposed-plan.json");else $("planStatus").textContent="Preview a plan first";};
$("importEditPlan").onchange=async()=>{const owner=world,request=++planRequest;$("applyEditPlan").disabled=true;stagedPlan=null;try{const f=$("importEditPlan").files[0];if(!f)return;if(f.size>2e6)throw Error("Plan exceeds 2 MB");const raw=JSON.parse(await f.text());if(owner!==world||request!==planRequest)return;const checked=inspectEditPlan(world,raw);await qualifyObjects(checked.plan.entities??[]);if(owner!==world||request!==planRequest)return;stageBuilder(raw);}catch(e){if(owner===world&&request===planRequest){stagedPlan=null;$("applyEditPlan").disabled=true;$("planStatus").textContent=e.message;}}finally{if(owner===world)$("importEditPlan").value="";}};
$("applyEditPlan").onclick=()=>{try{if(!stagedPlan)return;if(applyEditPlan(world,history,stagedPlan.plan)){dirty||=stagedPlan.plan.edits.length>0;for(const e of stagedPlan.plan.entities??[])playback.delete(e.id);}stagedPlan=null;$("applyEditPlan").disabled=true;sync();$("planStatus").textContent="Plan applied";}catch(e){if(stagedPlan){stagedPlan=inspectEditPlan(world,stagedPlan.plan);$("applyEditPlan").disabled=!!stagedPlan.conflicts.length;}$("planStatus").textContent=e.message;}};
$("discardEditPlan").onclick=()=>{planRequest++;stagedPlan=null;$("applyEditPlan").disabled=true;$("planStatus").textContent="Plan discarded";};
const shortcuts=new Set(["q","e","w","a","s","d","z","x"]);
function editableTarget(t){return t?.isContentEditable||["INPUT","SELECT","TEXTAREA"].includes(t?.tagName);}
window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(k==="escape"&&drag?.sculpt){finishSculpt(false);return;}if(k==="escape"&&drag?.brush){finishBrush(false);return;}if(editableTarget(e.target))return;if(drag?.sculpt)return;if((e.ctrlKey||e.metaKey)&&!e.altKey&&(k==="z"||k==="y")){e.preventDefault();if(!e.repeat)replayEdit(k==="z"&&!e.shiftKey);return;}if(!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&!e.repeat&&!drag&&e.target===canvas&&workspace.shortcut(k)){e.preventDefault();return;}if(e.ctrlKey||e.metaKey||e.altKey||!shortcuts.has(k))return;e.preventDefault();if((k==="q"||k==="e")&&!e.repeat)rotateCamera(k==="q"?-1:1);else keys.add(k);});
window.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
window.addEventListener("blur",()=>keys.clear());
document.addEventListener("focusin",e=>{if(editableTarget(e.target))keys.clear();});
let profileFrame={frame_ms:0,frame_interval_ms:0,terrain_ms:0,sprites_ms:0,shadow_ms:0,render_ms:0},profileAt=0,profileSamples=new FrameSamples();
let benchmark=null,benchmarkReport=null,lastRenderCameraKey=null;
const benchmarkFlags=["artStyle","scatter","windVisual","independentPhases","weatherVisual","pointLights","pointOcclusion","ambientOcclusion","contactShadows","directionalShadows","softSprites","showWater","wire","pattern","transitions","transitionDebug"];
function benchmarkContext(){
  return {world_id:world.config.id,world_mode:worldMode,geometry_revision:world.geometryRevision,camera:camera(),selection:structuredClone(selection),quality:$("renderQuality").value,art_style:art&&$("artStyle").checked?art.profile.id:null,environment:world.environment,clock_mode:clock.snapshot().mode,flags:Object.fromEntries(benchmarkFlags.map(id=>[id,$(id).checked])),device_pixel_ratio:devicePixelRatio,viewport:[innerWidth,innerHeight],renderer:gpu.diagnostics(),resident_chunks:world.chunkCount,active_cells:domain.length,world_objects:world.entityCount,visible_triangles:visibleCache?.faces.length??0,scatter_candidates:scatterPlan.length};
}
function finishBenchmark(cancelled=false){
  if(!benchmark)return;const run=benchmark;
  if(!cancelled&&run.samples.count){
    benchmarkReport={schema:"smi-hex-performance/1",scenario:run.label,started_at:run.started_at,user_agent:navigator.userAgent,warmup_ms:1500,requested_duration_ms:10000,elapsed_ms:Math.round(run.last-run.first),start:run.start,end:benchmarkContext(),metrics:run.samples.summary(),notes:"CPU frame/stage timings exclude final status serialization; GPU timer samples are optional asynchronous completed draws, not compositor timing. No automatic performance guarantee."};
    $("benchmarkStatus").textContent="Captured "+benchmarkReport.metrics.samples+" frames · "+benchmarkReport.metrics.fps+" FPS · p95 "+benchmarkReport.metrics.interval_p95_ms+" ms";
    $("exportBenchmark").disabled=false;
  }else $("benchmarkStatus").textContent="Capture cancelled — keep the tab visible and try again";
  benchmark=null;gpu.setTimingEnabled(false);$("startBenchmark").disabled=false;$("cancelBenchmark").disabled=true;
}
$("startBenchmark").onclick=()=>{
  if(benchmark||document.hidden)return;
  benchmark={label:$("benchmarkScenario").value,started_at:new Date().toISOString(),ready:performance.now()+1500,first:null,last:null,start:null,samples:new FrameSamples()};
  $("startBenchmark").disabled=true;$("cancelBenchmark").disabled=false;$("benchmarkStatus").textContent="Warming up (1.5 seconds)";
};
$("cancelBenchmark").onclick=()=>finishBenchmark(true);
$("exportBenchmark").onclick=()=>{if(benchmarkReport)downloadJSON(benchmarkReport,"hex-world-performance.json");};
document.addEventListener("visibilitychange",()=>{if(document.hidden&&benchmark)finishBenchmark(true);});
function captureFrame(ms,timing,diagnostics,gpuSamples){
  if(!benchmark||ms<benchmark.ready)return;
  if(benchmark.first===null){
    benchmark.first=benchmark.last=ms;benchmark.start=benchmarkContext();gpu.setTimingEnabled(true);
    $("benchmarkStatus").textContent="Recording 10 seconds — "+benchmark.label;return;
  }
  benchmark.last=ms;benchmark.samples.add(timing,diagnostics,gpuSamples);
  if(ms-benchmark.first>=10000||benchmark.samples.count>=benchmark.samples.limit)finishBenchmark();
}

function frame(ms){const interval=last===undefined?0:ms-last,dt=Math.min(.1,interval/1000);last=ms;const started=performance.now(),motion=cameraKeys(keys,dt,scale);panX+=motion.dx;panY+=motion.dy;if(motion.scale!==scale){scale=motion.scale;$("zoom").value=scale;}if(turn){const t=sampleTurn(turn,ms);renderYaw=t.done?yaw:t.yaw;if(t.done)turn=null;}clock.animate(dt);const before=clock.simulation;clock.advance(dt,"realtime");simulate(clock.simulation-before);const terrainStart=performance.now();resizeViewport();refreshRegion();ctx.clearRect(0,0,canvas.width,canvas.height);
  if(dirty){visibleCache=null;grassCache=new WeakMap();shadowCache=null;wireCells=new Map();scatterDirty=true;const level=cutLevel(),renderWorld=level===null?world:cutawayView(world,level,cutOptions());faces=decorateTerrain(renderWorld,level===null?domain:domain.filter(displayedAddress),catalog,{enabled:$("transitions").checked,...(level===null?{cache:meshCache}:{})});if($("ambientOcclusion").checked)faces=terrainOcclusion(world,faces);waterSurfaces=buildWaterSurfaces(renderWorld,level===null?domain:domain.filter(displayedAddress),{sides:true});dirty=false;for(const [id,motion] of playback)if(motion.stamp!==routeGeometryStamp(world,motion.path,movement))playback.delete(id);contactByCell=new Map();}
  if(lastCollisionRevision!==world.collisionRevision){lastCollisionRevision=world.collisionRevision;for(const [id,motion] of playback)if(motion.stamp!==routeGeometryStamp(world,motion.path,movement))playback.delete(id);}
  const terrainMS=performance.now()-terrainStart,spritesStart=performance.now();
  const alignment=Number($("cameraAlignment").value),quality=$("renderQuality").value,sprites=[],seed=world.config.id,styled=art&&$("artStyle").checked,poses=new Map(),contacts=[];
  for(const [id,motion] of playback){const pose=sampleRoute(motion.points,(clock.visual-motion.started)*10);if(pose.done){playback.delete(id);continue;}poses.set(id,pose);contacts.push({id,point:pose.point});}
  let bent=0,windBent=0,animatedFoliage=0,seasonalFoliage=0;const field=world.environment,windEnabled=$("windVisual").checked,windCache=new Map(),climateCache=new Map(),updated=new Set(),scatterVisualCache=new Map(),vegetationVisualCache=new Map();
  function climateFor(address){const k=address.join(",");if(!climateCache.has(k))climateCache.set(k,climateAt(field,address));return climateCache.get(k);}
  function windFor(address){if(!windEnabled)return CALM;const key=address.join(",");if(!windCache.has(key))windCache.set(key,windAt(field,address));return windCache.get(key);}
  function flex(points,root,height,response,exclude=null,wind=CALM,capability=null){
    const contact=$("brushContact").checked&&contacts.length?bendBillboard(points,root,height,contacts,response,exclude):points;
    if(contact!==points)bent++;
    if(!capability?.bend||(!wind.velocity_ft_s[0]&&!wind.velocity_ft_s[1]))return contact;
    const offset=windOffset(capability,sampleWind(wind,root,clock.visual),height);
    if(Math.hypot(...offset)>1e-8)windBent++;
    return composeBend(points,contact,offset,height);
  }
  function animateRaster(base,identity,onError=e=>{$("artStatus").textContent="Animation error: "+e.message;}){
    if(!base.animated)return base;
    const phase=$("independentPhases").checked&&base.phasePeriod?phasePool.select(base,stableUnit(seed,identity,"animation-phase")):{raster:base,offset:0};
    const update=(r,offset)=>{if(!updated.has(r)&&!phaseFailures.has(r)){updated.add(r);r.update(clock.visual*1000+offset).catch(e=>{if(r===base)onError(e);else phaseFailures.add(r);});}};
    if(phase.raster!==base&&!phaseFailures.has(phase.raster)){update(phase.raster,phase.offset);if(phase.raster.revision>0)return phase.raster;}
    update(base,0);return base;
  }

  function cellContact(address){const k=address.join(",");if(!contactByCell.has(k))contactByCell.set(k,contactResponse(interactions,cellTarget(address,world.get(...address))));return contactByCell.get(k);}

  const ckey=JSON.stringify(camera());if(!visibleCache||visibleCache.key!==ckey)visibleCache={key:ckey,faces:faces.filter(f=>visibleTriangle(f,view,canvas.width,canvas.height,scale*5)),water:waterSurfaces.filter(f=>visibleTriangle(f,view,canvas.width,canvas.height,scale*5))};
  const visible=visibleCache.faces;
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
    const wind=windFor(sample.address),season=climateFor(sample.address).season,k=JSON.stringify([sample.family,sample.variant,sample.orientation,season,wind.velocity_ft_s]);if(!scatterVisualCache.has(k))scatterVisualCache.set(k,scatterRaster(art,{...sample,scale:1},wind,season,yaw));const v=scatterVisualCache.get(k);if(!v)continue;
    const height=v.height*sample.scale,p=sample.point,w=height*v.r.pixelWidth/v.r.pixelHeight,screen=view(p),margin=scale*Math.max(w,height)*2;
    if(screen.x<-margin||screen.x>canvas.width+margin||screen.y<-margin||screen.y>canvas.height+margin)continue;
    const r=animateRaster(v.r,[sample.address,sample.key]);
    sprites.push({image:r.image,revision:r.revision,hardAlpha:quality==="fast"||quality==="balanced"&&height<=3,points:flex(billboard(p,renderYaw,w,height,r.pivot,alignment),p,height,sample.contact&&contacts.length?cellContact(sample.address):null,null,wind,v.wind)});scatterInstances++;
    if(sample.shadow&&(quality!=="fast"||height>3))shadowObjects.push({address:sample.address,point:p,height,radius:Math.min(grid.horizontal_ft/2,w*.45),opacity:.35});
  }
  if($("vegetation").checked)for(const f of visible){
    if(f.kind!=="top"||f.vegetation<=0)continue;
    if(styled){
      let cached=grassCache.get(f);if(!cached||cached.art!==art||cached.scale!==scale){cached={art,scale,samples:vegetationSamples(f,seed,art.profile,scale)};grassCache.set(f,cached);}for(const sample of cached.samples){
        const wind=windFor(f.address),season=climateFor(f.address).season,k=JSON.stringify([sample.variant,season,wind.velocity_ft_s]);if(!vegetationVisualCache.has(k))vegetationVisualCache.set(k,vegetationRaster(art,sample.variant,wind,season));const baseRaster=vegetationVisualCache.get(k);if(!baseRaster)continue;const r=animateRaster(baseRaster,sample.point);const seasonal=art.seasonalRasters.get(season)?.get(sample.variant);if(seasonal)seasonalFoliage++;if(baseRaster!==(seasonal??art.vegetation.get(sample.variant)))animatedFoliage++;
        sprites.push({image:r.image,revision:r.revision,hardAlpha:quality!=="full",points:flex(billboard(sample.point,renderYaw,sample.height*r.pixelWidth/r.pixelHeight,sample.height,r.pivot,alignment),sample.point,sample.height,contacts.length?cellContact(f.address):null,null,wind,vegetationWind(art.profile,sample.variant,season))});
      }
    }else if(stableUnit(seed,f.address,"tuft"+f.triangle)<=f.vegetation){
      const p=[0,1,2].map(i=>f.points.reduce((sum,v)=>sum+v[i]/3,0)),h=.55+f.vegetation*1.1;
      sprites.push({image:tufts.get(f.variant),revision:0,hardAlpha:quality!=="full",points:flex(billboard(p,renderYaw,h*.9,h,undefined,alignment),p,h,contacts.length?cellContact(f.address):null,null,windFor(f.address),fixtureWind)});
    }
  }
  let objectInstances=0,unresolvedObjects=0,maskedObjects=0;
  if($("showActor").checked)for(const e of world.entities()){
    const h=anchorHeight(e,world.get(...e.address),grid);if(h===undefined){unresolvedObjects++;continue;}
    const o=physicalPosition(...e.address,grid);let p=[o.x+e.offset_ft[0],o.y+e.offset_ft[1],o.z+h],address=e.address,walking=false;
    const pose=poses.get(e.id);if(pose){p=pose.point;address=pose.address;walking=true;}
    if(!displayedAddress(address))continue;const screen=view(p);
    const margin=scale*e.visual.height_ft*4;if(screen.x<-margin||screen.x>canvas.width+margin||screen.y<-margin||screen.y>canvas.height+margin)continue;
    const viewBinding=directionalBinding(e.visual,yaw,e.orientation_steps??0),wind=windFor(address),state=windState(viewBinding.wind,wind,viewBinding.state),binding=walking&&viewBinding.walk_state?{...viewBinding,state:viewBinding.walk_state,requireState:true}:state===viewBinding.state?viewBinding:{...viewBinding,state,requireState:true};
    const preferred=requestSprite(binding),entry=preferred.sprite?preferred:requestSprite(viewBinding),s=entry.sprite;
    if(!s){unresolvedObjects++;continue;}
    const r=animateRaster(s,[e.id],err=>{entry.error=err.message;entry.sprite=null;});if(r.emissiveMask)maskedObjects++;
    sprites.push({image:r.image,revision:r.revision,emissiveMask:r.emissiveMask,emissive:e.light?.emissive??0,points:flex(billboard(p,renderYaw,s.width,s.height,r.pivot,alignment),p,s.height,contacts.length?contactResponse(interactions,entityTarget(e)):null,e.id,wind,e.visual.wind)});objectInstances++;
    if(e.anchor==="surface"&&Math.abs(e.offset_ft[2])<1e-8)shadowObjects.push({address,point:p,height:s.height,radius:Math.min(grid.horizontal_ft/2,s.width*.45),opacity:.48});
  }
  const editPreview=drag?.sculpt?(drag.plan?.edits??[]):drag?.brush&&drag.transform?drag.edits:stagedPlan?.plan.edits??[];
  const conflictKeys=new Set((stagedPlan?.conflicts??[]).filter(c=>c.address).map(c=>c.address.join(",")));
  const objectPreview=drag?.brush?drag.objects:stagedPlan?.plan.entities??[];
  const pendingCells=new Map(editPreview.map(e=>[e.address.join(","),e.value]));
  // Render a bounded preview of proposed entities, not a second scene or
  // a mutation. Unsupported, offscreen and excess records retain their markers.
  const ghostSprites=[];let previewOmitted=0,previewAttempts=0;
  if(!$("transitionDebug").checked)for(const change of objectPreview){
    const e=change.value;if(!e||!displayedAddress(e.address))continue;
    const h=anchorHeight(e,pendingCells.get(e.address.join(","))??world.get(...e.address),grid);if(h===undefined)continue;
    const o=physicalPosition(...e.address,grid),p=[o.x+e.offset_ft[0],o.y+e.offset_ft[1],o.z+h],screen=view(p),margin=scale*e.visual.height_ft*4;
    if(screen.x<-margin||screen.x>canvas.width+margin||screen.y<-margin||screen.y>canvas.height+margin)continue;
    if(previewAttempts>=64){previewOmitted++;continue;}previewAttempts++;
    const binding=directionalBinding(e.visual,yaw,e.orientation_steps??0),entry=requestSprite(binding),s=entry.sprite;if(!s)continue;
    const points=billboard(p,renderYaw,s.width,s.height,s.pivot,alignment);
    ghostSprites.push({image:s.image,revision:s.revision,points,previewOpacity:.48,previewColor:!drag?.brush&&conflictKeys.has(e.address.join(","))?[.95,.35,.3]:[.3,.9,.95]});
  }
  const weatherSprites=[];
  if($("weatherVisual").checked&&cutLevel()===null){
    // Cached by terrain/visibility identity and environmental inputs, not visual time.
    const key=JSON.stringify([field.climate,field.wind,field.zones,seed,windEnabled]);
    if(!weatherCache||weatherCache.faces!==faces||weatherCache.visible!==visible||weatherCache.key!==key){
      const weatherField=windEnabled?field:{...field,wind:CALM,zones:field.zones.map(z=>({...z,wind:z.wind?CALM:undefined}))};
      weatherCache={faces,visible,key,plan:precipitationPlan(faces,visible,weatherField,seed)};
    }
    for(const sample of weatherCache.plan){
      const p=precipitationParticle(sample,clock.visual);
      weatherSprites.push({image:weatherTextures.get(p.kind),revision:0,hardAlpha:true,emissive:.3,points:billboard(p.point,renderYaw,p.width,p.height,[.5,.5],alignment)});
    }
  }
  const spriteMS=performance.now()-spritesStart,shadowStart=performance.now(),light=field.lighting??(styled?art.profile.lighting:null),shadowKey=JSON.stringify([light,$("contactShadows").checked,$("directionalShadows").checked,shadowObjects]);
  if(!shadowCache||shadowCache.visible!==visible||shadowCache.key!==shadowKey)shadowCache={visible,key:shadowKey,shadows:$("contactShadows").checked?contactShadows(visible,shadowObjects):[],sun:light&&$("directionalShadows").checked?directionalShadows(visible,shadowObjects,light,grid):{faces:[],truncated:false}};
  const {shadows,sun}=shadowCache;
  const water=$("showWater").checked?visibleCache.water:[];
  const local=$("pointLights").checked?selectPointLights(collectPointLights(world,{simulationTime:clock.simulation,visualTime:clock.visual,poses,displayed:displayedAddress}),[...visible,...water],sprites):{lights:[],omitted:0};
  const pointShadow=$("pointOcclusion").checked&&cutLevel()===null&&local.lights.length?pointShadowCache.prepare(world,local.lights):{plan:null,diagnostics:{lights:0,rays:0,unknown:0,budget:0,omitted:local.lights.length,cache_hit:false}};
  const walls=[];for(const [a,b] of selectionEdges(world,selection.filter(displayedAddress),grid)){const up=p=>[p[0],p[1],p[2]+grid.vertical_ft*.18],lo=p=>[p[0],p[1],p[2]+.015];walls.push({points:[lo(a),lo(b),up(b)],fade:[0,0,1]},{points:[lo(a),up(b),up(a)],fade:[0,1,1]});}
  const shadowMS=performance.now()-shadowStart,renderStart=performance.now();
  gpu.render(visible,view,{projectionKey:ckey,cacheStaticTerrain:lastRenderCameraKey===null||lastRenderCameraKey===ckey,selectionWalls:walls,water,visualTime:clock.visual,pointLights:local.lights,pointShadow:pointShadow.plan,previews:ghostSprites,selected,pattern:$("pattern").checked,sprites:weatherSprites.length?[...sprites,...weatherSprites]:sprites,transitions:catalog.transitions,debug:$("transitionDebug").checked,style:styled?art.profile:null,lighting:light,softSprites:$("softSprites").checked,shadows:[...shadows,...sun.faces]});
  lastRenderCameraKey=ckey;const renderMS=performance.now()-renderStart;
  if($("wire").checked){
    if(!wireCells.has(selected[2]))wireCells.set(selected[2],domain.filter(a=>a[2]===selected[2]&&!hasVolume(world.get(...a).shape)));
    const emptyCorners=vertices(uniformShape(0),grid).upper.slice(0,6);
    for(const a of wireCells.get(selected[2])){const p=projectLocal(a,[0,0,0]);if(p.x<-scale*5||p.x>canvas.width+scale*5||p.y<-scale*5||p.y>canvas.height+scale*5)continue;polygon(emptyCorners.map(p=>projectLocal(a,p)),null,"#344b56");}

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
  for(const a of waypoints){const c=world.get(...a);if(!c||!displayedAddress(a))continue;const p=projectLocal(a,vertices(c.shape,grid).upper[6]);ctx.fillStyle="#ffe29a";ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fill();}
  for(const change of objectPreview){const e=change.value??change.expected;if(!e||!displayedAddress(e.address))continue;const h=anchorHeight(e,pendingCells.get(e.address.join(","))??world.get(...e.address),grid);if(h===undefined)continue;const o=physicalPosition(...e.address,grid),p=view([o.x+e.offset_ft[0],o.y+e.offset_ft[1],o.z+h]),color=change.value&&!conflictKeys.has(e.address.join(","))?"#66dfea":"#f08072";ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(p.x-5,p.y);ctx.lineTo(p.x+5,p.y);if(change.value){ctx.moveTo(p.x,p.y-5);ctx.lineTo(p.x,p.y+5);}ctx.stroke();ctx.lineWidth=1;}
  for(const e of editPreview){if(!displayedAddress(e.address))continue;const v=vertices(e.value.shape,grid),blocked=!drag?.brush&&conflictKeys.has(e.address.join(","));polygon(v.upper.slice(0,6).map(p=>projectLocal(e.address,p)),blocked?"rgba(240,100,80,.18)":"rgba(70,220,230,.18)",blocked?"#f08072":"#66dfea");}
  if($("showColliders").checked)try{for(const c of objectVolumes(world)){
    if(!displayedAddress(c.address))continue;
    const ring=z=>Array.from({length:24},(_,i)=>view([c.center[0]+c.radius*Math.cos(i*Math.PI/12),c.center[1]+c.radius*Math.sin(i*Math.PI/12),z]));
    const lower=ring(c.bottom),upper=ring(c.top);polygon(lower,null,"#f2b45c");polygon(upper,null,"#f2b45c");for(let i=0;i<24;i+=6){ctx.beginPath();ctx.moveTo(lower[i].x,lower[i].y);ctx.lineTo(upper[i].x,upper[i].y);ctx.strokeStyle="#f2b45c";ctx.stroke();}
  }}catch(e){$("colliderStatus").textContent=e.message;}
  const v=vertices(get(),grid),key=activeFace(),sculpt=surfaceMode(),profile=sculpt?currentSurface().profile:null;
  handles=selectionMode.value==="surface"&&$("paintTool").value==="select"&&!sculpt?[]:sculpt?(profile?profile.heights.map((h,index)=>({layer:"upper",index,...projectLocal([selected[0],selected[1],0],[v.upper[index][0],v.upper[index][1],h*grid.vertical_ft/grid.geometry_subdivisions])})):[]):refs().map(h=>({...h,...projectLocal(selected,v[h.layer][h.index])}));
  // Outline the logical control face even when a neighboring cell clips it.
  // This is an editor overlay, not extra world geometry.
  if(sculpt){
    if(hoverColumn&&!drag){const c=world.get(...hoverColumn);if(c&&hasVolume(c.shape))polygon(vertices(c.shape,grid).upper.slice(0,6).map(p=>projectLocal(hoverColumn,p)),null,"#66dfea");}
    if(drag?.sculpt&&drag.plan){const p=handles.find(h=>h.index===drag.index);if(p){const y=p.y-(drag.target-drag.h)*grid.vertical_ft/grid.geometry_subdivisions*scale*VERTICAL_PROJECTION;ctx.strokeStyle="#66dfea";ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,y);ctx.stroke();ctx.beginPath();ctx.arc(p.x,y,7,0,Math.PI*2);ctx.stroke();}}
  }else if(!handles.length){}else if(key.startsWith("side:"))polygon(handles,null,"#f2bd60");
  else{
    polygon(handles.slice(0,6),null,"#f2bd60");
    if($("wire").checked)for(let i=0;i<6;i++)polygon([handles[6],handles[i],handles[(i+1)%6]],null,"#d2e3c3");
  }
  for(const p of [...handles].sort((a,b)=>Number(handleKey(a)===vertexSelect.value)-Number(handleKey(b)===vertexSelect.value))){
    const active=handleKey(p)===vertexSelect.value;
    ctx.beginPath();ctx.arc(p.x,p.y,active?7:4.5,0,Math.PI*2);ctx.fillStyle=active?"#f2bd60":p.layer==="upper"?"#e0efcf":"#8fc9ed";ctx.fill();ctx.strokeStyle="#243a4a";ctx.stroke();
    ctx.fillStyle="#fff";ctx.font="12px system-ui";ctx.fillText((sculpt?"S":p.layer==="upper"?"U":"L")+(p.index===6?"C":p.index+1),p.x+7,p.y+(p.layer==="upper"?-8:13));
  }
  if($("measureCell").checked){
    // Reference prism, not the current deformed surface. Choose the opposite
    // edge axis with the greatest screen separation for a readable width.
    const reference=vertices(uniformShape(grid.geometry_subdivisions),grid),mid=i=>reference.upper[i].map((v,k)=>(v+reference.upper[(i+1)%6][k])/2);
    const axes=[0,1,2].map(i=>[mid(i),mid(i+3)]).map(pair=>({pair,screen:pair.map(p=>projectLocal(selected,p))}));
    axes.sort((a,b)=>Math.abs(b.screen[1].x-b.screen[0].x)-Math.abs(a.screen[1].x-a.screen[0].x));
    const {pair,screen}=axes[0],right=screen[0].x>screen[1].x?0:1,top=pair[right],bottom=projectLocal(selected,[top[0],top[1],0]);
    ctx.save();ctx.lineWidth=2;ctx.font="bold 12px system-ui";ctx.textBaseline="middle";
    function dimension(a,b,label,color,dx,dy){
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      for(const p of [a,b]){ctx.beginPath();ctx.arc(p.x,p.y,3,0,Math.PI*2);ctx.fill();}
      const x=(a.x+b.x)/2+dx,y=(a.y+b.y)/2+dy;ctx.strokeStyle="#13202b";ctx.lineWidth=4;ctx.strokeText(label,x,y);ctx.fillText(label,x,y);ctx.lineWidth=2;
    }
    dimension(screen[0],screen[1],grid.horizontal_ft+" ft width","#9ce6de",-20,-12);
    dimension(screen[right],bottom,grid.vertical_ft+" ft height","#ffd092",9,0);ctx.restore();
  }
  const timing={frame_ms:performance.now()-started,frame_interval_ms:interval,terrain_ms:terrainMS,sprites_ms:spriteMS,shadow_ms:shadowMS,render_ms:renderMS};
  const gpuStats=gpu.diagnostics(),gpuSamples=gpu.takeTimingSamples();
  profileSamples.add(timing,gpuStats,gpuSamples);captureFrame(ms,timing,gpuStats,gpuSamples);
  if(ms-profileAt>=500){profileAt=ms;profileFrame={...profileSamples.summary(),...gpuStats,...phasePool.diagnostics()};profileSamples=new FrameSamples();$("performanceStatus").textContent=JSON.stringify(profileFrame);}
  workspace.update({selected,performance:profileFrame,quality});$("status").textContent=JSON.stringify({grid,selected,selection,performance:profileFrame,face:activeFace(),selection_mode:selectionMode.value,surface_heights:profile?.heights??null,vertex:activeRef(),handles:handles.map(({layer,index,x,y})=>({layer,index,x,y})),cell:world.get(...selected),world_mode:worldMode,cutaway:cutLevel(),cutaway_center:cutCenter,moving_presentations:playback.size,bent_sprites:bent,wind_bent_sprites:windBent,wind_state_sprites:animatedFoliage,seasonal_sprites:seasonalFoliage,precipitation_instances:weatherSprites.length,selected_climate:climateAt(field,selected),wind_zones:field.zones.length,selected_wind:windAt(field,selected),interaction_events:interactionEvents,interaction_rules:interactions.rules.length,resident_chunks:world.chunkCount,active_chunks:activeChunks,active_cells:domain.length,mesh_cache_entries:meshCache.size,mesh_triangles:faces.length,visible_triangles:visible.length,vegetation_instances:sprites.length-objectInstances-scatterInstances,scatter_instances:scatterInstances,ambient_occlusion_faces:visible.filter(f=>f.occlusion?.some(v=>v>0)).length,directional_shadow_faces:sun.faces.length,shadow_budget_reached:sun.truncated,water_triangles:water.length,water_simulation:field.water_simulation===true,water_report:waterReport,point_lights:local.lights.length,point_lights_omitted:local.omitted,point_shadow:pointShadow.diagnostics,lighting:light,scatter_candidates:scatterPlan.length,scatter_families:styled?art.scatter.size:0,object_instances:objectInstances,emissive_mask_instances:maskedObjects,world_objects:world.entityCount,selected_object_view:(()=>{const e=world.getEntity($("objects").value);return e?directionalBinding(e.visual,yaw,e.orientation_steps??0).asset:null;})(),route_steps:routePreview?.ok?routePreview.path.length-1:null,unresolved_objects:unresolvedObjects,art_style:styled?art.profile.id:null,transitions:$("transitions").checked,transition_triangles:faces.filter(f=>f.attributes&&f.kind==="top").length,builder:{history:history.counts,staged_cells:editPreview.length,staged_objects:objectPreview.length,preview_sprites:ghostSprites.length,preview_omitted:previewOmitted,waypoints:waypoints.length,palette:palette.size,quality},camera:{...camera(),target_yaw:yaw,rotating:!!turn},renderer:"WebGL2",atlas_sprite:!!actor,simulation_seconds:clock.simulation.toFixed(2),visual_seconds:clock.visual.toFixed(2),effect:activeEffects.at(-1)?.instance.behavior??"none",active:activeEffects.length>0,world_effects:world.effects().length,active_effects:activeEffects.length,capture_cells:capture.size},null,2);requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$("exportDiagnostics").onclick=()=>{try{downloadJSON(JSON.parse($("status").textContent),"hex-world-diagnostics.json");}catch(e){$("message").textContent=e.message;}};
