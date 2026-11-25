// Contact shadow geometry is projected onto the same top triangles as terrain.
export function contactShadows(faces,objects){
  const surfaces=new Map();
  for(const f of faces){if(f.kind!=="top")continue;const k=f.address.join(","),list=surfaces.get(k)??[];list.push(f);surfaces.set(k,list);}
  const out=[];
  for(const o of objects){
    if(!Number.isFinite(o.radius)||o.radius<=0)continue;
    for(const f of surfaces.get(o.address.join(","))??[])out.push({points:f.points,uv:f.points.map(([x,y])=>[.5+(x-o.point[0])/(2*o.radius),.5+(y-o.point[1])/(2*o.radius)]),opacity:o.opacity??.35});
  }
  return out;
}
