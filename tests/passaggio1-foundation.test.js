const assert = require('assert');

global.AppSchema = require('../schemas/app-schema.js');
const StorageMigrations = require('../core/storage-migrations.js');
const LearningDocument = require('../core/learning-document.js');

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

console.log('passaggio1-foundation.test.js: OK');
