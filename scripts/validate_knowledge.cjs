'use strict';
const fs=require('node:fs');
const path=require('node:path');
const folder=path.resolve(__dirname,'..','knowledge');
const sources=JSON.parse(fs.readFileSync(path.join(folder,'sources.json'),'utf8')).sources;
const techs=JSON.parse(fs.readFileSync(path.join(folder,'techniques.json'),'utf8')).techniques;
const ids=new Set();
for(const source of sources){
  if(!source.id||!source.source_url||!source.rights)throw Error('invalid source');
  if(ids.has(source.id))throw Error('duplicate source '+source.id);
  ids.add(source.id);
}
const techIds=new Set();
for(const tech of techs){
  if(!tech.id||!ids.has(tech.source_id)||techIds.has(tech.id))throw Error('invalid technique id '+tech.id);
  techIds.add(tech.id);
  if(tech.ai_enabled){
    const source=sources.find(s=>s.id===tech.source_id);
    const validPage=Number.isInteger(tech.source_pdf_page)&&tech.source_pdf_page>=1&&Number.isInteger(source.pdf_page_count)&&tech.source_pdf_page<=source.pdf_page_count;
    const rights=source.rights.ai_inference_use==='verified_for_ai_use'&&tech.rights_status==='verified_for_ai_use'&&typeof tech.rights_evidence==='string'&&tech.rights_evidence.trim().length>0;
    const reviews=tech.source_checked===true&&tech.technical_accuracy_checked===true&&typeof tech.reviewer==='string'&&tech.reviewer.trim().length>0;
    const safeSummary=typeof tech.name_ja==='string'&&tech.name_ja.trim().length>0&&typeof tech.ai_summary_ja==='string'&&tech.ai_summary_ja.trim().length>0&&tech.ai_summary_ja.length<=1000;
    if(!(source.source_access_status==='verified'&&source.ai_enabled===true&&validPage&&rights&&reviews&&safeSummary)){
      throw Error('Unreviewed entry cannot be enabled for AI: '+tech.id);
    }
  }
}
console.log('Validation OK: '+sources.length+' sources, '+techs.length+' techniques, '+techs.filter(x=>x.ai_enabled).length+' AI-approved.');
