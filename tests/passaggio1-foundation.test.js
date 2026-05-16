const assert = require('assert');

global.AppSchema = require('../schemas/app-schema.js');
const StorageMigrations = require('../core/storage-migrations.js');
const LearningDocument = require('../core/learning-document.js');
const MarkdownGenerator = require('../utils/markdown-generator.js');

const settings = AppSchema.normalizeSettings({ language: 'fr', outputFormat: 'txt' });
assert.equal(settings.language, 'it');
assert.equal(settings.outputFormat, 'mdx');
assert.equal(settings.defaultLearningMode, 'study');

const pending = LearningDocument.buildPendingSummary({
  videoId: 'abc123',
  title: 'Test Video',
  channelName: 'Canale Test',
  captionTracks: [{ languageCode: 'it' }],
});
assert.equal(pending.status, 'pending');
assert.equal(pending.entityType, 'learningDocument');
assert.equal(pending.transcriptQuality, 'caption-track');

const extracted = LearningDocument.buildExtractedSummary(
  { ...pending, learningMode: 'summary', outputFormat: 'mdx' },
  '# body',
  '---\noutput\n---',
  { savedFilename: 'LearningHub/test.mdx' }
);
assert.equal(extracted.status, 'extracted');
assert.equal(extracted.learningMode, 'summary');
assert.equal(extracted.savedFilename, 'LearningHub/test.mdx');

const migration = StorageMigrations.migrateLocalState({
  creators: [{ channelId: 'UC1', channelName: 'Creator 1' }],
  summaries: [{ videoId: 'abc123', title: 'Legacy', status: 'pending' }],
  stats: { totalSummarized: 2 },
});
assert.equal(migration.state.creators[0].entityType, 'creator');
assert.equal(migration.state.summaries[0].entityType, 'learningDocument');
assert.equal(migration.state.stats.totalCreators, 1);
assert.equal(migration.state.appMeta.storageSchemaVersion, AppSchema.VERSION);

const learningDoc = MarkdownGenerator.buildLearningDocument(
  { title: 'Video Test', channelName: 'Canale', videoId: 'abc123', transcript: 'Test transcript', learningMode: 'study' },
  [
    '## <a id="mode-study"></a>2. Studio guidato',
    '',
    '### Setup',
    'Contenuto studio',
    '',
    '## <a id="mode-summary"></a>3. Sintesi rapida',
    '',
    'Sintesi breve',
    '',
    '## Mappa concettuale',
    '',
    '```mermaid',
    'mindmap',
    '  root((Test))',
    '```',
  ].join('\n')
);
assert.ok(learningDoc.includes('id="lhv2-mode-verbatim"'));
assert.ok(learningDoc.includes('id="lhv2-mode-study"'));
assert.ok(learningDoc.includes('class="lhv2-app"'));
assert.ok(learningDoc.includes('class="lhv2-agent-study'));

const inlineSafe = MarkdownGenerator.markdownToHtml(
  'Percorso consigliato: `E:\\\\OpenClaude\\\\` e endpoint `https://openrouter.ai/api/v1`.'
);
assert.ok(inlineSafe.includes('<code>{"E:\\\\\\\\OpenClaude\\\\\\\\"}</code>'));
assert.ok(inlineSafe.includes('<code>{"https://openrouter.ai/api/v1"}</code>'));

console.log('passaggio1-foundation.test.js: OK');
