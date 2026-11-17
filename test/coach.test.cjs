'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {readFileSync} = require('node:fs');
const {createHash,randomBytes} = require('node:crypto');
const {once} = require('node:events');
const path = require('node:path');
const coach = require('../lib/coach.cjs');
const fixtures = require('./coaching-cases.json');
const generalCases = require('./general-cases.json');
const generalKnowledge = require('../knowledge/general.json');
const beginnerCases = require('./beginner-cases.json');
const {cases:techniqueCases,evaluate:evaluateTechnique} = require('./technique-evaluation.cjs');

for (const fixture of techniqueCases) {
  test(fixture.id + ' ' + fixture.question, () => {
    const result = evaluateTechnique(coach,fixture);
    assert(result.pass,JSON.stringify(result));
    assert.equal(result.requestsGemini,false);
    assert.doesNotMatch(result.answer,/https?:\/\/|\/personal\/|\/open#/);
    assert(result.answer.length <= 250,result.answer);
  });
}

function continueFrom(question, route) {
  return [
    {role:'user',content:question},
    {role:'assistant',content:coach.renderAnswer(route),topic:coach.topicForRoute(route)},
  ];
}

test('A clarification supports taps and everyday typed answers without losing the original scene', () => {
  const question = '横から胸を押さえられて、ひじが抜けない';
  const first = coach.resolveRequest(question);
  assert.equal(first.choices.length,2);
  const history = continueFrom(question,first);
  const variants = [
    {answer:'はい、片足はまだ挟んでる',expected:'half-crossface'},
    {answer:'もう挟んでいません',expected:'side-bottom'},
  ];
  for (const [index,{answer,expected}] of variants.entries()) {
    const option = first.choices[index];
    const tapped = coach.resolveRequest(option.question,history,option.selection);
    const typed = coach.resolveRequest(answer,history);
    assert.equal(coach.topicForRoute(tapped).entry,expected);
    assert.equal(coach.topicForRoute(typed).entry,expected);
    assert.equal(coach.renderAnswer(tapped),coach.renderAnswer(typed));
    assert.equal(coach.selectPayload(typed,answer),null);
  }
});

test('A follow-up switches from the applied move to defense, then keeps that side for details', () => {
  const original = 'ニースライスって何？';
  const first = coach.resolveRequest(original);
  const question = '相手にそれをされたときは？';
  const history = continueFrom(original,first);
  const second = coach.resolveRequest(question,history);
  assert.equal(coach.topicForRoute(second).entry,'knee-cut-defense');
  assert.equal(coach.selectPayload(second,question),null);
  const detail = coach.resolveRequest('それを詳しく',history.concat(continueFrom(question,second)));
  assert.equal(coach.topicForRoute(detail).entry,'knee-cut-defense');
  assert.match(coach.renderAnswer(detail),/成立条件/);
});

test('Gemini fallback can select a newly registered defense and must use an allowed branch', () => {
  const question = '稽古で迎えられた形からクビと片腕だけ同じ輪に残った。上半身をどう戻す？';
  const route = coach.resolveRequest(question);
  assert(route.semantic);
  const payload = coach.selectPayload(route,question);
  const known = JSON.parse(payload.contents[0].parts[0].text).catalog.find(item => item.id === 'triangle-defense');
  assert.equal(known.role,'top');
  assert.equal(known.action,'receive');
  assert(!known.answer && !known.source_refs);
  const response = (entry,branch) => ({candidates:[{content:{parts:[{text:JSON.stringify({entry,intent:'how',branch})}]}}]});
  assert.equal(coach.readSelection(response('triangle-defense','invented'),route),null);
  assert.equal(coach.readSelection(response('secret-technique',''),route),null);
  const selected = coach.readSelection(response('triangle-defense','forming'),route);
  const answer = coach.interpretRoute(route,selected);
  assert.equal(coach.topicForRoute(answer).entry,'triangle-defense');
  assert.match(coach.renderAnswer(answer),/上体を起こして肘/);
});

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

for (const item of generalCases) {
  test(item.id + ' ' + item.question, () => {
    const route = coach.resolve(item.question, item.history);
    const cards = coach.videoCards(route);
    const answer = coach.renderAnswer(route, null, cards);
    assert.equal(route.generalId ?? null, item.expected);
    for (const phrase of item.includes) assert(answer.includes(phrase), answer);
    for (const phrase of item.excludes) assert(!answer.includes(phrase), answer);
    if (item.choices !== undefined) assert.equal(route.choices.length, item.choices);
    assert.deepEqual(cards, []);
    if (route.generalId) {
      assert.equal(coach.selectPayload(route,item.question), null);
      if (!item.history.length) assert(answer.length >= 150 && answer.length <= 250);
    }
  });
}

for (const item of beginnerCases) {
  test(item.id + ' ' + item.question, () => {
    const initial = coach.resolve(item.question, item.history);
    let route = initial;
    if (item.mock) {
      assert(initial.semantic);
      const payload = coach.selectPayload(initial,item.question);
      assert(payload.generationConfig.responseSchema.properties.entry.enum.includes(item.mock.entry));
      const response = {candidates:[{content:{parts:[{text:JSON.stringify(item.mock)}]}}]};
      const selection = coach.readSelection(response,initial);
      assert.deepEqual(selection,item.mock);
      route = coach.interpretRoute(initial,selection);
      const followup = coach.resolve('それはなぜ？',[
        {role:'user',content:item.question},
        {role:'assistant',content:coach.renderAnswer(route)},
      ]);
      assert.equal(followup.generalId,item.expected);
      assert(coach.renderAnswer(followup).length > coach.renderAnswer(route).length);
      assert.equal(coach.selectPayload(followup,'それはなぜ？'), null);
    }
    assert.equal(route.generalId ?? null,item.expected);
    if (item.tech) assert.equal(route.records[0]?.id,item.tech);
    const cards = coach.videoCards(route);
    const answer = coach.renderAnswer(route,null,cards);
    for (const phrase of item.phrases) assert(answer.includes(phrase),answer);
    for (const phrase of item.forbidden || []) assert(!answer.includes(phrase),answer);
    if (item.choiceCount !== undefined) assert.equal(route.choices.length,item.choiceCount);
    if (item.expected) {
      assert.deepEqual(cards,[]);
      if (!item.history.length) assert(answer.length >= 150 && answer.length <= 250, answer);
      if (!item.mock) assert.equal(coach.selectPayload(initial,item.question),null);
    }
  });
}

test('Beginning questions show relevant choices and each choice resolves to its advertised topic', () => {
  const promotions = coach.resolve('青帯になるには？');
  const history = [{role:'user',content:'青帯になるには？'}];
  assert.deepEqual(promotions.choices.map(option => option.label),['一般的な練習の目安','RRTの昇格基準']);
  assert.deepEqual(promotions.choices.map(option => coach.resolve(option.question,history).generalId),
    ['general-belt-path','general-rrt-promotion']);
  const pinned = coach.resolve('下で潰されたらどうすれば？');
  const pinnedPaths = pinned.choices.map(option => {
    const path = coach.resolve(option.question,[{role:'user',content:'下で潰されたらどうすれば？'}]);
    return path.generalId ?? path.records[0]?.id;
  });
  assert.deepEqual(pinnedPaths,['side-bottom','general-mount-bottom','half-crossface']);
});

test('Gemini general IDs reject a fabricated reaction or additional data', () => {
  const route = coach.resolve('回したやつをリールに流しても平気？');
  const response = item => ({candidates:[{content:{parts:[{text:JSON.stringify(item)}]}}]});
  const selection = {entry:'general-filming',intent:'how',branch:''};
  assert.match(coach.renderAnswer(coach.interpretRoute(route,coach.readSelection(response(selection),route))),/公開してよいか/);
  assert.equal(coach.readSelection(response({...selection,branch:'invented'}),route),null);
  assert.equal(coach.readSelection(response({...selection,url:'https://example.invalid'}),route),null);
});

test('General answers point to registered sources and existing technique IDs', () => {
  const {techniques} = require('../knowledge/techniques.json');
  const techniquesById = new Set(techniques.map(item => item.id));
  const ids = new Set();
  const aliases = new Set();
  for (const record of generalKnowledge.records) {
    assert(!ids.has(record.id), record.id);
    ids.add(record.id);
    assert.deepEqual(record.levels, ['white','blue']);
    assert(record.scope.trim() && record.answer.length >= 150 && record.detail.trim());
    assert(record.source_ids.length && record.source_ids.every(id => generalKnowledge.sources[id]));
    assert(record.related_ids.every(id => techniquesById.has(id)));
    for (const group of record.match_groups || []) assert(group.length && group.every(term => typeof term === 'string' && term.trim()));
    for (const choice of record.choices || []) {
      const target = coach.resolve(choice.question);
      assert(target.generalId || target.records.length,choice.question);
    }
    for (const alias of record.aliases) {
      assert(!aliases.has(alias), alias);
      aliases.add(alias);
    }
  }
  for (const source of Object.values(generalKnowledge.sources)) {
    assert.equal(new URL(source.url).protocol, 'https:');
    assert(source.author && source.section && /^\d{4}-\d{2}-\d{2}$/.test(source.checked_on));
  }
});

test('Unclear questions offer choices and a selected side resolves the original question', () => {
  const question = 'ハーフガードで相手に脇を差されたら？';
  const query = coach.resolve(question);
  assert.equal(query.choices.length,2);
  assert.deepEqual(query.choices.map(item => item.question),['トップです','ボトムです']);
  assert.equal(coach.selectPayload(query,question),null);
  const context = [{role:'user',content:question}];
  assert.equal(coach.resolve(query.choices[0].question,context).records[0].id,'half-top-vs-underhook');
  assert.equal(coach.resolve(query.choices[1].question,context).records[0].id,'half-crossface');
  const open = coach.resolve('どうすれば上手くなれる？');
  assert(open.choices.length >= 3);
  const position = coach.resolve(open.choices[1].question);
  assert.equal(position.choices.length,3);
  assert.equal(coach.resolve(position.choices[0].question).records[0].id,'passing-grips');
});

test('A vague opponent reaction offers context-specific choices and each choice stays in the same technique', () => {
  const question = 'アウトサイドキャンピング中に相手がインバーテッドしたら？';
  const route = coach.resolve(question);
  assert.equal(route.choices.length,2);
  assert.equal(coach.selectPayload(route,question),null);
  assert.match(coach.renderAnswer(route),/相手の反応はどれに近い/);
  assert.doesNotMatch(coach.renderAnswer(route),/別の角度から入り直します/);
  const history = [{role:'user',content:question}];
  const outputs = route.choices.map(item => {
    const next = coach.resolve(item.question,history,item.selection);
    assert.equal(next.records[0].id,'outside-inversion');
    assert.equal(coach.selectPayload(next,item.question),null);
    return coach.renderAnswer(next);
  });
  assert.match(outputs[0],/別の角度から入り直します/);
  assert.match(outputs[1],/近いすね/);
  assert(!outputs[1].includes('別の角度から入り直します'));
  const clicked = route.choices[1];
  const next = coach.resolve('詳しく教えて',history.concat({role:'user',content:clicked.question,selection:clicked.selection}));
  assert.match(coach.renderAnswer(next),/近いすね/);
  const invalid = coach.resolve('コヨーテについて',history,{record:'outside-inversion',reaction:'bogus'});
  assert.equal(invalid.records[0].id,'coyote-half');
  const alreadyFlat = coach.resolve('ハーフで上からマクラを取られ、肩が床に押しつけられたら？');
  assert(alreadyFlat.choices.length);
  assert(!coach.renderAnswer(alreadyFlat).includes('マクラがまだ浅いなら'));
});

test('Gemini interprets an unknown phrasing using registered IDs and falls back to choices', () => {
  const question = '押し込まれたら、ひじを先に置く意味って？';
  const route = coach.resolve(question);
  assert(route.semantic);
  const payload = coach.selectPayload(route,question);
  assert(payload.generationConfig.responseSchema.properties.entry.enum.includes('guard-retention'));
  const response = item => ({candidates:[{content:{parts:[{text:JSON.stringify(item)}]}}]});
  const value = coach.readSelection(response({entry:'guard-retention',intent:'why',branch:''}),route);
  assert.match(coach.renderAnswer(coach.interpretRoute(route,value)),/骨盤/);
  for(const item of [
    {entry:'unknown',intent:'why',branch:''},
    {entry:'guard-retention',intent:'why',branch:'unknown'},
    {entry:'guard-retention',intent:'why',branch:'',answer:'arbitrary'},
    {entry:'clarify',intent:'why',branch:'unknown'},
  ]) {
    const rejected = coach.readSelection(response(item),route);
    assert.equal(rejected,null);
    assert(coach.interpretRoute(route,rejected).choices.length);
  }
  const uncertain = coach.readSelection(response({entry:'clarify',intent:'position',branch:''}),route);
  assert.equal(coach.interpretRoute(route,uncertain).choices.length,3);
  const manners = coach.readSelection(response({entry:'sparring-etiquette',intent:'overview',branch:''}),route);
  assert.match(coach.renderAnswer(coach.interpretRoute(route,manners)),/最大7組/);
});

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
  assert.equal(coach.selectPayload(route, 'アメリカーナを教えて'),null);
  assert.doesNotMatch(coach.renderAnswer(route),/インサイドキャンピング/);
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
  const additionalSecret = randomBytes(32).toString('hex');
  const origin = 'https://rrt.test.invalid';
  const env = {
    PERSONAL_TRIAL_LINK_TOKEN:secret,
    PERSONAL_TRIAL_OPEN_TOKEN_SHA256:createHash('sha256').update(newSecret).digest('hex'), GEMINI_API_KEY:'mocked-api-key-for-tests',
    PERSONAL_TRIAL_ADDITIONAL_TOKEN_SHA256:createHash('sha256').update(additionalSecret).digest('hex'),
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
    if (payload.generationConfig?.responseSchema?.properties?.entry) {
      const semantic = simulate === 'general'
        ? {entry:'general-filming',intent:'how',branch:''}
        : {entry:'clarify',intent:'position',branch:''};
      if (simulate === 'general') {
        assert(payload.generationConfig.responseSchema.properties.entry.enum.includes('general-filming'));
        const body = JSON.parse(payload.contents[0].parts[0].text);
        assert(body.catalog.some(entry => entry.id === semantic.entry && entry.scope && !entry.answer && !entry.source_ids));
      }
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(semantic)}]}}]});
    }
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
  assert.equal(health.knowledge,'3.0');
  assert.equal((await get('/members/')).headers.get('location'),'/login');
  assert.equal((await get('/api/status')).status,401);
  const page = await get('/open');
  assert.equal(page.status,200);
  const opener = await page.text();
  assert(opener.includes('location.hash.slice(1)'));
  assert(opener.includes('location.replace("/members/")'));
  assert(!opener.includes(newSecret));
  assert(!opener.includes(additionalSecret));

  const rejected = await post('/api/trial-link','',{token:randomBytes(32).toString('hex')});
  assert.equal(rejected.status,404);
  assert.equal(rejected.headers.get('set-cookie'),null);
  assert.equal((await post('/api/trial-link','',{token:newSecret},'https://foreign.invalid')).status,403);
  const accepted = await post('/api/trial-link','',{token:newSecret});
  assert.equal(accepted.status,200);
  const additional = await post('/api/trial-link','',{token:additionalSecret});
  assert.equal(additional.status,200);
  const additionalCookie = additional.headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/members/',{headers:{cookie:additionalCookie}})).status,200);
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
  assert.deepEqual(initial.videos,[]);
  assert(!/動画を表示|youtu\.be|youtube\.com/.test(initial.answer));
  assert.equal((await get('/api/videos?library=1')).status,401);
  const library = await (await get('/api/videos?library=1',{headers:{cookie}})).json();
  assert.equal(library.videos.length,8);
  assert(library.videos.every(video => video.url === 'https://www.youtube.com/watch?v=' + video.id));
  assert.equal(calls,1);
  for (const state of ['503','429','invalid']) {
    simulate = state;
    const before = calls;
    const media = await (await post('/api/videos',cookie,{question})).json();
    assert.equal(media.videos.length,2);
    assert(media.videos.every(video=>library.videos.some(item=>item.id===video.id)));
    assert.equal(calls,before);
    const fallback = await (await post('/api/chat',cookie,{question})).json();
    assert.equal(calls,before+1);
    assert.equal(fallback.mode,'knowledge');
    assert.match(fallback.answer,/ロールアンダー/);
    assert.deepEqual(fallback.videos,[]);
  }
  const secondCookie = await login();
  simulate = 'ok';
  const ask = await (await post('/api/chat',secondCookie,{question:'どうしたら良くなる？'})).json();
  assert.equal(ask.choices.length,3);
  const beforeReaction = calls;
  const q = 'アウトサイドキャンピング中に相手がインバーテッドしたら？';
  const prompt = await (await post('/api/chat',secondCookie,{question:q})).json();
  assert.equal(prompt.choices.length,2);
  const reply = prompt.choices[1];
  const resolved = await (await post('/api/chat',secondCookie,{question:reply.question,selection:reply.selection,history:[{role:'user',content:q}]})).json();
  assert.match(resolved.answer,/近いすね/);
  assert.equal(calls,beforeReaction);
  const firstRoll = await (await post('/api/chat',secondCookie,{question:'初スパーでどうすればいい？'})).json();
  assert.match(firstRoll.answer,/軽めでお願いします/);
  assert.equal(firstRoll.mode,'knowledge');
  assert.deepEqual(firstRoll.videos,[]);
  assert.equal(calls,beforeReaction);
  const rule = await (await post('/api/chat',secondCookie,{question:'この技は白帯でも使える？'})).json();
  assert.equal(rule.choices.length,2);
  const ruleHelp = await (await post('/api/chat',secondCookie,{question:rule.choices[0].question})).json();
  assert.match(ruleHelp.answer,/公式ルール/);
  assert.equal(calls,beforeReaction);
  const videoQuestion = await (await post('/api/chat',cookie,{question:'ドッグファイト 動画'})).json();
  assert.deepEqual(videoQuestion.videos,[]);
  assert.match(videoQuestion.answer,/ドッグファイト/);
  assert(!/動画を表示|登録にありません|YouTube/.test(videoQuestion.answer));
  assert.equal(calls,beforeReaction);

  simulate = 'general';
  const filming = await (await post('/api/chat',secondCookie,{question:'回したやつをリールに流しても平気？'})).json();
  assert.equal(filming.mode,'gemini');
  assert.match(filming.answer,/公開してよいか/);
  assert.equal(calls,beforeReaction+1);
  assert.deepEqual(filming.topic,{entry:'general-filming'});
  const followup = await (await post('/api/chat',secondCookie,{question:'それを詳しく',history:[
    {role:'user',content:'回したやつをリールに流しても平気？'},
    {role:'assistant',content:filming.answer,topic:filming.topic},
  ]})).json();
  assert.equal(followup.topic.entry,'general-filming');
  assert(followup.answer.length > filming.answer.length);
  assert.equal(calls,beforeReaction+1);
  const limitedCookie = await login();
  const before = calls;
  const batch = await Promise.all(Array.from({length:12},()=>post('/api/chat',limitedCookie,{question:'Jポイントの米倉式は？'})));
  assert.equal(batch.filter(response => response.status === 200).length,8);
  assert.equal(batch.filter(response => response.status === 429).length,4);
  assert.equal(calls,before);
  await Promise.all(batch.map(response=>response.arrayBuffer()));
});

