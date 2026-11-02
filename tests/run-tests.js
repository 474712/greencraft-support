#!/usr/bin/env node
/**
 * GreenCraft Pro · 多语种意图识别回归测试
 *
 * 用法：
 *   node tests/run-tests.js                # 跑全量测试并输出报告
 *   node tests/run-tests.js --lang fr      # 只跑法语
 *   node tests/run-tests.js --intent parts # 只跑某个意图
 *   node tests/run-tests.js --quiet        # 只在失败时打印
 *
 * 原理：
 *   线上产物 index.html 是单文件（零依赖、可离线双击打开），因此本脚本不改动其结构，
 *   而是在运行时把 <script> 抽取出来，在 Node 中以最小 DOM 桩执行，直接调用真实的
 *   detectIntent / detectProduct / detectHandoff / detectEmotion / generateResponse。
 *   ——测的就是线上那份代码，不存在"测试用例与实现脱节"的问题。
 */
const fs = require('fs');
const path = require('path');

const { loadEngine, ROOT, INDEX } = require('./engine');

const TESTSET = path.join(__dirname, 'testset.json');
const OUTDIR = path.join(__dirname, 'report');

/* --------------------------------------------------------------- 工具 */
const LANGS = ['en', 'zh', 'fr', 'de', 'es', 'it', 'nl', 'pt'];
const INTENTS = ['troubleshoot', 'maintenance', 'parts', 'warranty', 'compare', 'safety'];

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }

function argFilter() {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--lang') out.lang = a[++i];
    else if (a[i] === '--intent') out.intent = a[++i];
    else if (a[i] === '--set') out.set = a[++i];
    else if (a[i] === '--quiet') out.quiet = true;
  }
  return out;
}

/* ---------------------------------------------------------------- 主流程 */
function main() {
  const args = argFilter();
  const engine = loadEngine();
  const setPath = args.set ? path.join(__dirname, args.set) : TESTSET;
  const raw = JSON.parse(fs.readFileSync(setPath, 'utf8'));
  const cases = raw.cases.filter(c =>
    (!args.lang || c.lang === args.lang) && (!args.intent || c.intent === args.intent));

  if (!cases.length) { console.error('没有匹配的测试用例'); process.exit(1); }

  const results = [];
  const t0 = process.hrtime.bigint();

  for (const c of cases) {
    const saved = engine.state.lang;
    engine.state.lang = c.lang;
    let got = null, gotProduct = null, handoff = false, emotion = null, error = null;
    try {
      got = engine.detectIntent(c.text);
      gotProduct = engine.detectProduct(c.text);
      handoff = engine.detectHandoff(c.text);
      emotion = engine.detectEmotion(c.text);
    } catch (e) { error = e.message; }
    engine.state.lang = saved;

    const intentOk = got === c.intent;
    // 产品标注为可选：仅当用例给出 product 时才断言
    const productOk = !c.product || gotProduct === c.product;
    results.push({
      id: c.id, lang: c.lang, intent: c.intent, product: c.product || null,
      text: c.text, got, gotProduct, handoff, emotion, error,
      ok: intentOk && productOk && !error,
      intentOk, productOk
    });
  }
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  /* 统计 */
  const stat = { total: results.length, passed: 0, byLang: {}, byIntent: {}, failures: [] };
  for (const l of LANGS) stat.byLang[l] = { n: 0, ok: 0 };
  for (const i of INTENTS) stat.byIntent[i] = { n: 0, ok: 0 };
  for (const r of results) {
    if (r.ok) stat.passed++;
    else stat.failures.push(r);
    const L = stat.byLang[r.lang]; L.n++; if (r.ok) L.ok++;
    const I = stat.byIntent[r.intent]; I.n++; if (r.ok) I.ok++;
  }
  stat.accuracy = pct(stat.passed, stat.total);
  stat.perLang = {}; for (const l of LANGS) { const s = stat.byLang[l]; stat.perLang[l] = s.n ? pct(s.ok, s.n) : null; }
  stat.perIntent = {}; for (const i of INTENTS) { const s = stat.byIntent[i]; stat.perIntent[i] = s.n ? pct(s.ok, s.n) : null; }
  stat.elapsedMs = Math.round(elapsedMs * 100) / 100;
  stat.avgMsPerCase = Math.round((elapsedMs / results.length) * 1000) / 1000;

  /* 控制台输出 */
  if (!args.quiet) {
    console.log('\n=== GreenCraft Pro · 多语种意图识别回归测试 ===\n');
    console.log(`样本量 ${stat.total} 条｜通过 ${stat.passed} 条｜总体准确率 ${stat.accuracy}%｜耗时 ${stat.elapsedMs}ms（均 ${stat.avgMsPerCase}ms/条）\n`);
    console.log('分语种准确率：');
    for (const l of LANGS) {
      const s = stat.byLang[l];
      if (!s.n) continue;
      const bar = '█'.repeat(Math.round(pct(s.ok, s.n) / 5)).padEnd(20, '░');
      console.log(`  ${l}  ${String(pct(s.ok, s.n)).padStart(5)}%  ${bar}  ${s.ok}/${s.n}`);
    }
    console.log('\n分意图准确率：');
    for (const i of INTENTS) {
      const s = stat.byIntent[i];
      if (!s.n) continue;
      const bar = '█'.repeat(Math.round(pct(s.ok, s.n) / 5)).padEnd(20, '░');
      console.log(`  ${i.padEnd(13)}${String(pct(s.ok, s.n)).padStart(5)}%  ${bar}  ${s.ok}/${s.n}`);
    }
    if (stat.failures.length) {
      console.log(`\n失败用例（${stat.failures.length} 条）：`);
      for (const f of stat.failures) {
        console.log(`  ✗ [${f.lang}/${f.intent}] ${f.text}`);
        console.log(`      期望 intent=${f.intent}${f.product ? ` product=${f.product}` : ''}｜实际 intent=${f.got}${f.product ? ` product=${f.gotProduct}` : ''}${f.error ? `｜异常=${f.error}` : ''}`);
      }
    }
  } else if (stat.failures.length) {
    for (const f of stat.failures) console.log(`✗ [${f.lang}/${f.intent}] ${f.text} → got ${f.got}`);
  }

  /* 落盘报告 */
  fs.mkdirSync(OUTDIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const setName = path.basename(setPath, '.json');
  const payload = {
    generatedAt: new Date().toISOString(),
    set: setName,
    build: (fs.existsSync(path.join(ROOT, '.git')) ? require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() : 'n/a'),
    sampleSize: stat.total, passed: stat.passed, accuracy: stat.accuracy,
    perLang: stat.perLang, perIntent: stat.perIntent,
    failures: stat.failures.map(f => ({ id: f.id, lang: f.lang, expected: f.intent, got: f.got, expectedProduct: f.product, gotProduct: f.gotProduct, text: f.text })),
    timing: { totalMs: stat.elapsedMs, avgMsPerCase: stat.avgMsPerCase }
  };
  fs.writeFileSync(path.join(OUTDIR, `metrics-${setName}.json`), JSON.stringify(payload, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUTDIR, `metrics-${setName}-${stamp}.json`), JSON.stringify(payload, null, 2), 'utf8');

  console.log(`\n报告已写入 tests/report/metrics-${setName}.json`);
  if (stat.failures.length) process.exitCode = 1;
}

main();
