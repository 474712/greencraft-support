#!/usr/bin/env node
/* 调试：打印某条文本在 8 语种下的意图打分明细 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

function makeStub() {
  const noop = () => {};
  const el = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [], childNodes: [], attributes: [], value: '', textContent: '', innerHTML: '',
    appendChild: noop, removeChild: noop, insertBefore: noop, replaceChild: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }),
    focus: noop, blur: noop, click: noop, scrollIntoView: noop,
    getContext: () => null, remove: noop, cloneNode: () => el()
  });
  const document = {
    body: el(), head: el(), documentElement: el(),
    createElement: el, createTextNode: () => ({}), createDocumentFragment: el,
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
    activeElement: null, fonts: { check: () => true }, hidden: false, visibilityState: 'visible'
  };
  const window = {
    document, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: (fn) => { try { fn(0); } catch (e) {} return 0; },
    cancelAnimationFrame: noop, setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), scrollTo: noop, location: { href: '' }
  };
  return { window, document, navigator: { userAgent: 'node', language: 'en-US', languages: ['en-US'] }, console, setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: window.requestAnimationFrame };
}

function loadEngine() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const m = html.match(/<script[^>]*>([\s\S]*)<\/script>/);
  let code = m[1];
  const start = code.indexOf('const LANGUAGES');
  const end = code.indexOf('function initParticles');
  const engineSrc = code.slice(start, end);
  const stub = makeStub();
  const names = ['LANGUAGES','I18N','PRODUCTS','CATEGORIES','KB','INTENT_PATTERNS','PRODUCT_KEYWORDS','state','HANDOFF_PATTERNS','SMALLTALK','QUICK_REPLY_SETS','TYPO_MAP','MODEL_SPECIFIC','MODEL_SERIES','detectIntent','detectProduct','detectHandoff','detectSmalltalk','detectEmotion','findKBResponse','findFuzzyScored','findFuzzy','generateResponse','getQuickReplies','makeTicket','_normText','_matchP','_fold'];
  const factory = new Function('window','document','navigator','console','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame',
    `${engineSrc}\n;return { ${names.join(', ')} };`);
  return factory(stub.window, stub.document, stub.navigator, console, setTimeout, clearTimeout, setInterval, clearInterval, stub.window.requestAnimationFrame);
}

const E = loadEngine();

function explain(text, lang) {
  E.state.lang = lang;
  const lower = E._normText(text);
  console.log(`\n=== [${lang}] "${text}"`);
  console.log(`  normalized: "${lower}"`);
  const scores = [];
  for (const [intent, table] of Object.entries(E.INTENT_PATTERNS)) {
    const lp = table[lang] || table['en'];
    const sLens = [], wLens = [];
    for (const p of lp.strong) if (E._matchP(p, lower)) sLens.push(p.length);
    for (const p of lp.weak) if (E._matchP(p, lower)) wLens.push(p.length);
    const sHits = sLens.map((_, i) => lp.strong.filter((p, j) => p.length === sLens[i] && E._matchP(p, lower)));
    const hits = (arr, lens) => arr.filter(p => E._matchP(p, lower));
    if (!sLens.length && !wLens.length) continue;
    const lens = sLens.slice().sort((a, b) => b - a);
    let sc = lens.length ? 3.0 * lens[0] + lens.slice(1).reduce((a, b) => a + b, 0) : 0;
    sc += 0.4 * wLens.reduce((a, b) => a + b, 0);
    scores.push({ intent, sc, sHits: hits(lp.strong, sLens), wHits: hits(lp.weak, wLens) });
  }
  scores.sort((a, b) => b.sc - a.sc);
  for (const s of scores) {
    console.log(`  ${s.intent.padEnd(13)} ${String(s.sc.toFixed(1)).padStart(6)}  strong[${s.sHits.join(', ')}]  weak[${s.wHits.join(', ')}]`);
  }
  if (!scores.length) console.log('  (无命中)');
  const ps = [];
  for (const [pid, pats] of Object.entries(E.PRODUCT_KEYWORDS)) {
    const lp = pats[lang] || pats['en'];
    const hits = [];
    for (const p of lp) if (E._matchP(p, lower)) hits.push(p);
    if (hits.length) ps.push({ pid, sc: hits.reduce((a, b) => a + b.length * 2, 0), hits });
  }
  ps.sort((a, b) => b.sc - a.sc);
  for (const p of ps) console.log(`  product ${p.pid.padEnd(16)} ${String(p.sc).padStart(5)}  [${p.hits.join(', ')}]`);
  console.log(`  => intent=${E.detectIntent(text)}  product=${E.detectProduct(text)}`);
}

const args = process.argv.slice(2);
if (args.length === 0) { console.log('用法: node tests/debug.js <lang> <text>'); process.exit(0); }
const lang = args[0];
const text = args.slice(1).join(' ');
explain(text, lang);
