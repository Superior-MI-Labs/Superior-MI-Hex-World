// Logical editable faces are not render triangles. A clipped side still
// exposes its owning cell's four original control vertices.
export function faceKey(face){
  if(face?.kind==="top")return "upper";
  if(face?.kind==="bottom")return "lower";
  if(face?.kind==="side"&&Number.isInteger(face.edge)&&face.edge>=0&&face.edge<6)return "side:"+face.edge;
  throw Error("Invalid face");
}
export function faceHandles(key){
  if(key==="upper"||key==="lower")return Array.from({length:7},(_,index)=>({layer:key,index}));
  if(!/^side:[0-5]$/.test(key))throw Error("Invalid editable face");
  const i=Number(key.slice(5)),j=(i+1)%6;
  return [{layer:"upper",index:i},{layer:"upper",index:j},{layer:"lower",index:j},{layer:"lower",index:i}];
}
export const handleKey=({layer,index})=>layer+":"+index;
export function handleLabel({layer,index}){return (layer==="upper"?"Upper":"Lower")+" "+(index===6?"center":index+1);}
export function nearestHandle(handles,x,y,preferred,radius=15){
  let best=null,d=radius;
  for(const h of handles){
    const dist=Math.hypot(x-h.x,y-h.y);
    if(dist<d-1e-8||(best&&Math.abs(dist-d)<=1e-8&&handleKey(h)===preferred)){best=h;d=dist;}
  }
  return best;
}
