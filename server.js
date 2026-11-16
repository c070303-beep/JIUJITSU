'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 10000);
const SECRET = process.env.DEMO_ACCESS_CODE || '';
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const ALLOWED_ORIGIN = (process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const MAX_DAILY = Math.max(1, Math.min(Number(process.env.DEMO_DAILY_LIMIT || 100), 1000));
const MAX_PER_SESSION = Math.max(1, Math.min(Number(process.env.DEMO_USER_DAILY_LIMIT || 20), 100));
if (SECRET.length < 12) { console.error('DEMO_ACCESS_CODE must be at least 12 characters. Set it in Render Environment.'); process.exit(1); }
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
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
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
const loginPage = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>RRT BJJ｜試用版ログイン</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;margin:0;background:radial-gradient(circle at 12% 10%,#40202c,transparent 45%),#10151c;color:#f5f6fa;padding:18px}.box{max-width:430px;width:100%;border:1px solid #414b58;border-radius:24px;background:#1c242e;padding:28px;box-shadow:0 20px 75px #0004}.mark{background:#ed4756;color:#fff;font-size:20px;font-weight:900;width:56px;height:56px;border-radius:17px;display:grid;place-items:center}h1{font-size:26px;margin:18px 0 8px}p{line-height:1.75;color:#b9c5d4;font-size:14px}label{font-size:13px;font-weight:800;display:block;margin:24px 0 7px}input{width:100%;padding:16px;background:#111923;border:1px solid #576271;color:white;border-radius:11px;font:inherit}button{border:0;width:100%;background:#ec4854;border-radius:12px;padding:16px;color:white;font-weight:900;font-size:16px;margin-top:14px;cursor:pointer}small{color:#9daabd;display:block;line-height:1.7;margin-top:18px}.msg{color:#ffb9bd;min-height:24px;margin-top:11px;font-size:13px}</style></head><body><div class="box"><div class="mark">RRT</div><h1>らんじぇる先生 AIコーチ</h1><p>インストラクター向けの試用版です。共有された合言葉を入力してください。AIの回答は本人監修ではありません。</p><form id="f"><label for="code">試用用の合言葉</label><input id="code" type="password" autocomplete="off" required autofocus placeholder="合言葉を入力"><button type="submit">試用版を開く</button></form><div id="msg" class="msg" role="status"></div><small>質問文はGemini APIに送信されます。個人情報や有料教則の本文は入力しないでください。</small></div><script>document.getElementById('f').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button'),m=document.getElementById('msg');b.disabled=true;m.textContent='確認しています…';try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value})});const j=await r.json();if(r.ok)location.replace('/members/');else m.textContent=j.error||'認証できませんでした';}catch{m.textContent='接続できませんでした';}finally{b.disabled=false}};</script></body></html>`;
const SYSTEM = [
 'あなたはRRT BJJのインストラクター試用版「らんじぇる先生 AIコーチ」です。',
 '質問には初心者にも分かる簡潔な日本語で直接答え、理由と安全上の注意を示します。',
 'ランジェル先生本人が回答または監修しているとは絶対に言わないでください。本人の独特の話し方を創作しないでください。',
 'これは試用版です。RRTの公式指導方針や特定の教則を学習済みと主張しないでください。',
 'シュラプネル・オンラインとKajabiの有料教則の動画・字幕・内容は学習していません。見たかのように装わないでください。',
 '技術を説明する場合はトップ・ボトムを区別し、相手の反応と次の選択肢が分かるように説明してください。',
 '関節技や絞め技ではタップの尊重、無理な負荷をかけないことを添えてください。',
 '柔術競技ルールは所属団体・帯・年齢・大会日時で異なり得るため、最新ルールを未確認で断言しないでください。',
 '動画、YouTube、URL、外部サイトの案内は表示しないでください。',
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
 const payload={systemInstruction:{parts:[{text:SYSTEM+getApprovedKnowledge(data.question)}]},contents:[...history,{role:'user',parts:[{text:data.question.trim()}]}],generationConfig:{temperature:0.4,maxOutputTokens:1400}};
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),35000);
 try{
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(MODEL)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':API_KEY},body:JSON.stringify(payload),signal:controller.signal});
  if(!response.ok){return out(res,response.status===429?429:502,{error:response.status===429?'Gemini APIの利用上限に達しました。':response.status===404?'Geminiモデル名を管理者が確認してください。':response.status===401||response.status===403?'Gemini APIキーの設定を確認してください。':'Gemini APIでエラーが発生しました（'+response.status+'）。'});}
  const result=await response.json();
  const answer=(result.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('\n').trim();
  if(!answer)return out(res,502,{error:'AIの回答を取得できませんでした。'});
  return out(res,200,{answer,model:MODEL});
 }catch(e){return out(res,502,{error:e.name==='AbortError'?'AIの応答がタイムアウトしました。':'Gemini APIへ接続できませんでした。'});}finally{clearTimeout(timer)}
}
const server=http.createServer((req,res)=>{(async()=>{
 const u=new URL(req.url,'https://localhost');const p=u.pathname;
 if(req.method==='GET' && p==='/healthz')return out(res,200,{ok:true});
 if(req.method==='GET'&&p==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end('User-agent: *\nDisallow: /\n')}
 if(req.method==='POST' && p==='/api/login'){
  if(!checkOrigin(req))return out(res,403,{error:'不正なリクエストです。'});
  if(!rateLimit('login:'+(req.socket.remoteAddress||''),300000,10))return out(res,429,{error:'ログイン試行が多すぎます。'});
  const b=await json(req);const input=Buffer.from(String(b.code||''));const correct=Buffer.from(SECRET);
  if(input.length!==correct.length||!crypto.timingSafeEqual(input,correct))return out(res,401,{error:'合言葉が違います。'});
  const token=crypto.randomBytes(32).toString('hex');
  sessions.set(token,{expires:Date.now()+12*60*60*1000});
  return out(res,200,{ok:true},{'Set-Cookie': 'rrt_session='+token+'; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax'});
 }
 const id=bearer(req);
 if(req.method==='GET' && p==='/login')return id?redirect(res,'/members/'):page(res,loginPage);
 if(!id){if(req.method==='GET'&&!p.startsWith('/api/'))return redirect(res,'/login');return out(res,401,{error:'ログインが必要です。'})}
 if(req.method==='POST' && p==='/api/logout'){if(!checkOrigin(req))return out(res,403,{error:'不正なリクエストです。'});sessions.delete(id);return out(res,200,{ok:true},{'Set-Cookie':'rrt_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'});}
 if(req.method==='GET'&&['/','/members','/members/','/index.html'].includes(p))return page(res,html);
 if(req.method==='GET'&&p==='/api/status')return out(res,200,{configured:API_KEY.length>=12,model:MODEL,gated:true,shared:true,demo:true});
 if(req.method==='POST'&&p==='/api/chat'){if(!checkOrigin(req))return out(res,403,{error:'不正なリクエストです。'});return chat(req,res,id)}
 return out(res,404,{error:'見つかりません。'});
 })().catch(e=>out(res,e.http||500,{error:e.http?e.message:'サーバーエラーが発生しました。'}))});
server.listen(PORT,HOST,()=>console.log('RRT trial listening on '+HOST+':'+PORT));
