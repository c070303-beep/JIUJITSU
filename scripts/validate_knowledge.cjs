'use strict';

const assert = require('node:assert/strict');
const {sources} = require('../knowledge/sources.json');
const {techniques, scenario_questions, named_references} = require('../knowledge/techniques.json');
const {entries:originals} = require('../knowledge/original_bjj_coaching.json');
const {entries:editorial} = require('../knowledge/editorial_reading_notes.json');
const {videos} = require('../data/public_videos.json');
const ids = records => new Set(records.map(record => record.id));
const sourceById = new Map(sources.map(source => [source.id, source]));
const techniqueById = new Map(techniques.map(technique => [technique.id, technique]));
const videoById = new Map(videos.map(video => [video.id, video]));

function present(text, label) {
  assert.equal(typeof text, 'string', label);
  assert(text.trim(), label);
}

function terms(values, label) {
  assert(Array.isArray(values) && values.length, label);
  for (const term of values) {
    present(term,label);
    assert(/[\p{L}\p{N}ー]/u.test(term),label);
  }
}

function validateCues(rule, label) {
  assert(Array.isArray(rule.all) && rule.all.length, label);
  for (const group of rule.all) terms(group,label);
  if (rule.none) terms(rule.none,label);
}

function validateSources(refs, label) {
  assert(refs.length,label);
  for (const cite of refs) {
    assert(sourceById.has(cite.source_id), cite.source_id);
    present(cite.scope, label);
    present(cite.location, label);
    const pages = sourceById.get(cite.source_id).pdf_page_count;
    if (pages && cite.location.startsWith('PDF内')) {
      const pageNumbers = cite.location.match(/\d+/g) || [];
      assert(pageNumbers.length && pageNumbers.every(page => Number(page) >= 1 && Number(page) <= pages), cite.location);
    }
  }
}

const canBeAnswered = text => !/https?:\/\/|\/personal\/|\/open#/i.test(text);

assert.equal(sourceById.size, sources.length, 'Duplicate sources');
assert.equal(techniqueById.size, techniques.length, 'Duplicate techniques');
assert.equal(videoById.size, videos.length, 'Duplicate videos');

