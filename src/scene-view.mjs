// Read-only projection of persistent world entities; no extra scene model.
export const SCENE_PAGE_SIZE=40;
export function sceneMatches(entities,query="",level=""){
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entities.filter(e=>(level===""||String(e.address[2])===level)&&terms.every(t=>[e.id,e.visual.asset,e.address.join(",")].join(" ").toLowerCase().includes(t))).sort((a,b)=>a.address[2]-b.address[2]||a.address[0]-b.address[0]||a.address[1]-b.address[1]||a.id.localeCompare(b.id));
}
export function bindSceneView(onSelect,onFocus){
  const $=id=>document.getElementById(id),host=$("sceneObjects"),search=$("sceneSearch"),level=$("sceneLevel"),menu=$("objects"),prev=$("scenePrev"),next=$("sceneNext"),label=$("scenePage"),focus=$("focusSelectedObject");
  let entries=[],matches=[],page=0,owner=null,key="";
  function syncSelection(){
    for(const b of host.querySelectorAll("[data-entity]"))b.setAttribute("aria-pressed",String(b.dataset.entity===menu.value));
    focus.disabled=!menu.value;
  }
  function render(){
    const first=page*SCENE_PAGE_SIZE,last=Math.min(matches.length,first+SCENE_PAGE_SIZE);host.replaceChildren();let z=null;
    for(const e of matches.slice(first,last)){
      if(z!==e.address[2]){z=e.address[2];const heading=document.createElement("h3");heading.textContent="Level "+z;host.append(heading);}
      const b=document.createElement("button"),name=document.createElement("strong"),info=document.createElement("small");
      b.type="button";b.dataset.entity=e.id;name.textContent=e.visual.asset;info.textContent=e.address.join(", ")+" · "+e.id;
      b.append(name,info);b.onclick=()=>onSelect(e.id);host.append(b);
    }
    label.textContent=matches.length?(first+1)+"–"+last+" / "+matches.length:"No objects";prev.disabled=page===0;next.disabled=last>=matches.length;syncSelection();
  }
  function filter(reset=true){matches=sceneMatches(entries,search.value,level.value);if(reset)page=0;page=Math.min(page,Math.max(0,Math.ceil(matches.length/SCENE_PAGE_SIZE)-1));render();}
  search.addEventListener("input",()=>filter());level.addEventListener("change",()=>filter());prev.onclick=()=>{if(page>0){page--;render();}};next.onclick=()=>{if((page+1)*SCENE_PAGE_SIZE<matches.length){page++;render();}};
  focus.onclick=()=>onFocus(menu.value);
  menu.addEventListener("change",syncSelection);
  return {sync(world,entities){
    const nextKey=JSON.stringify(entities.map(e=>[e.id,e.address,e.visual.asset]));
    if(owner!==world||key!==nextKey){
      const old=level.value;if(owner!==world){search.value="";page=0;}
      owner=world;entries=entities;key=nextKey;const levels=[...new Set(entries.map(e=>e.address[2]))].sort((a,b)=>a-b);
      level.replaceChildren(new Option("All levels",""),...levels.map(z=>new Option("Level "+z,String(z))));level.value=levels.map(String).includes(old)?old:"";filter(false);
    }else syncSelection();
  }};
}
