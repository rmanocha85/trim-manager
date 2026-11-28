import {nurseMessages} from './nurse-messages.mjs?v=20261122-symbol-menu1';

export function nurseMessageDialog(root){
  const dialog=document.createElement('dialog');dialog.id='nurse-message-dialog';dialog.setAttribute('aria-labelledby','nurse-message-title');
  dialog.innerHTML='<div class="nurse-dialog-heading"><h2 id="nurse-message-title">Nurse updates</h2><button type="button" class="btn btn-ghost" data-close-nurses aria-label="Close nurse updates">Close</button></div><label>Include <select aria-label="Nurse message roster"><option value="all">All patients</option><option value="patients">My Patients</option><option value="otherPatients">Other Patients</option></select></label><p class="nurse-context"></p><p class="nurse-help">Edit the wording or delete patient blocks below. This does not change the roster or resolve issues.</p><div class="nurse-unassigned" hidden></div><div class="nurse-groups"></div><p role="status" aria-live="polite"></p>';
  root.append(dialog);
  let source,scope='all',lastSignature='',originals=[];
  const select=dialog.querySelector('select'),status=dialog.querySelector('[role=status]');
  const edited=()=>[...dialog.querySelectorAll('textarea')].some((field,i)=>field.value!==originals[i]);
  function render(nextScope,force=false){
    const {roster,dirty}=source(),result=nurseMessages(roster,nextScope),signature=JSON.stringify({scope:nextScope,result});
    if(!force&&signature===lastSignature)return true;
    if(edited()&&!window.confirm('Replace your edited nurse drafts with the current selection?')){select.value=scope;status.textContent='Kept your edited drafts. They have not been refreshed from the current roster.';return false;}
    scope=nextScope;select.value=scope;lastSignature=signature;originals=result.groups.map(g=>g.text);status.textContent='';
    dialog.querySelector('.nurse-context').textContent=`${result.total} patients with active issues · Search filters do not limit this list.${dirty?' Includes unsaved roster changes.':''}`;
    const pending=dialog.querySelector('.nurse-unassigned');pending.replaceChildren();pending.hidden=!result.unassigned.length;
    if(result.unassigned.length){const title=document.createElement('strong');title.textContent=`${result.unassigned.length} ${result.unassigned.length===1?'patient needs':'patients need'} a location review — excluded from both drafts`;pending.append(title);const list=document.createElement('ul');for(const p of result.unassigned){const item=document.createElement('li');item.textContent=`${p.name} — ${p.location}: ${p.reason}`;list.append(item);}pending.append(list);}
    const groups=dialog.querySelector('.nurse-groups');groups.replaceChildren();
    for(const group of result.groups){
      const section=document.createElement('section'),title=document.createElement('h3'),field=document.createElement('textarea'),actions=document.createElement('div'),copy=document.createElement('button'),open=document.createElement('a');
      const groupTitle=`${group.label} · ${group.rows.length} ${group.rows.length===1?'patient':'patients'}`;
      section.dataset.nurseGroup=group.id;title.textContent=groupTitle;
      field.rows=12;field.value=group.text;field.setAttribute('aria-label',group.label+' message');field.placeholder='No patients with active issues in this group.';
      actions.className='nurse-actions';copy.type='button';copy.className='btn btn-green';copy.textContent='Copy message';copy.disabled=!field.value.trim();
      field.oninput=()=>{copy.disabled=!field.value.trim();title.textContent=field.value===group.text?groupTitle:group.label+' · edited draft';status.textContent='';};
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(field.value);status.textContent=group.label+' copied. Paste into your nurse conversation.';}catch{field.focus();field.select();status.textContent='Select and copy the highlighted text.';}};
      open.textContent='Open Google Messages';open.href='https://messages.google.com/web/';open.target='_blank';open.rel='noopener noreferrer';
      actions.append(copy,open);section.append(title,field,actions);groups.append(section);
    }
    return true;
  }
  select.onchange=()=>render(select.value);
  dialog.querySelector('[data-close-nurses]').onclick=()=>dialog.close();
  return {show(getSource,nextScope){source=getSource;render(nextScope);dialog.showModal();}};
}
