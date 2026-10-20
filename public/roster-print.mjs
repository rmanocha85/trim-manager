// Keep units together when possible, repeating the heading when a large unit
// continues onto the next page. Every patient occurs once, with no roster cap.
export function rosterPrintPages(units,patients,maxRows){
  if(!Number.isInteger(maxRows)||maxRows<2)throw new Error('A print page must fit a heading and patient.');
  const ordered=[...units];
  for(const p of patients)if(!ordered.some(u=>u.id===p.unit))ordered.push({id:p.unit,name:p.unit||'OTHER'});
  const pages=[];let page=[],used=0;
  const finish=()=>{if(page.length)pages.push(page);page=[];used=0;};
  for(const unit of ordered){
    const remaining=patients.filter(p=>p.unit===unit.id).sort((a,b)=>String(a.room||'').localeCompare(String(b.room||''),undefined,{numeric:true})||String(a.name).localeCompare(String(b.name)));
    if(!remaining.length)continue;
    if(used&&remaining.length+1>maxRows-used)finish();
    let continued=false;
    while(remaining.length){
      if(maxRows-used<2)finish();
      const pts=remaining.splice(0,maxRows-used-1);
      page.push({unit,patients:pts,continued});used+=pts.length+1;
      continued=true;
      if(remaining.length)finish();
    }
  }
  finish();
  return pages;
}
