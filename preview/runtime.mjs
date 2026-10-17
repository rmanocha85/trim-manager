// The same source runs behind the laptop service and as a static website.
export const CLOUD_URL='https://rmanocha85.github.io/trim-manager/';
export const LAPTOP_URL='http://127.0.0.1:4317/?connection=cloud&section=notes';
export function laptopRuntime(url=location){
  return ['127.0.0.1','localhost'].includes(url.hostname)&&['/','/index.html'].includes(url.pathname);
}
export function localNotesPlaceholder(){
  const section=document.createElement('section');section.id='rounds';section.className='tab';section.hidden=true;
  section.innerHTML='<div class="card"><h1>TRIM Notes runs on your laptop</h1><p>Open the TRIM desktop shortcut, then choose Notes. Start the shortcut first if the laptop app is closed.</p><p>Save Patients and Billing to Drive before switching. Local drafts stay in the browser where you entered them.</p><a id="open-laptop-notes" class="primary" target="_blank" rel="noopener" href="'+LAPTOP_URL+'">Open Notes on this laptop ↗</a><p class="hint">On another computer, use Patients and Billing here. Notes needs the laptop service.</p></div>';
  document.querySelector('main.content').append(section);
  return {connected:async()=>{},selectDate:async()=>{},render:()=>{},hasChanges:()=>false,beforeLock:async()=>{},save:async()=>{},status:()=>({dirty:false,busy:false,ready:false,localOnly:true})};
}