for (const source of sources) {
  present(source.id, 'Source id');
  assert.match(source.source_url, /^https:\/\//, source.id);
  if (source.ai_enabled) assert.equal(source.scope, 'original_notes', source.id);
}

for (const record of techniques) {
  for (const field of ['id','name_ja','name_en','family','start_position','goal','beginner_instruction','safety_notes']) {
    present(record[field], record.id + '.' + field);
  }
  assert(['top','bottom','either'].includes(record.top_or_bottom), record.id);
  for (const field of ['self','opponent']) present(record.body_positions[field], record.id + '.' + field);
  for (const field of ['weight','support','pressure','angle']) present(record.mechanics[field], record.id + '.' + field);
  for (const field of ['aliases','grips_and_frames','steps_ja','success_conditions']) {
    assert(record[field].length, record.id + '.' + field);
    for (const text of record[field]) present(text, record.id + '.' + field);
  }
  assert(record.common_errors.length, record.id);
  present(record.common_errors[0].cause, record.id);
  present(record.common_errors[0].fix, record.id);
  validateSources(record.source_refs,record.id);
  for (const id of record.related_ids) assert(techniqueById.has(id),record.id + ' / ' + id);
  assert(['public_body_cross_check','editorial_synthesis','scope_limited'].includes(record.confirmation.status), record.id);
  assert.equal(record.rights.basis, 'independently_authored_coaching', record.id);
  assert.equal(record.rights.gemini_inference, true, record.id);
  assert.equal(ids(record.opponent_reactions).size, record.opponent_reactions.length, record.id);
  assert(record.opponent_reactions.length, record.id);
  for (const reaction of record.opponent_reactions) {
    present(reaction.answer, record.id);
    present(reaction.cue, record.id);
    terms(reaction.match,record.id);
    if (reaction.next_id) {
      assert(techniqueById.has(reaction.next_id), reaction.next_id);
      assert(record.related_ids.includes(reaction.next_id), reaction.next_id);
    }
  }
  present(record.answer.summary, record.id);
  assert(record.answer.tips.length, record.id);
  for (const tip of record.answer.tips) present(tip, record.id);
  const renderable = [record.answer.summary,...record.answer.tips,record.answer.why ?? '',...record.steps_ja,
    ...record.success_conditions,...record.opponent_reactions.map(r => r.answer),record.scope_note ?? '',
    record.beginner_instruction,record.safety_notes,record.common_errors[0].cause,record.common_errors[0].fix];
  assert(renderable.every(canBeAnswered),record.id);
  const recognition = record.recognition;
  if (recognition) {
    if (recognition.names) terms(recognition.names,record.id);
    if (recognition.skip_names_in) terms(recognition.skip_names_in,record.id);
    if (recognition.role) assert(['apply','receive'].includes(recognition.role),record.id);
    if (recognition.counterpart) {
      const counterpart = techniqueById.get(recognition.counterpart);
      assert(counterpart && counterpart.recognition?.role && counterpart.recognition.role !== recognition.role,record.id);
    }
    for (const rule of recognition.scenes ?? []) validateCues(rule,record.id);
  }
  for (const videoId of record.public_youtube_ids) {
    assert(videoById.get(videoId)?.technique_ids.includes(record.id), record.id + ' / ' + videoId);
  }
}

for (const rule of scenario_questions) {
  validateCues(rule,rule.prompt);
  assert.match(rule.prompt,/[？?]$/);
  assert(rule.choices.length >= 2 && rule.choices.length <= 3);
  assert.equal(ids(rule.choices).size,rule.choices.length);
  for (const choice of rule.choices) {
    assert(techniqueById.has(choice.id),choice.id);
    present(choice.label,choice.id);
    if (choice.reply) validateCues(choice.reply,choice.id);
  }
}
assert.equal(ids(named_references).size,named_references.length);
for (const reference of named_references) {
  terms(reference.names,reference.id);
  validateSources(reference.source_refs,reference.id);
  assert(['catalog_only','public_comparison'].includes(reference.confirmation),reference.id);
  present(reference.answer,reference.id);
  assert(canBeAnswered(reference.answer),reference.id);
}

for (const video of videos) {
  assert.match(video.id, /^[A-Za-z0-9_-]{11}$/);
  assert.equal(video.watch_url, 'https://www.youtube.com/watch?v=' + video.id);
  assert.equal(video.thumbnail_url, 'https://i.ytimg.com/vi/' + video.id + '/hqdefault.jpg');
  if (video.recommendation_status !== 'publisher_content_checked') {
    assert.equal(video.technique_ids.length, 0, video.id);
    continue;
  }
  assert.equal(video.verified_public_url, true, video.id);
  assert(sourceById.has(video.evidence.source_id), video.id);
  present(video.evidence.detail, video.id);
  assert(video.technique_ids.length, video.id);
  for (const id of video.technique_ids) {
    const technique = techniqueById.get(id);
    assert(technique?.public_youtube_ids.includes(video.id), video.id);
    assert(technique.top_or_bottom === 'either' || technique.top_or_bottom === video.position, id);
    const mapped = video.reaction_ids[id] || [];
    assert(mapped.every(choice => ids(technique.opponent_reactions).has(choice)), id);
  }
}
const mappedLegacyIds = new Set(techniques.flatMap(record => record.legacy_ids));
for (const entry of [...originals, ...editorial]) assert(mappedLegacyIds.has(entry.id), entry.id);
console.log('Knowledge validation OK: ' + techniques.length + ' techniques, ' + sources.length +
  ' source records, ' + videos.filter(v => v.recommendation_status === 'publisher_content_checked').length +
  ' video records eligible for cards.');
