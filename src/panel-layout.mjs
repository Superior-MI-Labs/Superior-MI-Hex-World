// Presentation-only splitter; no world data or independent viewport state.
export function clampPanelSize(value,min,max){return Math.round(Math.min(Math.max(min,max),Math.max(min,value)));}
export function bindPanelResize({root,handle,panel,property,axis,bounds}){
  const size=()=>axis==="x"?panel.getBoundingClientRect().width:panel.getBoundingClientRect().height;
  const coord=e=>axis==="x"?e.clientX:e.clientY;
  let drag=null;
  function describe(){
    const [min,max]=bounds();handle.setAttribute("aria-valuemin",String(min));handle.setAttribute("aria-valuemax",String(max));handle.setAttribute("aria-valuenow",String(clampPanelSize(size(),min,max)));
  }
  function set(value){const [min,max]=bounds();root.style.setProperty(property,clampPanelSize(value,min,max)+"px");describe();}
  function reset(){root.style.removeProperty(property);describe();}
  function end(e){if(drag?.id!==e.pointerId)return;drag=null;delete handle.dataset.dragging;}
  handle.addEventListener("pointerdown",e=>{if(e.button!==0)return;e.preventDefault();handle.focus({preventScroll:true});drag={id:e.pointerId,at:coord(e),size:size()};handle.dataset.dragging="";handle.setPointerCapture(e.pointerId);});
  handle.addEventListener("pointermove",e=>{if(drag?.id===e.pointerId)set(drag.size+drag.at-coord(e));});
  for(const event of ["pointerup","pointercancel","lostpointercapture"])handle.addEventListener(event,end);
  handle.addEventListener("dblclick",reset);
  handle.addEventListener("keydown",e=>{
    const grow=axis==="x"?"ArrowLeft":"ArrowUp",shrink=axis==="x"?"ArrowRight":"ArrowDown";
    if(![grow,shrink,"Home","End"].includes(e.key))return;
    e.preventDefault();e.stopPropagation();const [min,max]=bounds();
    set(e.key==="Home"?min:e.key==="End"?max:size()+(e.key===grow?16:-16));
  });
  new ResizeObserver(describe).observe(panel);describe();
}
