'use strict';

const path = require('node:path');
const {cases,evaluate} = require('../test/technique-evaluation.cjs');
const after = require('../lib/coach.cjs');
if (!process.argv[2]) throw new Error('Provide a directory containing the baseline app');
const before = require(path.resolve(process.argv[2],'lib/coach.cjs'));
const results = cases.map(fixture => ({
  id:fixture.id,type:fixture.type,question:fixture.question,
  before:evaluate(before,fixture),after:evaluate(after,fixture),
}));
const counts = Object.create(null);
for (const row of results) {
  const group = counts[row.type] ??= {questions:0,before:0,after:0,requestsGeminiBefore:0,requestsGeminiAfter:0};
  group.questions++;
  group.before += Number(row.before.pass);
  group.after += Number(row.after.pass);
  group.requestsGeminiBefore += Number(row.before.requestsGemini);
  group.requestsGeminiAfter += Number(row.after.requestsGemini);
}
console.log(JSON.stringify({counts,results},null,2));

