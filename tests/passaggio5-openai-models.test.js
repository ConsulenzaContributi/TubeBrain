const assert = require('assert');

const OpenAIAPI = require('../utils/openai.js');

assert.equal(OpenAIAPI.resolveModel({ openaiModel: 'gpt-5' }), 'gpt-5');
assert.equal(OpenAIAPI.resolveModel({ openaiModel: 'gpt-4.1' }), 'gpt-4.1');
assert.equal(OpenAIAPI.resolveModel({ openaiModel: '   gpt-5-mini   ' }), 'gpt-5-mini');
assert.equal(OpenAIAPI.resolveModel({}), OpenAIAPI.DEFAULT_MODEL);

console.log('passaggio5-openai-models.test.js: OK');
