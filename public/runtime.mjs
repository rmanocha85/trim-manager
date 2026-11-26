// The same source runs behind the laptop service and as a static website.
export const CLOUD_URL='https://rmanocha85.github.io/trim-manager/';
export const NOTES_LAUNCH_URL='trim-notes://open';
export const LAPTOP_URL='http://127.0.0.1:4317/?connection=cloud&section=notes';
export function laptopRuntime(url=location){
  return ['127.0.0.1','localhost'].includes(url.hostname)&&['/','/index.html'].includes(url.pathname);
}
export function localNotesPlaceholder(){
  const section=document.createElement('section');section.id='rounds';section.className='notes-launch';section.className='tab';section.hidden=true;
  section.innerHTML='<div class="notes-launch-card"><h1>Notes</h1><p>Prepare patient notes and process clinical documents in the desktop workspace.</p><a id="open-laptop-notes" class="primary" href="'+NOTES_LAUNCH_URL+'">Open TRIM Notes</a></div>';
  document.querySelector('main.content').append(section);
  return {connected:async()=>{},selectDate:async()=>{},render:()=>{},hasChanges:()=>false,beforeLock:async()=>{},save:async()=>{},status:()=>({dirty:false,busy:false,ready:false,localOnly:true})};
}
