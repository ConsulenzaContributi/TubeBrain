// tests/area3b-transcript-guard.test.js
const assert = require('assert');
const Transcript = require('../utils/transcript.js');
assert.equal(typeof Transcript.hasUsableTranscript, 'function');
assert.equal(Transcript.hasUsableTranscript({ transcript: '' }), false);
assert.equal(Transcript.hasUsableTranscript({ transcript: '   ' }), false);
assert.equal(Transcript.hasUsableTranscript({}), false);
assert.equal(Transcript.hasUsableTranscript({ transcript: '[0:00] contenuto reale' }), true);
console.log('area3b-transcript-guard OK');
