'use strict';

const fixtures = require('./technique-intents.json');

const formLabels = ['name','alias','scene'];
const cases = [
  ...fixtures.threeForms.flatMap(([entry,...forms],index) =>
    formLabels.map((type,position) => ({
      id:'t' + String(index + 1).padStart(2,'0') + '-' + type,
      type,entry,question:forms[position],must:forms[3],
    }))),
  ...fixtures.edgeCases,
];

function evaluate(coach, fixture) {
  const route = coach.resolveRequest(fixture.question);
  const answer = coach.renderAnswer(route);
  const records = route.records.map(record => record.id);
  const entry = records[0] ?? route.generalId ?? null;
  const checks = {
    entry:fixture.entries
      ? fixture.entries.length === records.length && fixture.entries.every(id => records.includes(id))
      : entry === fixture.entry,
    content:answer.includes(fixture.must) && (!fixture.also || answer.includes(fixture.also)) &&
      (!fixture.exclude || !answer.includes(fixture.exclude)),
    choices:(route.choices?.length ?? 0) === (fixture.choices ?? 0),
    branch:!fixture.branch || route.options?.length === 1 && route.options[0].id === fixture.branch,
  };
  return {
    entry,records,answer,checks,choices:route.choices?.map(item => item.label) ?? [],
    requestsGemini:!!coach.selectPayload(route,fixture.question),
    pass:Object.values(checks).every(Boolean),
  };
}

module.exports = {cases,evaluate};

