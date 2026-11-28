// Presentation only; existing controls and handlers remain authoritative.
import {bindPanelResize} from './panel-layout.mjs';
export function bindWorkspace(){
  const root=document.getElementById("workspace"),inspector=document.getElementById("inspector"),paint=document.getElementById("paintTool"),toggle=document.getElementById("toggleInspector"),focus=document.getElementById("focusWorld"),exit=document.getElementById("exitFocus");
  const toolButtons=[...root.querySelectorAll("[data-tool]")],panels=[...root.querySelectorAll("[data-panel]")];
  const sections=[...inspector.querySelectorAll(".inspector-section")],brushFields=[...inspector.querySelectorAll("[data-brush-for]")],allBrush=document.getElementById("showBrushOptions"),procedural=inspector.querySelector("#previewGrade").closest("details");
  const hints={select:"Select cells and adjust vertices; Shift/Ctrl adds to selection.",full:"Paint full-height terrain.",half:"Paint half-height terrain.",empty:"Excavate terrain with the selected brush radius.",material:"Paint the selected material.",water:"Paint fixed water at the chosen fill.",drain:"Remove water from cells.",objects:"Paint the loaded asset or pinned palette.",eraseObjects:"Remove placed objects in the stroke."};
  function syncTool(){
    for(const b of toolButtons)b.setAttribute("aria-pressed",String(b.dataset.tool===paint.value));
    document.getElementById("activeToolName").textContent=paint.selectedOptions[0]?.textContent??"Tool";
    document.getElementById("activeToolHint").textContent=hints[paint.value]??"";
    const all=allBrush.getAttribute("aria-pressed")==="true"||procedural.open;
    for(const field of brushFields)field.hidden=!all&&!field.dataset.brushFor.split(" ").includes(paint.value);
  }
  allBrush.addEventListener("click",()=>{allBrush.setAttribute("aria-pressed",String(allBrush.getAttribute("aria-pressed")!=="true"));syncTool();});
  procedural.addEventListener("toggle",syncTool);
  function setInspector(hidden){root.classList.toggle("inspector-hidden",hidden);toggle.setAttribute("aria-pressed",String(hidden));toggle.textContent=hidden?"Show inspector":"Hide inspector";}
  function setFocus(active){root.classList.toggle("focus-world",active);focus.setAttribute("aria-pressed",String(active));exit.hidden=!active;toggle.disabled=active;if(!active)focus.focus({preventScroll:true});else exit.focus({preventScroll:true});}
  function openPanel(id){
    if(root.classList.contains("focus-world"))setFocus(false);setInspector(false);
    const panel=document.getElementById(id);if(!panel||!inspector.contains(panel))return;
    for(const b of panels)b.setAttribute("aria-current",String(b.dataset.panel===id));
    for(const s of sections)s.hidden=s!==panel;
    document.getElementById("inspectorScroll").scrollTop=0;
  }
  const dock=document.getElementById("assetDock"),dockToggle=document.getElementById("toggleLibrary"),dockTabs=[...dock.querySelectorAll("[data-dock]")],dockSections=[...dock.querySelectorAll(".dock-section")];
  function setDock(open){dock.hidden=!open;dockToggle.setAttribute("aria-expanded",String(open));}
  const workbench=root.querySelector(".workbench");
  bindPanelResize({root,handle:document.getElementById("inspectorResize"),panel:inspector,property:"--inspector-width",axis:"x",bounds:()=>[240,Math.max(240,Math.min(520,Math.floor(workbench.clientWidth*.4)))]});
  bindPanelResize({root,handle:document.getElementById("dockResize"),panel:dock,property:"--dock-height",axis:"y",bounds:()=>innerWidth<=760?[100,Math.max(100,Math.min(280,Math.floor(innerHeight*.28)))]:[120,Math.max(120,Math.min(480,Math.floor(innerHeight*.45)))]});
  function openDock(id){
    if(root.classList.contains("focus-world"))setFocus(false);setDock(true);
    if(id){for(const b of dockTabs)b.setAttribute("aria-current",String(b.dataset.dock===id));for(const s of dockSections)s.hidden=s.id!==id;}
    const detail=dockSections.find(s=>!s.hidden)?.querySelector("details");if(detail)detail.open=true;
  }
  for(const b of dockTabs)b.addEventListener("click",()=>openDock(b.dataset.dock));
  dockToggle.addEventListener("click",()=>dock.hidden?openDock():setDock(false));
  document.getElementById("closeLibrary").addEventListener("click",()=>{setDock(false);dockToggle.focus({preventScroll:true});});
  document.getElementById("openAssetLibrary").addEventListener("click",()=>openDock("catalogDock"));
  document.getElementById("openAssetPalette").addEventListener("click",()=>openDock("paletteDock"));
  for(const b of panels)b.addEventListener("click",()=>openPanel(b.dataset.panel));
  function activateTool(tool){
    if(!toolButtons.some(b=>b.dataset.tool===tool))return;
    paint.value=tool;paint.dispatchEvent(new Event("change",{bubbles:true}));
    const builder=paint.closest("details");builder.open=true;openPanel("terrainPanel");
  }
  function shortcut(key){
    if(/^[1-9]$/.test(key)){const b=toolButtons[Number(key)-1];if(b){activateTool(b.dataset.tool);return true;}}
    if(key==="b"){dock.hidden?openDock():setDock(false);return true;}
    if(key==="f"){setFocus(!root.classList.contains("focus-world"));return true;}
    return false;
  }
  for(const [i,b] of toolButtons.entries()){b.title+=" ("+(i+1)+")";b.setAttribute("aria-keyshortcuts",String(i+1));b.addEventListener("click",()=>activateTool(b.dataset.tool));}
  paint.addEventListener("change",syncTool);syncTool();openPanel("terrainPanel");
  toggle.addEventListener("click",()=>setInspector(!root.classList.contains("inspector-hidden")));
  focus.addEventListener("click",()=>setFocus(!root.classList.contains("focus-world")));exit.addEventListener("click",()=>setFocus(false));
  document.getElementById("showViewSettings").addEventListener("click",()=>openPanel("viewPanel"));
  const ready=document.getElementById("workspaceReady"),selection=document.getElementById("workspaceSelection"),perf=document.getElementById("workspacePerf"),planStatus=document.getElementById("planStatus");
  new MutationObserver(()=>{planStatus.title=planStatus.textContent;}).observe(planStatus,{childList:true,characterData:true,subtree:true});
  return {openPanel,openDock,activateTool,shortcut,closeDock:()=>setDock(false),update:({selected,performance,quality})=>{
    const write=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
    write(ready,"Ready");write(selection,"Q "+selected[0]+" · R "+selected[1]+" · Z "+selected[2]);
    write(perf,"WebGL2 · "+(performance.fps??"—")+" FPS · "+quality);
  }};
}
