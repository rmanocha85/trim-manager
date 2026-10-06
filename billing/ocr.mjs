// OCR is executed inside a local browser worker. Only static engine/language files are fetched.
export async function readScreenshot(blob,onProgress=()=>{},signal){
  if(!['image/png','image/jpeg','image/webp'].includes(blob.type)||blob.size>12_000_000)throw new Error('Paste a PNG, JPG or WebP screenshot smaller than 12 MB.');
  const bitmap=await createImageBitmap(blob);
  if(bitmap.width*bitmap.height>24_000_000){bitmap.close();throw new Error('Screenshot is too large. Copy just the patient demographics area.');}
  bitmap.close();
  const {default:{createWorker}}=await import('./vendor/ocr/tesseract.esm.min.js');
  if(signal?.aborted)throw new Error('Cancelled.');
  const base=new URL('./vendor/ocr/',import.meta.url).href;
  let worker,stopped=false,rejectStop;
  const cancelled=new Promise((_,reject)=>{rejectStop=reject;});
  const stop=()=>{stopped=true;worker?.terminate();rejectStop(new Error('Cancelled.'));};
  signal?.addEventListener('abort',stop,{once:true});
  const timeout=setTimeout(stop,45000);
  try{
    worker=await Promise.race([createWorker('eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base,workerBlobURL:false,cacheMethod:'none',logger:m=>{if(!stopped)onProgress(m.status==='recognizing text'?`Reading screenshot… ${Math.round(m.progress*100)}%`:'Loading on-device reader…');},errorHandler:()=>rejectStop(new Error('Reader unavailable.'))}).then(w=>{if(stopped){w.terminate();throw new Error('Cancelled.');}return w;}),cancelled]);
    if(signal?.aborted)throw new Error('Cancelled.');
    await Promise.race([worker.setParameters({tessedit_pageseg_mode:'11'}),cancelled]);
    const {data}=await Promise.race([worker.recognize(blob),cancelled]);return data.text;
  }finally{stopped=true;clearTimeout(timeout);signal?.removeEventListener('abort',stop);await worker?.terminate();}
}
