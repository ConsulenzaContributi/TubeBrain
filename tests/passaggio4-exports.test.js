const assert = require('assert');

const ExportFormatters = require('../renderers/export-formatters.js');

const summary = {
  id: 'sm_1',
  title: 'Tutorial Batch',
  channelName: 'Canale Test',
  channelId: 'UC123',
  sourceType: 'youtube',
  platform: 'youtube',
  videoId: 'abc123',
  url: 'https://youtube.com/watch?v=abc123',
  publishDate: '2026-05-16',
  learningMode: 'study',
  outputFormat: 'mdx',
  transcriptQuality: 'high',
  transcriptQualityReason: 'Caption manuali',
  tags: ['tutorial', 'batch'],
  contentType: 'video',
  durationBucket: 'deep',
  status: 'extracted',
  fullMarkdown: `---
title: "Tutorial Batch"
---

## <a id="mode-study"></a>2. Studio guidato

### Setup
Checklist e passaggi

## <a id="mode-summary"></a>3. Sintesi rapida

Sintesi capitolo

## Errori frequenti e recovery

Errore 1`,
};

const txt = ExportFormatters.buildContent(summary, 'txt');
assert.ok(txt.includes('Titolo: Tutorial Batch'));
assert.ok(!txt.includes('---'));

const json = JSON.parse(ExportFormatters.buildContent(summary, 'json'));
assert.equal(json.videoId, 'abc123');
assert.equal(json.outputFormat, 'mdx');

const antigravity = JSON.parse(ExportFormatters.buildContent(summary, 'antigravity'));
assert.equal(antigravity.schema, 'antigravity-workflow.v1');
assert.ok(antigravity.sections.study.includes('Setup'));

console.log('passaggio4-exports.test.js: OK');
