import {mkdir,writeFile} from 'node:fs/promises';
// Compatibility routes share the same origin and therefore retain encrypted drafts.
for(const [directory,target] of [['.','./public/'],['billing','../public/']]){
  await mkdir(directory,{recursive:true});
  await writeFile(directory+'/index.html','<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TRIM</title><script src="./open-trim.js" defer></script><p>Opening unified TRIM… <a href="'+target+'">Open TRIM</a></p></html>\n');
  await writeFile(directory+'/open-trim.js','location.replace(new URL('+JSON.stringify(target)+'+location.search+location.hash,location.href));\n');
}
await writeFile('.nojekyll','');
