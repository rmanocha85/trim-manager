import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateOatRoster} from './public/oat-roster-repository.mjs';
export class OatStore {
  constructor(filename){this.filename=filename;}
  async load(){
    const text=await readFile(this.filename,'utf8');
    return {roster:validateOatRoster(JSON.parse(text)),etag:createHash('sha256').update(text).digest('hex')};
  }
}
