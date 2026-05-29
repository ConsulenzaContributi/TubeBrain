// tests/area3a-grounding-prompt.test.js
const assert = require('assert');
const GeminiAPI = require('../utils/gemini.js');
const prompt = GeminiAPI.buildLearningSectionsPrompt({ videoId: 'abc', title: 'T', channelName: 'C', transcript: '[0:00] ciao', chapters: [] }, 'it', {});
assert.ok(/grounding|ancora/i.test(prompt), 'manca regola di grounding');
assert.ok(prompt.includes('(inferenza)'), 'manca marcatura inferenze');
assert.ok(/\[mm:ss\]|\[minuti:secondi\]|timestamp/i.test(prompt), 'manca richiesta timestamp');
console.log('area3a-grounding-prompt OK');
