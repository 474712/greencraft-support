/**
 * GreenCraft Pro · 引擎加载器
 *
 * 线上产物 index.html 是单文件（零依赖、可离线双击打开），因此测试不改动其结构，
 * 而是在运行时把 <script> 抽取出来，在 Node 中以最小 DOM 桩执行，
 * 直接调用真实的 detectIntent / detectProduct / generateResponse 等函数。
 * ——测的就是线上那份代码，不存在"测试用例与实现脱节"的问题。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');

/* ---------------------------------------------------------------- DOM 桩 */
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
    requestAnimationFrame: (fn) => { try { fn(0); } catch (e) { /* ignore */ } return 0; },
    cancelAnimationFrame: noop, setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }), scrollTo: noop, location: { href: '' }
  };
  return {
    window, document,
    navigator: { userAgent: 'node', language: 'en-US', languages: ['en-US'] },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: window.requestAnimationFrame
  };
}

/* ------------------------------------------------------------ 加载引擎 */
const EXPORTS = [
  'LANGUAGES', 'I18N', 'PRODUCTS', 'CATEGORIES', 'KB', 'INTENT_PATTERNS', 'PRODUCT_KEYWORDS',
  'state', 'HANDOFF_PATTERNS', 'SMALLTALK', 'SMALLTALK_REPLY', 'QUICK_REPLY_SETS', 'TYPO_MAP',
  'CONFIRM_ASK', 'DENY_ASK', 'EMPATHY', 'EMPATHY_HANDOFF',
  'detectIntent', 'detectProduct', 'detectHandoff', 'detectSmalltalk', 'detectEmotion',
  'findKBResponse', 'findFuzzyScored', 'findFuzzy', 'generateResponse', 'getQuickReplies',
  'makeTicket', '_normText', '_decision', 'resetDecision',
  '_normCache', '_foldCache'
];

function loadEngine() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const m = html.match(/<script[^>]*>([\s\S]*)<\/script>/);
  if (!m) throw new Error('index.html 中未找到 <script> 块');
  const code = m[1];

  // 抽取纯逻辑区（数据常量 + 引擎函数），跳过 DOM 渲染与 init
  // 区间边界必须覆盖到所有被导出符号的定义处。
  const start = code.indexOf('const LANGUAGES');
  const end = code.indexOf('function initParticles');
  if (start < 0 || end < 0) throw new Error('未能定位引擎代码区间（依赖 index.html 的结构，请同步维护）');
  const engineSrc = code.slice(start, end);

  const stub = makeStub();
  const factory = new Function(
    'window', 'document', 'navigator', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
    `${engineSrc}\n;return { ${EXPORTS.join(', ')} };`
  );
  return factory(
    stub.window, stub.document, stub.navigator, console,
    setTimeout, clearTimeout, setInterval, clearInterval, stub.window.requestAnimationFrame
  );
}

module.exports = { loadEngine, ROOT, INDEX };
