'use strict';

const kanaKey = text => String(text ?? '').normalize('NFKC').toLowerCase()
  .replace(/[‐‑‒–—−]/g, '-')
  .replace(/[ぁ-ゖ]/g, character => String.fromCharCode(character.charCodeAt(0) + 96));
const sceneKey = text => kanaKey(text).replace(/[^\p{L}\p{N}ー]/gu, '');
const escapeRegex = text => text.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');

function positiveCue(text, cue) {
  let index = text.indexOf(cue);
  while (index >= 0) {
    const after = text.slice(index + cue.length);
    if (!/^(?:イテ|ッテ|ンデ|テ|デ)?(?:イ)?(?:ナイ|ナカッ|ナク|マセン|ズ)|^(?:イタ|タ|ダ)?ノ?(?:デハナク|ジャナク)/.test(after)) return true;
    index = text.indexOf(cue,index + cue.length);
  }
  return false;
}

function nameMatcher(name) {
  const folded = kanaKey(name).trim();
  const key = sceneKey(folded);
  if (/^[a-z0-9 -]+$/i.test(folded)) {
    const words = folded.split(/[ -]+/).map(escapeRegex);
    const pattern = new RegExp('(?<![a-z0-9])' + words.join('[ -]*') + '(?![a-z0-9])');
    return {key, test: (_, text) => pattern.test(text)};
  }
  return {key, test: text => text.includes(key)};
}

function sceneMatcher(scene) {
  const all = scene.all.map(group => group.map(sceneKey));
  const none = (scene.none ?? []).map(sceneKey);
  return text => all.every(group => group.some(cue => text.includes(cue))) &&
    !none.some(cue => text.includes(cue));
}

function explicitRole(question, named = false) {
  const text = String(question ?? '').normalize('NFKC').replace(/[ \t]/g, '');
  const action = /を?(?:使いたい|かけたい|掛けたい|仕掛けた|仕掛ける|かけた|掛けた|狙った|狙いたい|やりたい|かける側|仕掛ける側|したい|しようと)/;
  const defense = /かけられ|掛けられ|仕掛けられ|パスされ|狙われ|絞められ|極められ|取られ|払われ|担がれ|乗せられ|置かれ|タックルされた|を受け[たるて]|を防[ぐぎ]|を止めたい|から逃げ|の外し方|を解除|を外したい|被せられ|受け[たる]側|をされ[たるて]|された|をしてきた|をしてくる/;
  const applyIndex = text.search(action);
  const defenseIndex = text.search(defense);
  if (applyIndex >= 0 && (defenseIndex < 0 || applyIndex < defenseIndex)) return 'apply';
  if (defenseIndex >= 0) return 'receive';
  if (named && /される|してきた|してくる|(?:相手の|相手が).{0,24}(?:が来た|で来る)|対策|守り方|防御|ディフェンス|からの?エスケープ/.test(text)) return 'receive';
  return null;
}

function physicalSide(question) {
  const direct = question.match(/(?:自分|私|こちら)(?:は|が)(?:上|下|トップ|ボトム)/)?.[0];
  if (direct) return /下|ボトム/.test(direct) ? 'bottom' : 'top';
  if (/^(?:上側|トップ)(?:で|として)|下の相手/.test(question) ||
    /^上から/.test(question) && explicitRole(question) !== 'receive') return 'top';
  if (/^(?:下側|ボトム)(?:で|として)|^下から|上の相手|相手が上/.test(question)) return 'bottom';
  return null;
}

function createTechniqueMatching(records, scenarioQuestions = []) {
  const byId = new Map(records.map(record => [record.id,record]));
  const named = records.flatMap(record => (record.recognition?.names || []).map(name => ({
    record, ...nameMatcher(name), exclude:(record.recognition.skip_names_in || []).map(sceneKey),
    definitionOnly:record.recognition.definition_only === true,
  }))).sort((a,b)=>b.key.length-a.key.length);
  const scenes = records.flatMap(record => (record.recognition?.scenes || []).map(scene => ({
    record, test:sceneMatcher(scene), evidence:scene.all.length,
  }))).sort((a,b)=>b.evidence-a.evidence);
  const questions = scenarioQuestions.map(rule => ({
    ...rule,test:sceneMatcher(rule),
    choices:rule.choices.map(choice => ({
      ...choice, replyMatches:choice.reply ? sceneMatcher(choice.reply) : null,
    })),
  }));

  const counterpart = (record, role) => {
    if (!role || !record.recognition?.role || record.recognition.role === role) return record;
    const explicit = byId.get(record.recognition.counterpart);
    return (explicit?.recognition?.role === role ? explicit : null) ||
      records.find(item => item.family === record.family && item.recognition?.role === role) || null;
  };

  function fromNames(text, compare = false) {
    const segments = text.split(/じゃなく(?:て)?|ではなく|じゃない[、。 ]+|でなく[、。 ]*/);
    if (!compare && segments.length > 1) text = segments.at(-1);
    const key = sceneKey(text);
    const kana = kanaKey(text);
    const simpleName = sceneKey(text.replace(
      /(?:の(?:意味|概要|基本|コツ)(?:は|を教えて(?:ください)?)?|について(?:教えて(?:ください)?)?|とは|って(?:何|なに)|を教えて(?:ください)?|は何(?:ですか)?)\s*[?？。!！]*$/,''));
    let unmatched = key;
    const hits = new Map();
    for (const entry of named) {
      if (hits.has(entry.record.family) || entry.exclude.some(term => key.includes(term))) continue;
      if (entry.definitionOnly ? simpleName !== entry.key : !entry.test(unmatched,kana)) continue;
      const siblings = records.filter(record => record.family === entry.record.family && record.recognition?.role);
      const side = physicalSide(text);
      const role = explicitRole(text,false) ||
        (entry.record.recognition?.role === 'receive' ? null : explicitRole(text,true));
      const sided = !role && side ? siblings.find(record => record.top_or_bottom === side) : null;
      const found = compare ? entry.record : sided || counterpart(entry.record,role);
      hits.set(entry.record.family, found);
      unmatched = unmatched.replaceAll(entry.key,'');
      if (!compare) break;
    }
    return [...hits.values()];
  }

  function fromScenes(text) {
    const key = sceneKey(text);
    const rule = questions.find(item => item.test(key));
    if (rule) return {question:rule.prompt, choices:rule.choices};
    const side = physicalSide(text);
    const heard = scenes.filter(entry => entry.test(key) &&
      (!side || entry.record.top_or_bottom === 'either' || entry.record.top_or_bottom === side));
    const top = heard[0];
    if (!top) return null;
    const tied = [...new Set(heard.filter(entry=>entry.evidence===top.evidence).map(entry=>entry.record.id))];
    if (tied.length > 1) return {question:'今の場面に近いものはどれですか？', choices:tied.slice(0,3).map(id=>({id,label:byId.get(id).name_ja}))};
    return {record:top.record};
  }

  function replyToScene(initialText, answerText, previousMessage) {
    const initial = sceneKey(initialText);
    const rule = questions.find(item => item.prompt === previousMessage && item.test(initial));
    const answer = sceneKey(answerText);
    const picked = rule?.choices.filter(choice => choice.replyMatches?.(answer));
    return picked?.length === 1 ? byId.get(picked[0].id) : null;
  }

  return {fromNames,fromScenes,counterpart,replyToScene};
}

module.exports = {createTechniqueMatching,explicitRole,sceneKey,positiveCue};