test('Chat order, automatic scrolling, and separate library entry point', () => {
  const html = readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
  assert(html.indexOf('id="ai-chat"') >= 0);
  assert(html.indexOf('id="ai-chat"') < html.indexOf('id="ai-form"'));
  assert.match(html, /chatBox\.scrollTop=chatBox\.scrollHeight/);
  assert.match(html,/topic:body.topic/);
  assert.match(html, /appendCoachChoices\(body\.choices,turn\)/);
  assert.match(html, /renderLibraryVideos\(data\.videos\)/);
  assert.match(html, /id="page-library"/);
  assert.match(html, /data-page="library"/);
  const chatFunction = html.split('async function askCoach')[1].split("$('ai-form')")[0];
  assert(!chatFunction.includes('/api/videos'));
});

test('Promotion questions distinguish conditions, duration, and the named academy', () => {
  const cases = [
    ['青帯になる条件は？', 'belt-path'],
    ['必要な条件は何ですか、青帯に上がるときの話です', 'belt-path'],
    ['ブルーベルトへの昇格条件を教えて', 'belt-path'],
    ['青帯に なる 条件は？', 'belt-path'],
    ['あおおびになるための目安って？', 'belt-path'],
    ['青帯は何か月ぐらいでなれる？', 'belt-time'],
    ['週3回で青帯になれる？', 'belt-time'],
    ['RRTで青帯になる条件は？', 'rrt-promotion'],
    ['RRTの青帯の条件は？', 'rrt-promotion'],
    ['カルペディエムで青帯を取得するには？', 'carpediem-promotion'],
    ['RRTで週3回通えば青帯を取れますか？', 'rrt-promotion'],
    ['ランジェル先生のところで青帯になるための条件は？', 'rrt-promotion'],
    ['トライフォースで青帯になる条件は？', 'triforce-promotion'],
    ['カルペディエムの青帯になる基準は？', 'carpediem-promotion'],
    ['青帯になる条件はトライフォースとカルペディエムで違う？', 'promotion-comparison'],
    ['青帯になった後の練習は？', null],
    ['青帯の大会の出場条件は？', null],
  ];
  for (const [question, id] of cases) {
    const route = coach.resolve(question);
    assert.equal(route.generalId ?? null, id ? 'general-' + id : null, question);
    if (id) assert.equal(coach.selectPayload(route,question),null,question);
  }
  const route = coach.resolve('青帯になる条件は？');
  assert.match(coach.renderAnswer(route),/^青帯の昇格条件は道場ごとに異なります。/);
  assert.deepEqual(route.choices.map(choice => choice.label), ['一般的な練習の目安','RRTの昇格基準']);
});

