// tests/area5-i18n.test.js
const assert = require('assert');
const I18n = require('../utils/i18n.js');
assert.equal(typeof I18n.t, 'function');
// chiave esistente in EN e IT
assert.notEqual(I18n.t('popup.generate', 'en'), I18n.t('popup.generate', 'it'));
// fallback a IT se manca la lingua
assert.equal(I18n.t('popup.generate', 'xx'), I18n.t('popup.generate', 'it'));
// fallback alla chiave se manca del tutto
assert.equal(I18n.t('chiave.inesistente', 'it'), 'chiave.inesistente');
// dizionari coerenti: ogni chiave EN esiste in IT
const { DICT } = I18n;
Object.keys(DICT.en).forEach(k => assert.ok(k in DICT.it, 'chiave mancante in it: ' + k));
console.log('area5-i18n OK');
