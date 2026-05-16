const assert = require('assert');

const Transcript = require('../utils/transcript.js');
const GeminiAPI = require('../utils/gemini.js');

const rawSegments = [
  { startMs: 0, text: 'Introduzione al progetto e obiettivi del tutorial' },
  { startMs: 20000, text: 'Installiamo le dipendenze e prepariamo l ambiente' },
  { startMs: 800000, text: 'Passiamo alla configurazione avanzata e ai test finali' },
];

const generatedChapters = Transcript.normalizeChapters([], rawSegments);
assert.ok(generatedChapters.length >= 2);

const highQuality = Transcript.assessTranscriptQuality(
  rawSegments.map((seg, index) => ({ startMs: index * 12000, text: `${seg.text} dettaglio tecnico extra` })),
  { kind: 'manual', languageCode: 'it' }
);
assert.ok(['medium', 'high'].includes(highQuality.level));

const lowQuality = Transcript.assessTranscriptQuality(
  [{ startMs: 0, text: 'ciao' }, { startMs: 1000, text: 'ciao' }, { startMs: 2000, text: 'ciao' }],
  { kind: 'asr', languageCode: 'it' }
);
assert.ok(['low', 'medium'].includes(lowQuality.level));

const prompt = GeminiAPI.buildLearningSectionsPrompt({
  title: 'Tutorial Test',
  channelName: 'Canale Test',
  videoId: 'abc123',
  description: 'Video tecnico di prova',
  chapters: generatedChapters,
  transcript: '## Sezione 1 [0:00]\nContenuto\n\n## Sezione 2 [13:20]\nContenuto finale',
  transcriptQuality: highQuality,
  durationBucket: 'deep',
}, 'it');

assert.ok(prompt.includes('## Flashcard'));
assert.ok(prompt.includes('## Quiz finale'));
assert.ok(prompt.includes('## Errori frequenti e recovery'));

console.log('passaggio3-learning-engine.test.js: OK');
