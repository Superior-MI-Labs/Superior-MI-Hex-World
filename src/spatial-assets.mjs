// Host-specific adapter for the canonical Atlas spatial profile. The manifest
// is authoritative; discovery metadata does not grant behavior.
import {spriteBinding} from "./entities.mjs";
export function adoptSpatialProfile(raw,asset){
  if(asset?.id!==raw.asset)throw Error("Spatial profile asset mismatch");
  const s=asset.spatial??{},next={...raw},warnings=[];
  if(next.height_ft===undefined&&s.height_ft!==undefined)next.height_ft=s.height_ft;
  if(next.wind===undefined&&s.wind!==undefined)next.wind=s.wind;
  if(next.views===undefined&&s.views){
    // The current camera has exactly six 60-degree orthographic yaw steps.
    if(s.views.assets.length===6&&Math.abs(s.views.elevation_deg-35.264)<=.01)next.views=s.views.assets;
    else warnings.push("Unsupported view profile; using front artwork as billboard");
  }
  return {binding:spriteBinding(next),warnings};
}
