// Fraser Health MOST, ADDI105016D, revision April 17, 2023.
// Display vocabulary only; never creates or changes a clinical order.
export const MOST_DESIGNATIONS=['CPR C2','DNACPR C2','DNACPR C1','DNACPR M3','DNACPR M2','DNACPR M1'];
export function normalizeMost(value){
 const text=String(value||'').trim().toUpperCase().replace(/DNA\s*CPR|DNR/g,'DNACPR').replace(/\s+/g,' ');
 if(MOST_DESIGNATIONS.includes(text))return text;
 if(/^(?:C1|M[123])$/.test(text))return 'DNACPR '+text;
 return '';
}
function sourceDate(text){
 const iso=text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);if(iso)return iso[0];
 const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
 const date=text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s*(?:(\d{1,2})(?:st|nd|rd|th)?[,]?\s*)?(20\d{2})\b/i);
 return date?`${date[3]}-${String(months.indexOf(date[1].toLowerCase())+1).padStart(2,'0')}-${String(date[2]||1).padStart(2,'0')}`:'';
}
export function latestDocumentedMost(evidence){
 const candidates=[];let uncertain=false,explicitConflict=false;
 const token=/\b(?:(DNACPR|DNA\s+CPR|DNR|CPR)\s+)?([CM][123])\b/gi;
 for(const line of evidence){
  if(/unresolved internal conflict|no single designation inferred/i.test(line))explicitConflict=true;
  const clauses=line.split(/(?<=[.;])\s+|,\s*(?=(?:but|earlier|previous|possible|potential|proposed)\b)|\s+\bbut\s+/i);
  for(const clause of clauses){
   const matches=[...clause.matchAll(token)];
   const transition=matches.length===2&&/\bchanged?\b/i.test(clause)&&/\bto\b/i.test(clause.slice(matches[0].index+matches[0][0].length,matches[1].index));
   const supersedes=matches.length===2&&/\bsupersedes\b/i.test(clause.slice(matches[0].index+matches[0][0].length,matches[1].index));
   for(let i=0;i<matches.length;i++){
    const m=matches[i],before=clause.slice(i?matches[i-1].index+matches[i-1][0].length:0,m.index),after=clause.slice(m.index+m[0].length,matches[i+1]?.index??clause.length);
    const status=normalizeMost(m[0]);if(!status){uncertain=true;continue;}
    // Only a proposal attached to this designation disqualifies it. A family
    // discussion accompanying a completed/documented order is not a proposal.
    const prefix=before.split(/\b(?:after|with|and)\b/i).at(-1);
    const prospective=/\b(possible|potential|propos\w*|consider\w*|future|recommend\w*)\b/i.test(prefix)&&!/\b(confirmed|ordered|established)\b/i.test(prefix);
    const proposalAfter=/^\s*(?:was\s+)?(?:propos\w*|recommend\w*|under consideration|not (?:ordered|confirmed)|not an order)\b/i.test(after);
    const blank=/\b(?:unfilled|blank|template alternatives)\b/i.test(before);
    if(prospective||proposalAfter||blank){uncertain=true;continue;}
    const historical=(transition&&i===0)||(supersedes&&i===1)||/\b(earlier|previous|prior|historical|formerly|initially)\b/i.test(before);
    const current=(transition&&i===1)||(supersedes&&i===0)||/\b(current|latest documented|review records|retains?|retained|remains?|continues?|continued|left|leave)\b/i.test(before+' '+after);
    candidates.push({status,date:sourceDate(before+' '+after),historical,current});
   }
  }
 }
 let pool=candidates.filter(c=>!c.historical);if(!pool.length)pool=candidates;
 if(pool.length>1&&pool.every(c=>c.date)){const latest=pool.map(c=>c.date).sort().at(-1);pool=pool.filter(c=>c.date===latest);}
 else {const current=pool.filter(c=>c.current);if(current.length)pool=current;}
 const statuses=[...new Set(pool.map(c=>c.status))],ambiguous=explicitConflict||statuses.length>1;
 return {designation:!ambiguous&&statuses.length===1?statuses[0]:'',pending:uncertain||ambiguous,ambiguous};
}