test('Short promotion follow-ups keep the topic and the academy scope', () => {
  const ask = (question, previous) => coach.resolve(question, previous);
  const history = prev => [{role:'user',content:prev}];
  assert.equal(ask('条件は？',history('青帯になるまで何年？')).generalId,'general-belt-path');
  assert.equal(ask('次の期間は？',history('初スパーのコツは？')).generalId,undefined);
  assert.equal(ask('じゃあRRTでは？',history('青帯になる条件は？')).generalId,'general-rrt-promotion');
  assert.equal(ask('RRTではどう？',history('青帯に昇格するには？')).generalId,'general-rrt-promotion');
  const rrtHistory = history('RRTで青帯になる条件は？');
  const localPeriod = ask('何年くらい？',rrtHistory);
  assert.equal(localPeriod.generalId,'general-rrt-promotion');
  assert.match(coach.renderAnswer(localPeriod),/確認できていません/);
  assert.equal(ask('一般的には？',rrtHistory).generalId,'general-belt-path');
  assert.equal(ask('期間は？',history('青帯になる条件は？')).generalId,'general-belt-time');
});

test('Shared intent matching covers unlisted phrasing across coaching topics', () => {
  const examples = [
    ['運動不足で体力に自信がない。体験に申し込む前に何を伝える？','general-intro','overview', /体験/],
    ['手も足も抑えられて横を向けないんだけど、最初に守る場所はどこ？','general-pinned-triage','first', /肘/],
    ['回した動画じゃなくて対戦の写真をグループに流してもいい感じ？','general-filming','how', /公開してよいか/],
    ['白から一つ色を上げるときに先生は何を見るもの？','general-belt-path','overview', /昇格/],
    ['背を見せたら相手が後ろで離れなくなった。どう守る？','general-back-bottom','first', /首に近い腕/],
    ['タートルの中でずっと固まっちゃう。手足がほどける前にどう動く？','general-turtle-bottom','how', /膝/],
    ['シングルレッグえっくすのやり方','single-leg-x','how', /片脚/],
    ['2本目の練習前、濡れたままの道着で相手と組むのはあり？','general-hygiene','how', /洗って乾かした/],
    ['抽選のあと会場でどこに行けばいいか分からない','general-match-kit','how', /大会要項/],
    ['一つの動きを覚えても別の人だと通用しないんだけど、何を変える？','general-training-review','practice', /開始位置/],
  ];
  for (const [question,entry,intent,answer] of examples) {
    const route = coach.resolveRequest(question);
    assert(route.semantic, question);
    const payload = coach.selectPayload(route,question);
    const content = JSON.parse(payload.contents[0].parts[0].text);
    assert(payload.generationConfig.responseSchema.properties.entry.enum.includes(entry), question);
    assert(content.catalog.every(item => !item.answer && !item.source_ids));
    const result = {candidates:[{content:{parts:[{text:JSON.stringify({entry,intent,branch:''})}]}}]};
    const resolved = coach.interpretRoute(route,coach.readSelection(result,route));
    assert.equal(coach.topicForRoute(resolved).entry,entry);
    assert.match(coach.renderAnswer(resolved),answer,question);
  }
});

