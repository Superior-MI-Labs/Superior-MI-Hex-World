// Orthographic projection shared by GPU, editor handles and CPU picking.
// Alignment is presentation only; logical yaw still indexes six authored views.
// Match actual viewport aspect at bounded backing resolution, no DPR multiplier.
export function viewportSize(width,height,{maxWidth=1600,maxHeight=1000,maxPixels=1200000}={}){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  const factor=Math.min(1,maxWidth/width,maxHeight/height,Math.sqrt(maxPixels/(width*height)));
  return {width:Math.max(1,Math.floor(width*factor)),height:Math.max(1,Math.floor(height*factor))};
}
export const VERTICAL_PROJECTION=Math.sqrt(2/3);
export function vertexDragDelta(dy,scale,grid){return dy/(scale*VERTICAL_PROJECTION*grid.vertical_ft/grid.geometry_subdivisions);}
export const cameraAngle=(yaw,alignment_deg=0)=>(yaw*60+alignment_deg)*Math.PI/180;
export function project([x,y,z],{yaw=0,alignment_deg=0,scale=24,width=900,height=450,panX=0,panY=50}={}){
  const a=cameraAngle(yaw,alignment_deg),c=Math.cos(a),s=Math.sin(a),v=x*s+y*c;
  return {x:width/2+panX+scale*(x*c-y*s),y:height/2+panY+scale*(v/Math.sqrt(3)-z*VERTICAL_PROJECTION),depth:v*VERTICAL_PROJECTION+z/Math.sqrt(3)};
}
export function pickFace(faces,x,y,view){
  let best=null,depth=-Infinity;
  for(const face of faces){
    const [a,b,c]=face.points.map(view),dx=x-a.x,dy=y-a.y;
    const ux=b.x-a.x,uy=b.y-a.y,vx=c.x-a.x,vy=c.y-a.y,det=ux*vy-uy*vx;
    if(Math.abs(det)<1e-10)continue;
    const u=(dx*vy-dy*vx)/det,v=(ux*dy-uy*dx)/det;
    if(u<-1e-8||v<-1e-8||u+v>1+1e-8)continue;
    const d=a.depth+(b.depth-a.depth)*u+(c.depth-a.depth)*v;
    if(d>depth){best=face;depth=d;}
  }
  return best;
}
export function billboard([x,y,z],yaw,width,height,pivot=[.5,1],alignment_deg=0){
  const a=cameraAngle(yaw,alignment_deg),right=[Math.cos(a),-Math.sin(a)],left=-width*pivot[0],top=height*pivot[1];
  const at=(u,v)=>[x+right[0]*u,y+right[1]*u,z+v];
  return [at(left,top),at(left+width,top),at(left+width,top-height),at(left,top-height)];
}

// Conservative screen-space bounds; caller supplies padding for upright art.
export function visibleTriangle(face,view,width,height,padding=0){
  const p=face.points.map(view);
  return Math.max(...p.map(v=>v.x))>=-padding&&Math.min(...p.map(v=>v.x))<=width+padding&&Math.max(...p.map(v=>v.y))>=-padding&&Math.min(...p.map(v=>v.y))<=height+padding;
}

// Inverse of the orthographic projection on a specified world-height plane.
export function unprojectPlane(x,y,z,{yaw=0,alignment_deg=0,scale=24,width=900,height=450,panX=0,panY=50}={}){
  if(!Number.isFinite(scale)||scale<=0)throw Error("Invalid camera scale");
  const u=(x-width/2-panX)/scale,v=((y-height/2-panY)/scale+z*VERTICAL_PROJECTION)*Math.sqrt(3);
  const a=cameraAngle(yaw,alignment_deg),c=Math.cos(a),s=Math.sin(a);
  return [u*c+v*s,-u*s+v*c,z];
}

export const wrapYaw=y=>((y%6)+6)%6;
export function turnCamera(from,target,now){return {from,to:from+wrapYaw(target-from+3)-3,started:now};}
export function sampleTurn(turn,now){
  const t=Math.max(0,Math.min(1,(now-turn.started)/250)),s=t*t*(3-2*t);
  return {yaw:turn.from+(turn.to-turn.from)*s,done:t===1};
}
export function cameraKeys(keys,dt,scale){
  const x=Number(keys.has("a"))-Number(keys.has("d")),y=Number(keys.has("w"))-Number(keys.has("s")),n=Math.max(1,Math.hypot(x,y));
  return {dx:x/n*360*dt,dy:y/n*360*dt,scale:Math.max(12,Math.min(48,scale*Math.exp((Number(keys.has("x"))-Number(keys.has("z")))*dt*1.5)))};
}
