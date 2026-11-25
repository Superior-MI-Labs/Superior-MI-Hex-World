// Only authored root composition events are dispatched; no arbitrary scripts or game rules.
import {visualSelection} from "./entities.mjs";
export function appearanceOptions(contract,selection={}){
  if(contract.kind!=="composition")return null;
  const resolved=globalThis.VisualAtlasSlots.resolve(contract,selection.preset,selection.slots);
  return {...resolved,inputs:{...resolved.inputs,...selection.inputs}};
}
export function dispatchAppearance(contract,selection,event){
  if(contract.kind!=="composition"||!Object.hasOwn(contract.behavior?.on??{},event))return null;
  const resolved=appearanceOptions(contract,selection),r=globalThis.VisualAtlasInteraction.dispatch(contract,resolved.inputs,event);
  return {selection:visualSelection({...selection,inputs:r.values}),outputs:r.outputs,events:r.events};
}

// Host authorization: materialize the one resolved input used by a physical
// condition. Never infer physical behavior from a visual manifest alone.
export function collisionSelection(contract,selection,collider){
  const d=collider?.disabled_when;if(!d)return visualSelection(selection);
  const def=contract.kind==="composition"&&Object.hasOwn(contract.inputs??{},d.input)?contract.inputs[d.input]:null;
  if(!def||!globalThis.VisualAtlasSlots.accepts(def,d.equals))throw Error("Collider condition must reference a compatible Atlas input");
  const value=appearanceOptions(contract,selection).inputs[d.input];
  if(!globalThis.VisualAtlasSlots.accepts(def,value))throw Error("Invalid resolved collision input");
  return visualSelection({...selection,inputs:{...selection.inputs,[d.input]:value}});
}
