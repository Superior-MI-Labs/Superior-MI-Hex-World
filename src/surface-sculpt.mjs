import {cornerRefs,hasVolume,uniformShape} from "./geometry.mjs";
import {cellShape,makeEditPlan} from "./editor.mjs";
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const clamp=(v,n)=>Math.max(0,Math.min(n,v));
const tri=Array.from({length:6},(_,i)=>[6,i,(i+1)%6]);
const key=a=>a.join(",");
// Current fan intervals cannot encode arbitrary slopes clipped at a Z seam.
// Refuse an unsupported triangle rather than creating an invisible cavity.
function validateStack(cells,n){
  let occupied=false,gap=false,previous=null;
  for(const c of cells){
    const s=c.shape,solid=hasVolume(s);
    if(!solid){if(occupied)gap=true;previous=null;continue;}
    assert(!gap,"Separated solid layers: use individual cell editing");
    assert(s.lower.every(h=>h===0),"Slab or overhang: use individual cell editing");
    if(previous)for(const ids of tri)if(ids.some(i=>s.upper[i]>0))
      assert(ids.every(i=>previous.upper[i]===n),"Slope crosses a layer seam: use whole surface or cell editing");
    occupied=true;previous=s;
  }
}
export function surfaceColumn(world,address,levels){
  assert(Array.isArray(levels)&&levels.length>0&&levels.length<=32&&levels.every((z,i)=>Number.isSafeInteger(z)&&(!i||z===levels[i-1]+1)),"Invalid sculpt levels");
  const [q,r]=address,n=world.config.grid.geometry_subdivisions;
  const cells=levels.map(z=>{const c=world.get(q,r,z);assert(c,"Unknown column: load before sculpting");return c;});
  validateStack(cells,n);
  const first=cells.findIndex(c=>hasVolume(c.shape));if(first<0)return null;
  const last=cells.findLastIndex(c=>hasVolume(c.shape)),base=levels[first]*n,max=(levels.at(-1)+1)*n;
  // Do not mistake an editor-window boundary for an exposed surface.
  const above=world.get(q,r,levels.at(-1)+1);
  assert(above&&!hasVolume(above.shape),"Surface continues beyond loaded sculpt levels");
  const heights=Array.from({length:7},(_,i)=>{let h=base;for(let k=first;k<=last;k++)if(cells[k].shape.upper[i]>0)h=levels[k]*n+cells[k].shape.upper[i];return h;});
  return {address:[q,r,levels[last]],base,max,heights,material:cells[last].material,cells};
}
function protect(world,edits){
  const protectedCells=new Set([...world.entities(),...world.effects()].map(e=>key(e.address)));
  for(const e of edits){
    const old=world.get(...e.address),c=old.components??{};
    assert(!protectedCells.has(key(e.address))&&!c.water?.fill&&!c.interaction_tags?.length&&!c.scatter_hidden?.length&&!c.surface?.burn,"Occupied, wet or protected terrain: use explicit cell editing");
  }
}
export function planSurfaceSculpt(world,address,index,target,{levels,connected=true,whole=false,allowed=()=>true}={}){
  assert(Number.isInteger(index)&&index>=0&&index<7&&Number.isSafeInteger(target),"Invalid sculpt target");
  const n=world.config.grid.geometry_subdivisions,source=surfaceColumn(world,address,levels);assert(source,"No solid surface");
  const refs=whole?Array.from({length:7},(_,i)=>({address,index:i})): [{address,index}];
  const delta=target-source.heights[index],columns=new Map();
  for(const ref of refs){
    const start=source.heights[ref.index],desired=whole?start+delta:target;
    for(const [j,neighbor] of (connected?cornerRefs(...ref.address,ref.index):[ref]).entries()){
      const a=neighbor.address,k=key(a.slice(0,2));
      let entry=columns.get(k);
      if(!entry){
        const profile=j===0?source:surfaceColumn(world,a,levels);
        if(!profile)continue;
        // A deliberate cliff is not permanently welded. Only matching
        // physical corner heights participate in connected editing.
        if(j!==0&&profile.heights[neighbor.index]!==start)continue;
        entry={profile,heights:[...profile.heights]};columns.set(k,entry);
      }else if(j!==0&&entry.profile.heights[neighbor.index]!==start)continue;
      assert(desired>=entry.profile.base&&desired<=entry.profile.max,"Sculpt target outside available solid band");
      entry.heights[neighbor.index]=desired;
    }
  }
  const edits=[];
  for(const {profile,heights} of columns.values()){
    const [q,r]=profile.address,next=profile.cells.map((cell,i)=>{
      const z=levels[i];if(z*n<profile.base)return cell;
      const upper=heights.map(h=>clamp(h-z*n,n));
      if(!hasVolume(cell.shape)&&!upper.some(Boolean))return cell;
      const shape={lower:Array(7).fill(0),upper};
      if(shape.upper.every((h,k)=>h===cell.shape.upper[k])&&shape.lower.every((h,k)=>h===cell.shape.lower[k]))return cell;
      const address=[q,r,z];assert(allowed(address),"Sculpt crosses active editor region");
      const value=cellShape(cell,shape,profile.material);edits.push({address,value});return value;
    });
    validateStack(next,n);
  }
  protect(world,edits);
  return makeEditPlan(world,edits,"Surface sculpt");
}
