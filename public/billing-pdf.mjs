import './vendor/pdf/jspdf.umd.min.mjs';
import {getDocument,GlobalWorkerOptions} from './vendor/pdf/pdf.mjs';
import {formatRequestTime} from './dates.mjs?v=20261119-export1';
import {renderReport,diagnosisForItem} from './reports.mjs?v=20261127-names1';
import {sha256} from './billing-export.mjs?v=20261119-export1';
GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf/pdf.worker.mjs',import.meta.url).href;
const clean=s=>String(s).normalize('NFKC').replace(/\s/g,'');
const bag=s=>[...clean(s)].sort().join('');
export function bytesBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
let fonts;
async function loadFonts(){return fonts??=Promise.all(['Regular','Bold'].map(async name=>{const r=await fetch(new URL(`./vendor/pdf/NotoSans-${name}.ttf`,import.meta.url));if(!r.ok)throw Error('PDF font could not load.');return bytesBase64(new Uint8Array(await r.arrayBuffer()));}));}
export async function generateVerifiedPDF(record,ledger,roster){
 const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-12000px;top:0;width:1000px;height:1200px;visibility:hidden';frame.setAttribute('aria-hidden','true');document.body.append(frame);
 try{
  const fontURL=n=>new URL(`./vendor/pdf/NotoSans-${n}.ttf`,import.meta.url).href;
  const css=`@font-face{font-family:ExportNoto;src:url('${fontURL('Regular')}')}@font-face{font-family:ExportNoto;src:url('${fontURL('Bold')}');font-weight:700}body{font-family:ExportNoto,sans-serif}`;
  const entries=record.snapshots.map(s=>s.entry),frozenRoster=structuredClone(record.roster||roster),frozenLedger=structuredClone(ledger);
  frozenLedger.settings.parallel=record.parallel;
  for(const s of record.snapshots){frozenLedger.patients[s.entry.patientKey]={...frozenLedger.patients[s.entry.patientKey],...s.identity};for(const p of [...frozenRoster.patients,...(frozenRoster.otherPatients||[])])if(p.key===s.entry.patientKey)Object.assign(p,s.identity);}
  await renderReport(frame,frozenLedger,frozenRoster,entries,record.layout,css);
  const doc=frame.contentDocument,allCharges=[...doc.querySelectorAll('[data-export-charge]')],expectedCount=entries.reduce((n,e)=>n+e.items.length,0);
  if(allCharges.length!==expectedCount||new Set(allCharges.map(n=>n.dataset.exportCharge)).size!==expectedCount)throw Error('PDF verification stopped: missing or duplicate charges.');
  for(const s of record.snapshots)for(const [i,item] of s.entry.items.entries()){
   const node=allCharges.find(n=>n.dataset.exportCharge===`${s.entry.id}:${i}`),text=clean(node?.textContent||'');
   const values=[s.entry.correctionOf?s.entry.correctionReason:null,item.code,diagnosisForItem(item,s.entry,s.identity.codes),item.reason,item.participants,item.requester,item.customLabel,item.start,item.end,item.requestAt?formatRequestTime(item.requestAt):null,record.layout==='patient'?String(item.units??1):null,record.layout==='patient'?s.entry.date:null,record.layout==='patient'&&i===s.entry.items.length-1?s.entry.comment:null];
   if(!node||values.filter(Boolean).some(v=>!text.includes(clean(v))))throw Error('PDF verification stopped: a billing field is missing.');
  }
  const {jsPDF}=globalThis.jspdf,pdf=new jsPDF({unit:'pt',format:'letter',compress:true,putOnlyUsedFonts:true});
  pdf.setCreationDate(new Date(record.createdAt));pdf.setFileId(record.id.replace(/-/g,'').toUpperCase());
  const loaded=await loadFonts();for(const [i,name]of ['normal','bold'].entries()){pdf.addFileToVFS(`Noto-${name}.ttf`,loaded[i]);pdf.addFont(`Noto-${name}.ttf`,'Noto',name);}
  const pages=[...doc.querySelectorAll('.page')],expected=[],regions=[];
  for(const [index,page]of pages.entries()){
   if(index)pdf.addPage();const base=page.getBoundingClientRect(),factor=.75,margin=25.2;
   const charges=page.querySelectorAll('[data-export-charge]').length;if(record.layout==='patient'?!charges:!page.querySelector('.row'))throw Error('PDF verification stopped: an empty billing page.');
   for(const el of page.querySelectorAll('.patient-banner,.unit-heading,.columns,.patient-row,.row')){const r=el.getBoundingClientRect(),c=doc.defaultView.getComputedStyle(el);if(c.backgroundColor!=='rgba(0, 0, 0, 0)'){const rgb=c.backgroundColor.match(/\d+/g)?.slice(0,3).map(Number);if(rgb){pdf.setFillColor(...rgb);pdf.rect(margin+(r.left-base.left)*factor,margin+(r.top-base.top)*factor,r.width*factor,r.height*factor,'F');}}}
   const walker=doc.createTreeWalker(page,NodeFilter.SHOW_TEXT),segments=[];let node;
   while(node=walker.nextNode()){
    if(!node.textContent.trim())continue;const style=doc.defaultView.getComputedStyle(node.parentElement),size=parseFloat(style.fontSize)*factor,bold=Number(style.fontWeight)>=600,range=doc.createRange();let line=null;
    for(let i=0;i<node.length;i++){
     range.setStart(node,i);range.setEnd(node,i+1);const r=range.getBoundingClientRect(),char=node.textContent[i];if(!r.width||!r.height)continue;
     if(r.left<base.left-.5||r.right>base.right+.5||r.top<base.top-.5||r.bottom>base.bottom+.5)throw Error('PDF verification stopped: text outside its page.');
     if(!line||Math.abs(line.top-r.top)>.5){line={text:'',left:r.left,top:r.top,bottom:r.bottom,size,bold};segments.push(line);}line.text+=char;
    }
   }
   for(const s of segments){pdf.setFont('Noto',s.bold?'bold':'normal');pdf.setFontSize(s.size);pdf.setTextColor(20,25,22);const x=margin+(s.left-base.left)*factor,y=margin+(s.top-base.top)*factor+s.size;
    if(x+pdf.getTextWidth(s.text)>margin+base.width*factor+1)throw Error('PDF verification stopped: a line would be clipped.');pdf.text(s.text,x,y);}
   expected.push(segments.map(s=>s.text).join(''));
   regions.push([...page.querySelectorAll('[data-export-charge]')].map(el=>{const r=el.getBoundingClientRect();return {text:el.textContent,left:margin+(r.left-base.left)*factor,right:margin+(r.right-base.left)*factor,top:margin+(r.top-base.top)*factor,bottom:margin+(r.bottom-base.top)*factor};}));
  }
  const bytes=new Uint8Array(pdf.output('arraybuffer'));const verification=await verifyPDF(bytes,expected,regions);
  return {bytes,hash:await sha256(bytes),verification:{...verification,entries:entries.length,charges:expectedCount,patients:new Set(entries.map(e=>e.patientKey)).size}};
 }finally{frame.remove();}
}
export async function verifyPDF(bytes,expected,regions=[]){
 const loading=getDocument({data:bytes.slice(),isEvalSupported:false}),parsed=await loading.promise;
 try{if(parsed.numPages!==expected.length)throw Error('PDF page count does not match.');for(let i=0;i<expected.length;i++){const page=await parsed.getPage(i+1),text=await page.getTextContent();if(bag(text.items.map(t=>t.str||'').join(''))!==bag(expected[i]))throw Error(`PDF verification failed on page ${i+1}: text changed or is missing.`);for(const region of regions[i]||[]){const contents=text.items.filter(t=>{const y=page.view[3]-t.transform[5];return y>region.top-.5&&y<region.bottom+1&&t.transform[4]>=region.left-.5&&t.transform[4]<region.right;}).map(t=>t.str||'').join('');if(bag(contents)!==bag(region.text))throw Error('PDF verification failed: a charge row changed or moved.');}for(const t of text.items){if(!t.str?.trim())continue;const [,,,,x,y]=t.transform;if(x<0||y<0||x+t.width>page.view[2]+1||y+t.height>page.view[3]+1)throw Error(`PDF text is clipped on page ${i+1}.`);}}return {passed:true,pages:parsed.numPages,checkedAt:new Date().toISOString()};}finally{await loading.destroy();}
}
export function downloadPDF(bytes,filename){const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
