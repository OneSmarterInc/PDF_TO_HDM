export function savedReviewMatches(saved,sha256,pages){
  return !!saved&&saved.sourceAudit?.sha256===sha256&&Array.isArray(saved.pages)&&saved.pages.length===pages.length&&
    saved.pages.every((p,i)=>p.number===pages[i].number&&p.width===pages[i].width&&p.height===pages[i].height&&(p.rotationDegrees||0)===(pages[i].rotationDegrees||0)&&Array.isArray(p.fields)&&p.fields.every(f=>f.reviewed===true&&typeof f.value==='string'))&&
    saved.sourceAudit.fieldsChecked===saved.pages.reduce((n,p)=>n+p.fields.length,0);
}
