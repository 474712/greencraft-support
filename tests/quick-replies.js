#!/usr/bin/env node
/**
 * GreenCraft Pro · 品类专属快捷提问回归测试
 *
 * 用途：保证「快捷提问随所选品类变化」这一行为不退化，并保证每一条品类专属文案
 * 都是可路由、可作答的真实问题（点击后能命中该品类的知识条目）。
 *
 * 用法：
 *   node tests/quick-replies.js           # 全量
 *   node tests/quick-replies.js --quiet   # 只在失败时打印
 *
 * 原理与 run-tests.js 一致：直接加载线上那份 index.html 里的引擎代码来测，
 * 不引入任何与实现脱节的副本。
 */
const { loadEngine } = require('./engine');

const LANGS = ['zh', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt'];
const PRODS = ['lawn_mower', 'pruner', 'chainsaw', 'hedge_trimmer', 'leaf_blower',
  'pressure_washer', 'brush_cutter', 'tiller', 'wood_chipper', 'robot_mower'];
const CHIP_INTENTS = ['troubleshoot', 'maintenance', 'parts'];
const QUICK = true;

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else fails.push({ name, detail: detail || '' });
}

const E = loadEngine();

/* ------------------------------------------------ 1. 数据结构与逐条可路由性 */
const CHIPS = E.PRODUCT_CHIPS;
check('存在品类专属快捷提问数据 PRODUCT_CHIPS', !!CHIPS, '引擎未导出 PRODUCT_CHIPS');

if (CHIPS) {
  for (const lang of LANGS) {
    check(`${lang} 有品类数据`, !!CHIPS[lang], `缺少 ${lang} 语种数据`);
    for (const pid of PRODS) {
      const set = CHIPS[lang] && CHIPS[lang][pid];
      check(`${lang}/${pid} 有 3 条专属文案`,
        Array.isArray(set) && set.length === 3,
        `实际 ${set ? set.length : '无'} 条`);

      for (const c of (set || [])) {
        const label = `${lang}/${pid}`;
        check(`${label} 条目结构完整`, c && typeof c.q === 'string' && c.q.trim().length > 0 && CHIP_INTENTS.includes(c.i),
          JSON.stringify(c));
        if (!c || typeof c.q !== 'string') continue;

        E.state.lang = lang;
        const gotP = E.detectProduct(c.q);
        const gotI = E.detectIntent(c.q);
        check(`${label}「${c.q}」识别为所属品类`, gotP === pid, `实际 ${gotP}`);
        check(`${label}「${c.q}」识别为标注意图`, gotI === c.i, `实际 ${gotI}`);
        check(`${label}「${c.q}」有对应知识条目`, !!E.findKBResponse(c.i, pid),
          `${c.i}/${pid} 无可检索条目`);
        // 点击卡片必须直接出答案：命中模糊检索时置信度要够（否则引擎会改走澄清追问）
        const fs = E.findFuzzyScored(c.i, pid, c.q);
        check(`${label}「${c.q}」点击后直接作答不追问`,
          !fs || fs.conf >= 0.5 || fs.score >= 10,
          fs ? `置信不足 conf=${fs.conf.toFixed(2)} score=${fs.score.toFixed(1)}（知识问句「${fs.q}」）` : '');
      }
    }
  }

  /* ------------------------------------- 2. 各品类文案互不相同（不「僵化」） */
  for (const lang of LANGS) {
    const sets = PRODS.map(p => (CHIPS[lang] && CHIPS[lang][p] || []).map(c => c.q).join('|'));
    check(`${lang} 各品类文案互不相同`, new Set(sets).size === PRODS.length,
      `去重后仅 ${new Set(sets).size}/${PRODS.length} 种`);
    const all = sets.join('|');
    const generic = Object.values(E.QUICK_REPLY_SETS[lang] || {}).flat().join('|');
    for (const p of PRODS) {
      const set = CHIPS[lang][p] || [];
      check(`${lang}/${p} 文案与通用卡不同`,
        set.every(c => !generic.includes(c.q)),
        `与通用卡重复：${set.filter(c => generic.includes(c.q)).map(c => c.q).join(' / ')}`);
    }
  }

  /* ------------------------- 2b. 中文文案必须与品类标签同名（不「张冠李戴」） */
  // 用户点的是「草坪机」，卡片却写「割草机」——即便识别结果正确，看上去也像串了品类。
  // 中文是路演主界面，强制每条专属文案都带上该品类在筛选条上的中文短名。
  // 其余语种标签是缩写形式（如 de「Mäher」对应文案「Rasenmäher」），不做子串强制。
  for (const pid of PRODS) {
    const cat = (E.CATEGORIES || []).find(c => c.id === pid);
    const short = cat && cat.names && cat.names.zh;
    check(`zh/${pid} 能取到品类中文短名`, !!short, 'CATEGORIES 中未找到该品类中文名');
    if (!short) continue;
    for (const c of (CHIPS.zh[pid] || [])) {
      check(`zh/${pid}「${c.q}」与标签「${short}」同名`, c.q.includes(short),
        `文案未出现标签用词「${short}」`);
    }
  }
}

/* --------------------------------------------- 3. 卡片选取逻辑（行为层） */
function withState(lang, ctx, active, fn) {
  const s = E.state;
  const save = { lang: s.lang, intent: s.context.intent, product: s.context.product, active: s.activeCategory };
  s.lang = lang;
  s.context.intent = ctx.intent;
  s.context.product = ctx.product;
  s.activeCategory = active;
  try { return fn(); }
  finally {
    s.lang = save.lang;
    s.context.intent = save.intent;
    s.context.product = save.product;
    s.activeCategory = save.active;
  }
}

