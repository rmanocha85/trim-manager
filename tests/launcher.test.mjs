import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {mkdtemp,writeFile,readFile,rm,access,unlink} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
test('native launcher validates fixed actions and starts only its adjacent Notes script, with no forwarded URL', {skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'trim notes launcher-')),exe=path.join(dir,'TRIMNotesLauncher.exe');
 try{
  const compiler=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');const built=spawnSync(compiler,['/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/out:'+exe,path.resolve('launcher/TrimNotesLauncher.cs')],{encoding:'utf8',windowsHide:true});assert.equal(built.status,0,built.stdout+built.stderr);
  const marker=path.join(dir,'started.txt');await writeFile(path.join(dir,'Start-TRIM.ps1'),`param([switch]$Notes)\nif (-not $Notes -or $args.Count) { exit 9 }\n[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'started.txt'),'Notes only')\n`);
  const run=(...args)=>spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:15000});
  for(const uri of ['trim-notes://open','trim-notes://open/','TRIM-NOTES://OPEN'])assert.equal(run('--validate',uri).status,0);
  for(const uri of ['trim-notes://open?patient=0000000001','trim-notes://open#extra','trim-notes://other','trim-notes://open/extra','trim-notes://open%22%20-Command%20anything','https://example.test/','--help','']){assert.equal(run('--validate',uri).status,2);assert.equal(run(uri).status,2);}
  assert.equal(run('trim-notes://open','unexpected').status,2);await assert.rejects(access(marker));
  assert.equal(run('trim-notes://open').status,0);assert.equal(await readFile(marker,'utf8'),'Notes only');await unlink(marker);
  assert.equal(run('trim-notes://open/').status,0);assert.equal(await readFile(marker,'utf8'),'Notes only');
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await rm(dir,{recursive:true,force:true});}
});
