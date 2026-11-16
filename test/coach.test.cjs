'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const {createHash,randomBytes} = require('node:crypto');
const {once} = require('node:events');
const path = require('node:path');
const coach = require('../lib/coach.cjs');
const fixtures = require('./coaching-cases.json');

for (const fixture of fixtures) {
  test(fixture.id + ' ' + fixture.question, () => {
    const route = coach.resolve(fixture.question, fixture.history);
    assert.deepEqual(route.records.map(record => record.id), fixture.expected);
    if (fixture.option) assert.deepEqual(route.options.map(option => option.id), [fixture.option]);
    const cards = coach.videoCards(route);
    assert.deepEqual(cards.map(video => video.id), fixture.videos);
    for (const card of cards) {
      assert.equal(card.url, 'https://www.youtube.com/watch?v=' + card.id);
      assert.equal(card.thumbnail, 'https://i.ytimg.com/vi/' + card.id + '/hqdefault.jpg');
    }
    const answer = coach.renderAnswer(route, null, cards);
    assert(answer.includes(fixture.includes), answer);
    for (const phrase of fixture.excludes || []) assert(!answer.includes(phrase), answer);
    assert(!/https?:\/\//i.test(answer), answer);
    if (route.records.length && !route.videoOnly && !route.detailed) {
      assert(answer.length >= 65 && answer.length <= 250, String(answer.length));
    }
    const request = coach.selectPayload(route, fixture.question);
    if (request) {
      assert.equal(route.kind, 'technique');
      const item = JSON.parse(request.contents[0].parts[0].text);
      assert.equal(item.role, route.records[0].top_or_bottom);
      assert.deepEqual(item.options.map(option => option.id), route.options.map(option => option.id));
      for (const key of ['source_refs','rights','videos','legacy_ids']) assert(!Object.hasOwn(item, key), key);
      assert(request.generationConfig.maxOutputTokens <= 400);
    }
  });
}

test('Obvious contact details and a dedicated trial link never reach Gemini', () => {
  for (const question of [
    'ハーフガードを教えて test@example.invalid',
    'ニーカットを教えて 090-1234-5678',
    'ドッグファイト https://example.invalid/personal/' + randomBytes(32).toString('hex'),
    'コヨーテについて https://example.invalid/open#' + randomBytes(32).toString('hex'),
  ]) {
    const route = coach.resolve(question);
    assert.equal(route.kind, 'guidance');
    assert.equal(coach.selectPayload(route, question), null);
    assert.deepEqual(coach.videoCards(route), []);
    assert(!coach.renderAnswer(route).includes('example.invalid'));
  }
});

test('A current named technique wins over an unrelated prior question', () => {
  const old = [{role:'user', content:'インサイドキャンピングで制御したい'}];
  const route = coach.resolve('アメリカーナを教えて', old);
  assert.equal(route.records[0].id, 'americana');
  assert(!coach.selectPayload(route, 'アメリカーナを教えて').contents[0].parts[0].text.includes('インサイドキャンピング'));
});

test('Selection can change the next step only within the allowed record', () => {
  const question = 'ドッグファイトの基本は？';
  const route = coach.resolve(question);
  const response = value => ({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]});
  const selected = coach.readSelection(response({tip:'0',option:'far-knee'}), route);
  assert.equal(selected.option, 'far-knee');
  assert.match(coach.renderAnswer(route, selected), /ニータップ/);
  assert.equal(coach.readSelection(response({tip:'0',option:'made-up'}), route), null);
  assert.equal(coach.readSelection(response({tip:'0',option:'forward',answer:'untrusted prose'}), route), null);
  assert.equal(coach.readSelection(response({tip:'99',option:'forward'}), route), null);
  const exact = coach.resolve('ドッグファイトで遠い膝を取れる');
  assert.equal(coach.selectPayload(exact,'ドッグファイトで遠い膝を取れる'), null);
});