if (CHIPS) {
  for (const lang of LANGS) {
    const sets = E.QUICK_REPLY_SETS[lang] || E.QUICK_REPLY_SETS.en;

    // 3.1 未选品类（「全部」）时行为与原实现完全一致
    check(`${lang} 未选品类·默认走欢迎卡`,
      JSON.stringify(withState(lang, { intent: null, product: null }, 'all', E.getQuickReplies)) === JSON.stringify(sets.welcome),
      '与 QUICK_REPLY_SETS.welcome 不一致');
    for (const it of ['troubleshoot', 'maintenance', 'parts', 'warranty']) {
      check(`${lang} 未选品类·${it} 走通用卡`,
        JSON.stringify(withState(lang, { intent: it, product: null }, 'all', E.getQuickReplies)) === JSON.stringify(sets[it]),
        `与 QUICK_REPLY_SETS.${it} 不一致`);
    }

    // 3.2 选中品类 → 卡片换成该品类的专属文案
    for (const pid of PRODS) {
      const want = (CHIPS[lang][pid] || []).map(c => c.q);
      const got = withState(lang, { intent: null, product: pid }, pid, E.getQuickReplies);
      check(`${lang}/${pid} 选中品类后显示专属文案`,
        JSON.stringify(got) === JSON.stringify(want),
        `实际 ${JSON.stringify(got)}`);

      // 3.3 只选标签（尚未产生语境品类）也要切到专属文案
      const got2 = withState(lang, { intent: null, product: null }, pid, E.getQuickReplies);
      check(`${lang}/${pid} 仅切换标签即显示专属文案`,
        JSON.stringify(got2) === JSON.stringify(want),
        `实际 ${JSON.stringify(got2)}`);
    }

    // 3.4 意图命中时，该意图的专属文案排到首位
    for (const pid of PRODS) {
      const set = CHIPS[lang][pid] || [];
      for (const c of set) {
        const got = withState(lang, { intent: c.i, product: pid }, pid, E.getQuickReplies);
        check(`${lang}/${pid} 命中 ${c.i} 时该文案置顶`,
          Array.isArray(got) && got[0] === c.q,
          `实际首位 ${got && got[0]}`);
        check(`${lang}/${pid} 命中 ${c.i} 时仍为该品类专属`,
          Array.isArray(got) && got.length === 3 && got.every(q => (CHIPS[lang][pid] || []).some(x => x.q === q)),
          `实际 ${JSON.stringify(got)}`);
      }
    }

    // 3.5 品类无关的意图（保修）也不能盖掉品类专属卡：既然选了机器，就显示这台机器的问题
    for (const pid of PRODS) {
      const want = (CHIPS[lang][pid] || []).map(c => c.q);
      const got = withState(lang, { intent: 'warranty', product: pid }, pid, E.getQuickReplies);
      check(`${lang}/${pid} 保修意图下仍显示该品类专属卡`,
        JSON.stringify(got) === JSON.stringify(want),
        `实际 ${JSON.stringify(got)}`);
    }

    // 3.6 切换品类必须换卡
    const a = withState(lang, { intent: null, product: 'lawn_mower' }, 'lawn_mower', E.getQuickReplies);
    const b = withState(lang, { intent: null, product: 'chainsaw' }, 'chainsaw', E.getQuickReplies);
    check(`${lang} 切换品类后卡片内容变化`, JSON.stringify(a) !== JSON.stringify(b), '两张卡内容相同');
  }
}

/* ------------------------- 4. 界面联动：切换品类时卡片必须真的刷新（DOM 层） */
check('导出 selectCategory（切换品类的统一入口）', typeof E.selectCategory === 'function', '引擎未导出 selectCategory');
if (typeof E.selectCategory === 'function') {
  const html = (id) => E.__dom.html(id);
  for (const lang of LANGS) {
    E.state.lang = lang;
    E.state.context.intent = null; E.state.context.product = null; E.state.context.topic = null;

    E.selectCategory('lawn_mower');
    const before = html('quickReplies');
    E.selectCategory('chainsaw');
    const after = html('quickReplies');

    const want = (CHIPS[lang].chainsaw || []).map(c => c.q);
    check(`${lang} 切换品类后卡片被重新渲染`, before !== after, '两次渲染结果相同');
    check(`${lang} 切换品类后卡片内容为新品类专属`,
      want.every(q => after.includes(q)) && !before.includes(want[0]),
      `实际 ${after}`);

    E.selectCategory('all');
    const allCard = html('quickReplies');
    const welcome = E.QUICK_REPLY_SETS[lang].welcome;
    check(`${lang} 切回「全部」恢复通用卡`, welcome.every(q => allCard.includes(q)), `实际 ${allCard}`);
  }

  // 4.1 标签高亮跟随语境品类：问完割草机后，卡片是割草机的，标签也该亮在割草机上
  E.state.lang = 'zh';
  E.state.context.product = 'chainsaw'; E.state.activeCategory = 'all';
  E.renderCategories();
  const catHtml = E.__dom.html('categoryTags');
  check('标签高亮跟随语境品类',
    catHtml.includes('class="category-tag selected" data-cat="chainsaw"'),
    catHtml.slice(0, 220));
}

/* ------------------------------------------------------------- 输出报告 */
if (!quiet) {
  console.log('\n=== GreenCraft Pro · 品类专属快捷提问回归测试 ===\n');
  console.log(`断言 ${pass + fails.length} 条｜通过 ${pass} 条｜失败 ${fails.length} 条\n`);
  if (fails.length) {
    console.log('失败明细：');
    for (const f of fails) console.log(`  ✗ ${f.name}${f.detail ? '  → ' + f.detail : ''}`);
  }
}
if (fails.length) process.exitCode = 1;
