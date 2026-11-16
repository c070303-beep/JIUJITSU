'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 10000);
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const ALLOWED_ORIGIN = (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const MAX_DAILY = Math.max(1, Math.min(Number(process.env.DEMO_DAILY_LIMIT || 100), 1000));
const MAX_PER_SESSION = Math.max(1, Math.min(Number(process.env.DEMO_USER_DAILY_LIMIT || 20), 100));
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
const sessions = new Map();
const loginAttempts = new Map();
const sessionUsage = new Map();
let dayKey = ''; let totalToday = 0;
function out(res, code, payload, extra={}) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...extra});
  res.end(JSON.stringify(payload));
}
function page(res, body) {
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data: https://i.ytimg.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
  res.end(body);
}
function redirect(res, loc){res.writeHead(302,{'Location':loc,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end();}
function rateLimit(key,windowMs,max) {const now=Date.now();const a=(loginAttempts.get(key)||[]).filter(x=>now-x<windowMs);if(a.length>=max){loginAttempts.set(key,a);return false}a.push(now);loginAttempts.set(key,a);return true;}
function bearer(req) {
 const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim());
 const raw=cookies.find(x=>x.startsWith('rrt_session='));
 if (!raw) return null;
 const id=raw.slice(12), item=sessions.get(id);
 if(!item || item.expires<=Date.now()) {if(item)sessions.delete(id);return null;}
 return id;
}
function checkOrigin(req) {
 const v=req.headers.origin;
 if(!v) return false;
 try {const from=new URL(v);const host=req.headers.host||'';return from.protocol==='https:' && (ALLOWED_ORIGIN ? from.origin===new URL(ALLOWED_ORIGIN).origin : from.host===host);}catch{return false;}
}
async function json(req) {
 let size=0, data=[];
 for await (const chunk of req) {size+=chunk.length;if(size>20000)throw Object.assign(new Error('入力が長すぎます'),{http:413});data.push(chunk)}
 try{return JSON.parse(Buffer.concat(data).toString('utf8'))}catch{throw Object.assign(new Error('JSON形式が不正です'),{http:400})}
}
const privateLinkIntro = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>RRT｜個人試用版</title><style>*{box-sizing:border-box}body{background:#10151c;color:#f5f6fa;font-family:system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}.panel{background:#1c242e;border:1px solid #404c57;border-radius:20px;padding:24px;max-width:440px;line-height:1.8}h1{font-size:22px}p{color:#b9c5d4;font-size:14px}b{color:#f75a64}</style></head><body><main class="panel"><h1>RRT らんじぇる先生AI</h1><p>この個人試用版には、<b>パスワード入力はありません。</b></p><p>ご自身の専用リンクからアクセスしてください。リンクを開くとAIの画面に直接移動します。</p></main></body></html>`;
const SYSTEM = [
 'あなたはRRT BJJの個人試用版「らんじぇる先生 AIコーチ」です。',
 '柔術の質問は最初にトップかボトムか、開始ポジション、相手の圧力・グリップを整理。条件不足なら前提を短く明示し、一般論と特定場面を混同しないでください。',
 '初心者にも分かる簡潔な日本語で答えます。「結論→具体的な動き2〜3点→相手の反応に応じた次の一手」を優先し、質問に関係しない定型の安全説教や無用な挨拶を付けません。',
 '技が成立する理由は、重心・支点・フレーム・角度・グリップ・タイミングで説明。似た技や左右を混同せず、不明な手順は自信がないと明示します。',
 '原理の学習に使った参考記事URLや記事一覧は回答欄に出さず、要点だけ自然な日本語で説明してください。ユーザーが直接原典を求めた時だけ、特定できる参照先を提示します。',
 'ランジェル先生本人が回答または監修しているとは絶対に言わないでください。本人の独特の話し方を創作しないでください。',
 'これは試用版です。RRTの公式指導方針や特定の教則を学習済みと主張しないでください。',
 'シュラプネル・オンラインとKajabiの有料教則の動画・字幕・内容は学習していません。見たかのように装わないでください。',
 '技術を説明する場合はトップ・ボトムを区別し、相手の反応と次の選択肢が分かるように説明してください。',
 '関節技や絞め技ではタップの尊重、無理な負荷をかけないことを添えてください。',
 '柔術競技ルールは所属団体・帯・年齢・大会日時で異なり得るため、最新ルールを未確認で断言しないでください。',
 '技術の説明に役立つ無料公開YouTube動画は紹介可能です。ただし架空のURLや未確認の動画を創作しないでください。画面下部にアプリが検証済みの関連動画を自動表示します。',
 '通常の返答は日本語で120〜220字ほど。最初に結論を一文、その後に実行のコツを2〜3点。毎回長い前置き・「理由」「安全上の注意」などの定型見出しは不要です。',
 'ユーザーが「詳しく」「手順を全部」「初心者用に段階的に」等と求めたときは、詳しく説明して構いません。',
 '動画案内は柔術日記・木部亮／スプラッシュ・加古拓渡の実演・橋本知之・DEEP HALF CLUB・シュラプネル柔術テクニック・PASSGUARD FITNESSの無料公開動画を優先。リンクは回答文に捏造せず画面下の動画カードに任せる。',
 '個人情報、会員個人を特定できる記録、著作物の本文入力は避けるよう案内してください。'
].join('\n');
// Only independently written, rights-cleared, page-verified instructor notes may reach Gemini.
// The copyrighted source PDFs and all unreviewed source catalog entries remain server-side only.
function getApprovedKnowledge(question) {
 try {
  const dir=path.join(__dirname,'knowledge');
  const sources=JSON.parse(fs.readFileSync(path.join(dir,'sources.json'),'utf8')).sources || [];
  const records=JSON.parse(fs.readFileSync(path.join(dir,'techniques.json'),'utf8')).techniques || [];
  const q=String(question||'').toLowerCase();
  const approved=records.filter(t=>{
   if(!t || t.ai_enabled!==true || t.source_checked!==true || t.technical_accuracy_checked!==true ||
      t.rights_status!=='verified_for_ai_use' || typeof t.rights_evidence!=='string' || !t.rights_evidence.trim() ||
      typeof t.reviewer!=='string' || !t.reviewer.trim() || typeof t.ai_summary_ja!=='string' ||
      !t.ai_summary_ja.trim() || t.ai_summary_ja.length>1000) return false;
   const src=sources.find(x=>x.id===t.source_id);
   if(!src || src.source_access_status!=='verified' || src.ai_enabled!==true ||
      src.rights?.ai_inference_use!=='verified_for_ai_use' ||
      !Number.isInteger(src.pdf_page_count) || !Number.isInteger(t.source_pdf_page) ||
      t.source_pdf_page<1 || t.source_pdf_page>src.pdf_page_count) return false;
   const names=[t.name_ja,...(Array.isArray(t.aliases)?t.aliases:[]),t.start_position].filter(x=>typeof x==='string' && x.length>=2);
   return names.some(name=>q.includes(name.toLowerCase())) ||
      (q.includes('スイープ') && t.category==='sweep');
  }).slice(0,6);
  if(!approved.length)return '';
  const memo=approved.map(t=>'・'+String(t.name_ja||'')+'（PDF '+t.source_pdf_page+'ページ、指導メモ確認済み）: '+t.ai_summary_ja).join('\n');
  return '\n\n以下はRRTが別途作成し、内容とAIへの利用権限を確認した独立した指導メモです。原PDFの本文は送信していません。\n'+memo;
 }catch(error){
  console.warn('Knowledge catalog unavailable; disabled:',error.message);
  return '';
 }
}
// Verified public YouTube video IDs and official channel links only; never fabricated URLs.
const videoCatalog = (()=>{
 try {return JSON.parse(fs.readFileSync(path.join(__dirname,'data','public_videos.json'),'utf8'));}
 catch(e){console.warn('[Videos] catalog unavailable');return {videos:[],priority_channels:[]};}
})();
const publicVideos=videoCatalog.videos||[];
const preferredChannels=videoCatalog.priority_channels||[];
function videosForQuestion(question,history) {
 let topic=String(question||'').trim().slice(0,160);
 const meta=/^(関連|参考|おすすめ|良い|わかりやすい)?(動画|ユーチューブ|YouTube|youtube).{0,35}$|^参考にできる動画はありますか[？?]?$/i;
 if(meta.test(topic)||(topic.includes('動画')&&topic.length<32)){
  const last=(Array.isArray(history)?history:[]).slice().reverse().find(x=>x?.role==='user'&&typeof x.content==='string'&&!meta.test(x.content)&&!/動画/.test(x.content));
  topic=last?last.content.slice(0,160):'ブラジリアン柔術 基礎';
 }
 const q=topic.toLowerCase();
 const scoreTag=(tag)=> {
  const t=String(tag||'').toLowerCase();
  if(!t||!q.includes(t))return 0;
  if(['柔術','ガード','パス','スイープ','bjj','half'].includes(t))return 1;
  return 3+Math.min(12,t.length);
 };
 const ranked=preferredChannels.map(c=>{
  const best=Math.max(0,...(c.tags||[]).map(scoreTag));
  const total=(c.tags||[]).reduce((sum,t)=>sum+scoreTag(t),0);
  return {channel:c,score:best*2+total};
 }).sort((a,b)=>b.score-a.score || a.channel.priority-b.channel.priority);
 const prefer=ranked.some(x=>x.score>0)?ranked.filter(x=>x.score>0):ranked;
 const channels=prefer.slice(0,2).map(({channel:c})=>{
  const prompt=topic.replace(/(?:関連|参考)?動画|ユーチューブ|YouTube|ありますか|教えて|おすすめ|リンク/gi,' ').replace(/[？?。]/g,' ').trim().slice(0,70);
  const label=(c.name_query+' '+(prompt==='ブラジリアン柔術 基礎'?'技術':prompt)).trim();
  const url='https://www.youtube.com/results?search_query='+encodeURIComponent(label);
  return {title:c.title,url,channel_url:c.channel_url||null,search_label:label};
 });
 const preferredIds=new Set(prefer.slice(0,4).map(x=>x.channel.id));
 const directTagScore=(tag)=>{
  const t=String(tag||'').toLowerCase();
  if(['柔術','ガード','パス','パスガード','スイープ','bjj','half','ハーフ','クローズド'].includes(t))return 0;
  return scoreTag(t);
 };
 const videos=publicVideos.map(v=>{
  const score=(v.tags||[]).reduce((sum,t)=>sum+directTagScore(t),0);
  const topicConflict=(
   (q.includes('アウトサイドキャンピング') && (v.tags||[]).includes('インサイドキャンピング') && !(v.tags||[]).includes('アウトサイドキャンピング')) ||
   (q.includes('インサイドキャンピング') && (v.tags||[]).includes('アウトサイドキャンピング') && !(v.tags||[]).includes('インサイドキャンピング')) ||
   (/(相手が立|相手の足を|相手は立|立ってき|スパイダーから|スパイダーガードで)/.test(q) && /スパイダー.*パスガード/.test(v.title))
  );
  return {video:v,score:topicConflict?0:score+(score>0&&preferredIds.has(v.channel_id)?2:0)};
 }).filter(x=>x.score>=6).sort((a,b)=>b.score-a.score).slice(0,2).map(x=>{
  const v=x.video;
  return {id:v.id,title:v.title,channel:v.channel,description:v.description,url:v.watch_url,thumbnail:v.thumbnail_url,language:v.language,preview_only:!!v.preview_only};
 });
 return {videos,channels};
}

/*
 * Original BJJ coaching notes: independent short coaching ideas written for this trial.
 * They are separate from third-party PDFs, notes and paid video materials.
 * Human instructor review is still desirable before using as authoritative instruction.
 */
const originalCoachingNotes=(()=>{
 try { const d=JSON.parse(fs.readFileSync(path.join(__dirname,'knowledge','original_bjj_coaching.json'),'utf8'));return Array.isArray(d.entries)?d.entries:[]; }
 catch(e){console.warn('[Coaching] original knowledge unavailable');return [];}
})();
function matchCoachingNotes(question, history) {
 const text0=String(question||'').toLowerCase();
 const history0=(Array.isArray(history)?history:[]).slice(-4).filter(x=>x?.role==='user').map(x=>String(x.content||'')).join(' ').toLowerCase();
 const query=text0.length<20?text0+' '+history0:text0;
 const hit=originalCoachingNotes.map(n=>{
  const scores=(Array.isArray(n.tags)?n.tags:[]).map(tag=>{
   const t=String(tag).toLowerCase();
   return query.includes(t)?(3+Math.min(t.length,16)):0;
  });
  return {note:n,score:scores.length?Math.max(...scores):0};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
 if(!hit.length)return '';
 return '\n\n【個人試用用の独自作成技術メモ（暫定・特定選手監修ではない）】\n'+
  hit.map(({note:n})=>
   '◆'+n.name+'（'+n.position+'）\n'+
   '狙い:'+n.goal+'\n'+
   '動き:'+n.principle+'\n'+
   '相手の反応:'+n.reaction+'\n'+
   'よくあるミス:'+n.mistake+'\n'+
   '連係:'+n.next+'\n'+
   '注意:'+n.safety).join('\n')+
  '\nこのメモは元資料の転載でも道場の正式教則でもありません。質問に関係する箇所だけ使い、状況が不明な場合は断言しないでください。';
}

// Independent analytical insights derived from publicly reviewed article bodies and the user-uploaded PDF.
// Their source prose is NOT reproduced or sent to Gemini.
const editorialInsights=(()=>{
 try {const d=JSON.parse(fs.readFileSync(path.join(__dirname,'knowledge','editorial_reading_notes.json'),'utf8'));return Array.isArray(d.entries)?d.entries:[];}
 catch(e){console.warn('[ReadingNotes] unavailable');return [];}
})();
function readingContext(question,history) {
 const q=String(question||'').toLowerCase();
 const prior=q.length<22?(Array.isArray(history)?history:[]).slice(-3).filter(x=>x?.role==='user').map(x=>String(x.content||'')).join(' ').toLowerCase():'';
 const text=q+' '+prior;
 const matches=editorialInsights.map(n=>{
  const tags=(n.tags||[]).filter(t=>text.includes(String(t).toLowerCase()));
  const top=Math.max(0,...tags.map(t=>t.length));
  return {n,score:top+tags.length*2};
 }).filter(x=>x.score>=4).sort((a,b)=>b.score-a.score).slice(0,2);
 if(!matches.length)return '';
 return '\n\n【公開本文・ユーザー提供資料を確認して独自に整理した参考概念】\n'+
  matches.map(({n})=>'・'+n.insight_ja).join('\n')+
  '\n記事の著作権表現の再現ではなく独立した分析メモです。ソース本文を全件読んだ・動画を視聴したと主張せず、関係する原理のみ回答に利用してください。';
}

async function chat(req,res,id){
 if(!API_KEY || API_KEY.length<12)return out(res,503,{error:'Gemini APIキーがまだ設定されていません。管理者に連絡してください。'});
 const day=new Date().toISOString().slice(0,10);if(day!==dayKey){dayKey=day;totalToday=0;sessionUsage.clear()}
 const n=sessionUsage.get(id)||0;
 if(totalToday>=MAX_DAILY||n>=MAX_PER_SESSION)return out(res,429,{error:'本日の試用回数の上限に達しました。'});
 if(!rateLimit('chat:'+id,60000,8))return out(res,429,{error:'短時間に多くの質問がありました。少し時間を空けてください。'});
 const data=await json(req);
 if(typeof data.question!=='string'||!data.question.trim()||data.question.length>1500)return out(res,400,{error:'質問は1〜1500字で入力してください。'});
 const history=(Array.isArray(data.history)?data.history:[]).slice(-8).filter(x=>x && ['user','assistant'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role==='user'?'user':'model',parts:[{text:x.content.slice(0,1200)}]}));
 totalToday++;sessionUsage.set(id,n+1);
 const detailed=/(詳しく|詳細|すべて|全部|段階的に|フローチャート|長めに|徹底的|具体例を多く)/.test(data.question);
 const payload={systemInstruction:{parts:[{text:SYSTEM+getApprovedKnowledge(data.question)+matchCoachingNotes(data.question,data.history)+readingContext(data.question,data.history)}]},contents:[...history,{role:'user',parts:[{text:data.question.trim()}]}],generationConfig:{temperature:0.35,maxOutputTokens:detailed?1400:650}};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 try{
  const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(MODEL)+':generateContent';
  const request={method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':API_KEY},body:JSON.stringify(payload),signal:controller.signal};
  let response;
  for(let attempt=0;attempt<3;attempt++){
   response=await fetch(url,request);
   if(response.status!==503)break;
   console.warn('[Gemini] transient 503; model='+MODEL+' attempt='+(attempt+1)+'/3');
   if(attempt<2){
    await response.body?.cancel();
    await new Promise(resolve=>setTimeout(resolve,attempt===0?800:2000));
   }
  }
  if(response.status===503)return out(res,503,{error:'Gemini側が混雑しています。自動再試行しましたが応答できませんでした。少し時間を空けて再度お試しください。'});
  if(!response.ok){
   console.warn('[Gemini] non-success HTTP status='+response.status+' model='+MODEL);
   return out(res,response.status===429?429:502,{error:response.status===429?'Gemini APIの利用上限に達しました。':response.status===404?'Geminiモデル名を管理者が確認してください。':response.status===401||response.status===403?'Gemini APIキーの設定を確認してください。':'Gemini APIでエラーが発生しました（'+response.status+'）。'});
  }
  const result=await response.json();
  const answer=(result.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('\n').trim();
  if(!answer)return out(res,502,{error:'AIの回答を取得できませんでした。'});
  return out(res,200,{answer,model:MODEL,...videosForQuestion(data.question,data.history)});
 }catch(e){
  console.warn('[Gemini] request failure: '+(e.name==='AbortError'?'timeout':'network'));
  return out(res,502,{error:e.name==='AbortError'?'AIの応答がタイムアウトしました。':'Gemini APIへ接続できませんでした。'});
 }finally{clearTimeout(timer)}
}
const server=http.createServer((req,res)=>{(async()=>{
 const u=new URL(req.url,'https://localhost');const p=u.pathname;
 if(req.method==='GET' && p==='/healthz')return out(res,200,{ok:true});
 if(req.method==='GET'&&p==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end('User-agent: *\nDisallow: /\n')}
 // Personal trial one-tap entrance: long random token held only in Render Environment.
 // The public app/API remain session-gated; a private link creates a short-lived session.
 if(req.method==='GET' && p.startsWith('/personal/')){
  const secret=process.env.PERSONAL_TRIAL_LINK_TOKEN||'';
  const supplied=p.slice('/personal/'.length);
  const aa=Buffer.from(secret),bb=Buffer.from(supplied);
  if(secret.length<32 || bb.length!==aa.length || !crypto.timingSafeEqual(aa,bb))return out(res,404,{error:'このURLは使用できません。'});
  const session=crypto.randomBytes(32).toString('hex');
  sessions.set(session,{expires:Date.now()+12*60*60*1000});
  res.writeHead(303,{'Location':'/members/','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'rrt_session='+session+'; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax'});
  return res.end();
 }
 if(req.method==='POST' && p==='/api/login') return out(res,410,{error:'個人試用版はパスワード認証を使用しません。'});
 const id=bearer(req);
 if(req.method==='GET' && p==='/login')return id?redirect(res,'/members/'):page(res,privateLinkIntro);
 if(!id){if(req.method==='GET'&&!p.startsWith('/api/'))return redirect(res,'/login');return out(res,401,{error:'ログインが必要です。'})}
 if(req.method==='POST' && p==='/api/logout'){if(!checkOrigin(req))return out(res,403,{error:'不正なリクエストです。'});sessions.delete(id);return out(res,200,{ok:true},{'Set-Cookie':'rrt_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'});}
 if(req.method==='GET'&&['/','/members','/members/','/index.html'].includes(p))return page(res,html);
 if(req.method==='GET'&&p==='/api/status')return out(res,200,{configured:API_KEY.length>=12,model:MODEL,gated:true,shared:true,demo:true});
 if(req.method==='POST'&&p==='/api/chat'){if(!checkOrigin(req))return out(res,403,{error:'不正なリクエストです。'});return chat(req,res,id)}
 return out(res,404,{error:'見つかりません。'});
 })().catch(e=>out(res,e.http||500,{error:e.http?e.message:'サーバーエラーが発生しました。'}))});
server.listen(PORT,HOST,()=>console.log('RRT trial listening on '+HOST+':'+PORT));
