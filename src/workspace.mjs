// Presentation only; existing controls and handlers remain authoritative.
export function bindWorkspace(){
  const root=document.getElementById("workspace"),inspector=document.getElementById("inspector"),paint=document.getElementById("paintTool"),toggle=document.getElementById("toggleInspector"),focus=document.getElementById("focusWorld"),exit=document.getElementById("exitFocus");
  const toolButtons=[...root.querySelectorAll("[data-tool]")],panels=[...root.querySelectorAll("[data-panel]")];
  function syncTool(){for(const b of toolButtons)b.setAttribute("aria-pressed",String(b.dataset.tool===paint.value));}
  function setInspector(hidden){root.classList.toggle("inspector-hidden",hidden);toggle.setAttribute("aria-pressed",String(hidden));toggle.textContent=hidden?"Show inspector":"Hide inspector";}
  function setFocus(active){root.classList.toggle("focus-world",active);focus.setAttribute("aria-pressed",String(active));exit.hidden=!active;toggle.disabled=active;if(!active)focus.focus({preventScroll:true});else exit.focus({preventScroll:true});}
  function openPanel(id){
    if(root.classList.contains("focus-world"))setFocus(false);setInspector(false);
    const panel=document.getElementById(id);if(!panel||!inspector.contains(panel))return;
    for(const b of panels)b.setAttribute("aria-current",String(b.dataset.panel===id));
    panel.scrollIntoView({block:"start",inline:"nearest"});
  }
  for(const b of panels)b.addEventListener("click",()=>openPanel(b.dataset.panel));
  for(const b of toolButtons)b.addEventListener("click",()=>{
    paint.value=b.dataset.tool;paint.dispatchEvent(new Event("change",{bubbles:true}));syncTool();
    const builder=paint.closest("details");builder.open=true;openPanel("terrainPanel");builder.scrollIntoView({block:"start",inline:"nearest"});
  });
  paint.addEventListener("change",syncTool);syncTool();
  toggle.addEventListener("click",()=>setInspector(!root.classList.contains("inspector-hidden")));
  focus.addEventListener("click",()=>setFocus(!root.classList.contains("focus-world")));exit.addEventListener("click",()=>setFocus(false));
  document.getElementById("showViewSettings").addEventListener("click",()=>openPanel("viewPanel"));
  const ready=document.getElementById("workspaceReady"),selection=document.getElementById("workspaceSelection"),perf=document.getElementById("workspacePerf");
  return ({selected,performance,quality})=>{
    const write=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
    write(ready,"Ready");write(selection,"Q "+selected[0]+" · R "+selected[1]+" · Z "+selected[2]);
    write(perf,"WebGL2 · "+(performance.fps??"—")+" FPS · "+quality);
  };
}
