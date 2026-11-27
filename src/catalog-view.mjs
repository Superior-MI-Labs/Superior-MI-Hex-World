// A projection of the existing catalog result list; the select remains the
// single selected asset ID. Pagination bounds image work; no extra fetch index.
const PAGE_SIZE=24;
export function bindCatalogView(){
  const $=id=>document.getElementById(id),host=$("catalogCards"),menu=$("catalogAssets"),prev=$("catalogPrev"),next=$("catalogNext"),label=$("catalogPage"),info=$("catalogSelection");
  let entries=[],page=0;
  function syncSelection(){
    for(const card of host.children)card.setAttribute("aria-pressed",String(card.dataset.asset===menu.value));
    const a=entries.find(e=>e.id===menu.value);
    info.textContent=a?[a.name,a.kind,a.license,"Art review: "+a.visual_qa].filter(Boolean).join(" · "):"No asset selected";
  }
  function render(){
    host.replaceChildren();const first=page*PAGE_SIZE,last=Math.min(entries.length,first+PAGE_SIZE);
    for(const a of entries.slice(first,last)){
      const card=document.createElement("button"),thumb=document.createElement("span"),name=document.createElement("strong"),kind=document.createElement("small");
      card.type="button";card.dataset.asset=a.id;card.title=a.name+" · "+a.id;thumb.className="catalog-thumb";name.className="catalog-name";kind.className="catalog-kind";
      const fallback=()=>{thumb.textContent=a.kind==="region"?"No preview":"Layered / animated asset";};
      if(a.thumbnail){const image=document.createElement("img");image.alt="";image.loading="lazy";image.decoding="async";image.referrerPolicy="no-referrer";image.addEventListener("error",fallback,{once:true});image.src=a.thumbnail;thumb.append(image);}else fallback();
      name.textContent=a.name;kind.textContent=[a.kind,a.visual_qa==="pending"?"Art review pending":""].filter(Boolean).join(" · ");
      card.append(thumb,name,kind);card.onclick=()=>{menu.value=a.id;menu.dispatchEvent(new Event("change",{bubbles:true}));};host.append(card);
    }
    label.textContent=entries.length?(first+1)+"–"+last+" / "+entries.length:"No results";
    prev.disabled=page===0;next.disabled=last>=entries.length;syncSelection();
  }
  prev.onclick=()=>{if(page>0){page--;render();}};next.onclick=()=>{if((page+1)*PAGE_SIZE<entries.length){page++;render();}};
  menu.addEventListener("change",()=>{
    const i=entries.findIndex(a=>a.id===menu.value);
    if(i>=0&&Math.floor(i/PAGE_SIZE)!==page){page=Math.floor(i/PAGE_SIZE);render();}else syncSelection();
  });
  return {update(matches){entries=matches;page=Math.max(0,Math.floor(entries.findIndex(a=>a.id===menu.value)/PAGE_SIZE));render();}};
}