test('Related choices work without Gemini and do not override a new subject', () => {
  const route = coach.resolveRequest('シングルレッグえっくすのやり方');
  const option = route.choices.find(choice => choice.selection?.topic === 'single-leg-x');
  assert(option);
  const picked = coach.resolveRequest(option.question,[],option.selection);
  assert.equal(coach.topicForRoute(picked).entry,'single-leg-x');
  assert.equal(coach.selectPayload(picked,option.question),null);
  const newQuestion = coach.resolveRequest('青帯になる条件は？',[],option.selection);
  assert.equal(newQuestion.generalId,'general-belt-path');
});

test('Topic context preserves technique and reaction and does not disclose private turns', () => {
  const history = [
    {role:'user',content:'さっきの連絡先は test@example.invalid'},
    {role:'user',content:'キャンプ中に相手の膝が戻りました'},
    {role:'assistant',content:'登録済みの次の一手',topic:{entry:'outside-inversion',branch:'knee-in'}},
  ];
  const route = coach.resolveRequest('相手がそこで足を組んだら？',history);
  const payload = JSON.parse(coach.selectPayload(route,'相手がそこで足を組んだら？').contents[0].parts[0].text);
  assert.equal(payload.previous_entry,'outside-inversion');
  assert.deepEqual(payload.recent_questions,['キャンプ中に相手の膝が戻りました']);
  assert(!JSON.stringify(payload).includes('example.invalid'));
  const detail = coach.resolveRequest('それを詳しく',history);
  assert.deepEqual(coach.topicForRoute(detail),{entry:'outside-inversion',branch:'knee-in'});
  assert(!coach.selectPayload(detail,'それを詳しく'));
  const changed = coach.resolveRequest('キムラを教えて',history);
  assert.equal(coach.topicForRoute(changed).entry,'kimura');
  const score = coach.resolveRequest('スイープしたけど浮かせただけ、試合で点はつく？',history);
  assert.match(coach.renderAnswer(score),/大会・部門/);
  assert.equal(coach.selectPayload(score,'試合で点はつく？'),null);
});

test('Compound requests can refine a local guess and abstain on unregistered material', () => {
  const question = '今日は軽めで、と先に言うのが気まずい。疲れてるとき断っていい？';
  const route = coach.resolveRequest(question);
  assert.equal(route.semantic.localEntry,'general-spar-intensity');
  const response = (entry, intent = 'topic', branch = '') =>
    ({candidates:[{content:{parts:[{text:JSON.stringify({entry,intent,branch})}]}}]});
  assert.equal(coach.interpretRoute(route,coach.readSelection(response('keep'),route)),route);
  assert.match(coach.renderAnswer(coach.interpretRoute(route,coach.readSelection(response('uncovered'),route))),/確認済みの説明はありません/);
  assert.equal(coach.readSelection(response('uncovered','topic','fabricated'),route),null);
});
