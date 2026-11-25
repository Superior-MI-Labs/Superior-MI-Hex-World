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
