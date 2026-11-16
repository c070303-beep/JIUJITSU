'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const coach = require('./lib/coach.cjs');

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
const trialOpenPage = privateLinkIntro.replace(/<main[\s\S]*<\/body>/, 
  '<main class="panel"><h1>RRT らんじぇる先生AI</h1><p id="trial-open-status" role="status">専用リンクを確認しています。</p></main>' +
  '<script>(async()=>{' +
  'const status=document.getElementById("trial-open-status");' +
  'const token=location.hash.slice(1);' +
  'if(!/^[0-9a-f]{64}$/.test(token)){status.textContent="専用リンクをもう一度開いてください。";return;}' +
  'try{const response=await fetch("/api/trial-link",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});' +
  'if(response.ok){location.replace("/members/");return;}' +
  'status.textContent=response.status===404?"この専用リンクは使用できません。":"接続できませんでした。ページを再読み込みしてください。";' +
  '}catch{status.textContent="接続できませんでした。ページを再読み込みしてください。";}' +
  '})()</script></body>'
);

function issueTrialCookie() {
 const session = crypto.randomBytes(32).toString('hex');
 sessions.set(session,{expires:Date.now()+12*60*60*1000});
 return 'rrt_session='+session+'; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax';
}

function reserveQuestion(id, res) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayKey) {
    dayKey = today;
    totalToday = 0;
    sessionUsage.clear();
  }
  const count = sessionUsage.get(id) || 0;
  if (totalToday >= MAX_DAILY || count >= MAX_PER_SESSION) {
    out(res, 429, {error:'本日の試用回数の上限に達しました。'});
    return false;
  }
  if (!rateLimit('chat:' + id, 60000, 8)) {
    out(res, 429, {error:'短時間に多くの質問がありました。少し時間を空けてください。'});
    return false;
  }
  totalToday++;
  sessionUsage.set(id, count + 1);
  return true;
}

async function selectWithGemini(payload, route) {
  try {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(MODEL) + ':generateContent';
    const response = await fetch(endpoint, {
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':API_KEY},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.warn('[Gemini] selection failed, HTTP ' + response.status);
      return null;
    }
    return coach.readSelection(await response.json(), route);
  } catch (error) {
    console.warn('[Gemini] selection unavailable: ' +
      (error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'request error'));
    return null;
  }
}

async function chat(req, res, id) {
  const data = await json(req);
  if (typeof data?.question !== 'string' || !data.question.trim() || data.question.length > 1500) {
    return out(res, 400, {error:'質問は1〜1500字で入力してください。'});
  }
  if (!reserveQuestion(id, res)) return;
  const route = coach.resolve(data.question, data.history, data.selection);
  const videos = coach.videoCards(route);
  const payload = API_KEY.length >= 12 ? coach.selectPayload(route, data.question) : null;
  const choice = payload ? await selectWithGemini(payload, route) : null;
  const resolved = coach.interpretRoute(route, choice);
  const answer = coach.renderAnswer(resolved, route.semantic ? null : choice, videos);
  const mode = choice ? 'gemini' : resolved.kind === 'guidance' || resolved.videoOnly ? 'guidance' : 'knowledge';
  return out(res, 200, {answer, model:MODEL, mode, videos, choices:resolved.choices || []});
}

function videosForQuestion(question, context, selection) {
  if (typeof question !== 'string' || question.length > 1500) return {videos:[]};
  const history = typeof context === 'string' && context.length
    ? [{role:'user', content:context.slice(0, 240)}] : [];
  return {videos:coach.videoCards(coach.resolve(question, history, selection))};
}

const server=http.createServer((req,res)=>{(async()=>{
 const u=new URL(req.url,'https://localhost');const p=u.pathname;
 if(req.method==='GET' && p==='/healthz')return out(res,200,{ok:true, knowledge:'2.0'});
 if(req.method==='GET'&&p==='/robots.txt'){res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});return res.end('User-agent: *\nDisallow: /\n')}
 if (req.method === 'GET' && p === '/open') {
  return bearer(req) ? redirect(res, '/members/') : page(res, trialOpenPage);
 }
 if (req.method === 'POST' && p === '/api/trial-link') {
  if (!checkOrigin(req)) return out(res, 403, {error:'不正なリクエストです。'});
  const {token} = (await json(req)) || {};
  const digest = process.env.PERSONAL_TRIAL_OPEN_TOKEN_SHA256 || '';
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token) || !/^[0-9a-f]{64}$/.test(digest)) {
   return out(res, 404, {error:'このURLは使用できません。'});
  }
  const submitted = crypto.createHash('sha256').update(token).digest();
  if (!crypto.timingSafeEqual(submitted, Buffer.from(digest, 'hex'))) {
   return out(res, 404, {error:'このURLは使用できません。'});
  }
  return out(res, 200, {ok:true}, {'Set-Cookie':issueTrialCookie()});
 }
 if(req.method==='GET' && p.startsWith('/personal/')){
  const secret=process.env.PERSONAL_TRIAL_LINK_TOKEN||'';
  const supplied=p.slice('/personal/'.length);
  const aa=Buffer.from(secret),bb=Buffer.from(supplied);
  if(secret.length<32 || bb.length!==aa.length || !crypto.timingSafeEqual(aa,bb))return out(res,404,{error:'このURLは使用できません。'});
  res.writeHead(303,{'Location':'/members/','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':issueTrialCookie()});
  return res.end();
 }
 if(req.method==='POST' && p==='/api/login') return out(res,410,{error:'個人試用版はパスワード認証を使用しません。'});
 const id=bearer(req);
 if(req.method==='GET' && p==='/login')return id?redirect(res,'/members/'):page(res,privateLinkIntro);
 if(!id){if(req.method==='GET'&&!p.startsWith('/api/'))return redirect(res,'/login');return out(res,401,{error:'ログインが必要です。'})}
 if(req.method==='POST' && p==='/api/logout'){if(!checkOrigin(req))return out(res,403,{error:'不正なリクエストです。'});sessions.delete(id);return out(res,200,{ok:true},{'Set-Cookie':'rrt_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'});}
 if(req.method==='GET'&&['/','/members','/members/','/index.html'].includes(p))return page(res,html);
 if(req.method==='GET'&&p==='/api/status')return out(res,200,{configured:API_KEY.length>=12,model:MODEL,gated:true,shared:true,demo:true});
 if (p === '/api/videos' && req.method === 'POST') {
   if (!checkOrigin(req)) return out(res, 403, {error:'不正なリクエストです。'});
   const data = await json(req);
   return out(res, 200, videosForQuestion(data?.question, data?.context, data?.selection));
 }
 if (p === '/api/videos' && req.method === 'GET') {
   return out(res, 200, videosForQuestion(u.searchParams.get('q'), u.searchParams.get('context')));
 }

 if(req.method==='POST'&&p==='/api/chat'){if(!checkOrigin(req))return out(res,403,{error:'不正なリクエストです。'});return chat(req,res,id)}
 return out(res,404,{error:'見つかりません。'});
 })().catch(e=>out(res,e.http||500,{error:e.http?e.message:'サーバーエラーが発生しました。'}))});
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log('RRT trial listening on ' + HOST + ':' + PORT));
}
module.exports = server;
