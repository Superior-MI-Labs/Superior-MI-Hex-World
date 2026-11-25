// Orthographic projection shared by GPU, editor handles and CPU picking.
export function project([x,y,z],{yaw=0,scale=24,width=900,height=450,panX=0,panY=50}={}){
  const a=yaw*Math.PI/3,c=Math.cos(a),s=Math.sin(a),v=x*s+y*c;
  return {x:width/2+panX+scale*(x*c-y*s),y:height/2+panY+scale*(v/Math.sqrt(3)-z*Math.sqrt(2/3)),depth:v*Math.sqrt(2/3)+z/Math.sqrt(3)};
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
export function billboard([x,y,z],yaw,width,height,pivot=[.5,1]){
  const a=yaw*Math.PI/3,right=[Math.cos(a),-Math.sin(a)],left=-width*pivot[0],top=height*pivot[1];
  const at=(u,v)=>[x+right[0]*u,y+right[1]*u,z+v];
  return [at(left,top),at(left+width,top),at(left+width,top-height),at(left,top-height)];
}

// Conservative screen-space bounds; caller supplies padding for upright art.
export function visibleTriangle(face,view,width,height,padding=0){
  const p=face.points.map(view);
  return Math.max(...p.map(v=>v.x))>=-padding&&Math.min(...p.map(v=>v.x))<=width+padding&&Math.max(...p.map(v=>v.y))>=-padding&&Math.min(...p.map(v=>v.y))<=height+padding;
}

// Inverse of the orthographic projection on a specified world-height plane.
export function unprojectPlane(x,y,z,{yaw=0,scale=24,width=900,height=450,panX=0,panY=50}={}){
  if(!Number.isFinite(scale)||scale<=0)throw Error("Invalid camera scale");
  const u=(x-width/2-panX)/scale,v=((y-height/2-panY)/scale+z*Math.sqrt(2/3))*Math.sqrt(3);
  const a=yaw*Math.PI/3,c=Math.cos(a),s=Math.sin(a);
  return [u*c+v*s,-u*s+v*c,z];
}
