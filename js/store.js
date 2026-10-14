/* 本地存储：设置(localStorage) + 作文/批改历史(localStorage) */
window.AEG = window.AEG || {};
(function () {
  var LS = window.localStorage;
  var K = {
    settings: 'aeg.settings.v1',
    essays: 'aeg.essays.v1',
    corrections: 'aeg.corrections.v1'
  };

  function readJson(key, def) {
    try {
      var s = LS.getItem(key);
      return s ? JSON.parse(s) : def;
    } catch (e) { return def; }
  }
  function writeJson(key, val) {
    try { LS.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  var defaultSettings = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    chatModel: 'deepseek-chat',
    visionModel: '',
    temperature: 0.3,
    timeoutMs: 30000,
    extraInstructions: '',
    jsonMode: false,
    useProxy: false,
    proxyUrl: 'http://127.0.0.1:8787/api/llm'
  };

  function getSettings() {
    var s = readJson(K.settings, {}) || {};
    var out = {};
    for (var k in defaultSettings) out[k] = (s[k] !== undefined ? s[k] : defaultSettings[k]);
    return out;
  }
  function saveSettings(patch) {
    var cur = readJson(K.settings, {}) || {};
    for (var k in patch) cur[k] = patch[k];
    return writeJson(K.settings, cur);
  }
  function settingsReady() {
    var s = getSettings();
    return !!(s.baseUrl && s.apiKey && s.chatModel);
  }
  function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return '****' + key.slice(-4);
  }

  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function listEssays() {
    return readJson(K.essays, []) || [];
  }
  function saveEssay(essay) {
    var all = listEssays();
    var i = -1;
    for (var j = 0; j < all.length; j++) if (all[j].id === essay.id) { i = j; break; }
    if (i >= 0) all[i] = essay; else all.unshift(essay);
    return writeJson(K.essays, all.slice(0, 200));
  }
  function getEssay(id) {
    var all = listEssays();
    for (var j = 0; j < all.length; j++) if (all[j].id === id) return all[j];
    return null;
  }
  function deleteEssay(id) {
    writeJson(K.essays, listEssays().filter(function (e) { return e.id !== id; }));
    writeJson(K.corrections, listCorrections().filter(function (c) { return c.essayId !== id; }));
  }

  function listCorrections() {
    return readJson(K.corrections, []) || [];
  }
  function saveCorrection(result) {
    var all = listCorrections();
    var i = -1;
    for (var j = 0; j < all.length; j++) if (all[j].id === result.id) { i = j; break; }
    if (i >= 0) all[i] = result; else all.unshift(result);
    return writeJson(K.corrections, all.slice(0, 200));
  }
  function correctionsOf(essayId) {
    return listCorrections().filter(function (c) { return c.essayId === essayId; });
  }

  function exportBackup(includeKey) {
    var data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: getSettings(),
      essays: listEssays(),
      corrections: listCorrections()
    };
    if (!includeKey) data.settings.apiKey = '';
    return JSON.stringify(data, null, 2);
  }
  function importBackup(json) {
    var data = JSON.parse(json);
    if (data.settings) saveSettings(data.settings);
    if (Array.isArray(data.essays)) writeJson(K.essays, data.essays);
    if (Array.isArray(data.corrections)) writeJson(K.corrections, data.corrections);
  }
  function clearAll() {
    LS.removeItem(K.settings);
    LS.removeItem(K.essays);
    LS.removeItem(K.corrections);
  }

  AEG.store = {
    getSettings: getSettings,
    saveSettings: saveSettings,
    settingsReady: settingsReady,
    maskKey: maskKey,
    uid: uid,
    listEssays: listEssays,
    saveEssay: saveEssay,
    getEssay: getEssay,
    deleteEssay: deleteEssay,
    listCorrections: listCorrections,
    saveCorrection: saveCorrection,
    correctionsOf: correctionsOf,
    exportBackup: exportBackup,
    importBackup: importBackup,
    clearAll: clearAll
  };
})();