test('Trial HTTP keeps authorization, selects through mocked Gemini, and serves videos independently', async t => {
  const nativeFetch = global.fetch;
  const secret = randomBytes(32).toString('hex');
  const newSecret = randomBytes(32).toString('hex');
  const origin = 'https://rrt.test.invalid';
  const env = {
    PERSONAL_TRIAL_LINK_TOKEN:secret,
    PERSONAL_TRIAL_OPEN_TOKEN_SHA256:createHash('sha256').update(newSecret).digest('hex'), GEMINI_API_KEY:'mocked-api-key-for-tests',
    PUBLIC_ORIGIN:origin, GEMINI_MODEL:'gemini-2.5-flash-lite',
    DEMO_DAILY_LIMIT:'100', DEMO_USER_DAILY_LIMIT:'20',
  };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let calls = 0;
  let simulate = 'ok';
  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) throw Error('Unexpected upstream');
    calls++;
    if (simulate === '503') return new Response('{}',{status:503});
    if (simulate === '429') return new Response('{}',{status:429});
    const payload = JSON.parse(options.body);
    assert(payload.generationConfig?.responseSchema?.properties?.option?.enum.includes('far-knee'));
    const selection = simulate === 'invalid'
      ? {tip:'0',option:'invented',url:'https://example.invalid'} : {tip:'0',option:'far-knee'};
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(selection)}]}}]});
  };
  const server = require('../server.js');
  t.after(async () => {
    global.fetch = nativeFetch;
    for (const [name,value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    server.close();
    await once(server,'close');
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (url, options={}) => nativeFetch(base + url, {redirect:'manual',...options});
  const login = async () => {
    const response = await get('/personal/' + secret);
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),'/members/');
    assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure/);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const post = (url, cookie, data, requestOrigin=origin) => get(url,{
    method:'POST', headers:{cookie,origin:requestOrigin,'content-type':'application/json'}, body:JSON.stringify(data),
  });
  const health = await (await get('/healthz')).json();
  assert.equal(health.knowledge,'2.0');
  assert.equal((await get('/members/')).headers.get('location'),'/login');
  assert.equal((await get('/api/status')).status,401);
  const page = await get('/open');
  assert.equal(page.status,200);
  const opener = await page.text();
  assert(opener.includes('location.hash.slice(1)'));
  assert(opener.includes('location.replace("/members/")'));
  assert(!opener.includes(newSecret));

  const rejected = await post('/api/trial-link','',{token:randomBytes(32).toString('hex')});
  assert.equal(rejected.status,404);
  assert.equal(rejected.headers.get('set-cookie'),null);
  assert.equal((await post('/api/trial-link','',{token:newSecret},'https://foreign.invalid')).status,403);
  const accepted = await post('/api/trial-link','',{token:newSecret});
  assert.equal(accepted.status,200);
  const cookieHeader = accepted.headers.get('set-cookie');
  assert(/HttpOnly; Secure; SameSite=Lax/.test(cookieHeader || ''));
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await get('/members/',{headers:{cookie}})).status,200);
  assert.equal((await post('/api/chat',cookie,{question:'ドッグファイト'},'https://foreign.invalid')).status,403);
  const question = 'ドッグファイトの基本を教えて';
  assert.equal((await post('/api/chat',cookie,null)).status,400);
  const initial = await (await post('/api/chat',cookie,{question})).json();
  assert.equal(initial.mode,'gemini');
  assert.match(initial.answer,/ニータップ/);
  assert.equal(initial.videos.length,2);
  for (const state of ['503','429','invalid']) {
    simulate = state;
    const before = calls;
    const media = await (await post('/api/videos',cookie,{question})).json();
    assert.deepEqual(media.videos,initial.videos);
    assert.equal(calls,before);
    const fallback = await (await post('/api/chat',cookie,{question})).json();
    assert.equal(calls,before+1);
    assert.equal(fallback.mode,'knowledge');
    assert.match(fallback.answer,/ロールアンダー/);
    assert.deepEqual(fallback.videos,media.videos);
  }
  const secondCookie = await login();
  const before = calls;
  const batch = await Promise.all(Array.from({length:12},()=>post('/api/chat',secondCookie,{question:'Jポイントの米倉式は？'})));
  assert.equal(batch.filter(response => response.status === 200).length,8);
  assert.equal(batch.filter(response => response.status === 429).length,4);
  assert.equal(calls,before);
  await Promise.all(batch.map(response=>response.arrayBuffer()));
});

test('Chat layout and background media lookup keep the v13 entry points', () => {
  const html = readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  assert(html.indexOf('id="ai-chat"') >= 0);
  assert(html.indexOf('id="ai-chat"') < html.indexOf('id="ai-form"'));
  assert.match(html, /chatBox\.scrollTop=chatBox\.scrollHeight/);
  assert.match(html, /appendVideoReferences\(v\.videos,turn\)/);
  assert.match(html, /if\(!turn\?\.isConnected\)return/);
  assert.match(html, /fetch\('\/api\/videos',\{method:'POST'/);
});
