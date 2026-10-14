/* 确定性随机数：手写扰动按字符下标派生，保证渲染一致 */
window.AEG = window.AEG || {};
(function () {
  function hash(n) {
    let h = (n + 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  AEG.rng = {
    hash: hash,
    mulberry32: mulberry32,
    seeded: function (seed) { return mulberry32(hash(seed)); }
  };
})();
