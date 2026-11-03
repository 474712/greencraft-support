#!/usr/bin/env node
/**
 * GreenCraft Pro · 演示讲解条回归测试
 *
 * 背景：演示模式原先用 position:fixed 的浮动气泡播报讲解，气泡压在对话区上方，
 * 演示结束时更会把该场景所有讲解一次性铺满屏幕——录视频时答案被盖住。
 * 现改为「对话区顶部解说条」：解说条是 chat-main 内的普通流元素，
 * 排在 messages-container 之前，消息区自动让位，物理上遮挡不到答案。
 *
 * 用法：
 *   node tests/annotations.js           # 全量
 *   node tests/annotations.js --quiet   # 只在失败时打印
 *
 * 与 run-tests.js 同一原则：测的是线上那份 index.html，不引入副本。
 */
const fs = require('fs');
const { loadEngine, INDEX } = require('./engine');

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else fails.push({ name, detail: detail || '' });
}

const SRC = fs.readFileSync(INDEX, 'utf8');
const E = loadEngine();

/* ══════════════════════════════════════════ 1. 源码结构：解说条必须是普通流元素 */
check('存在解说条容器 id="annoBar"', SRC.includes('id="annoBar"'), 'index.html 中未找到 annoBar');
check('存在解说条文本节点 id="annoBarText"', SRC.includes('id="annoBarText"'), '未找到 annoBarText');

const iBar = SRC.indexOf('id="annoBar"');
const iMsg = SRC.indexOf('id="messagesContainer"');
const iMain = SRC.indexOf('<main class="chat-main">');
const iMainEnd = SRC.indexOf('</main>');
check('解说条排在消息区之前', iBar > 0 && iMsg > 0 && iBar < iMsg, `annoBar@${iBar} messagesContainer@${iMsg}`);
check('解说条与消息区同在 chat-main 内', iBar > iMain && iMsg < iMainEnd && iMain > 0,
  `chat-main@${iMain} </main>@${iMainEnd}`);

const annoCss = (SRC.match(/\.anno-bar\s*\{[^}]*\}/) || [''])[0];
check('解说条不是 fixed/absolute 定位', !/position\s*:\s*(fixed|absolute)/.test(annoCss), annoCss.trim());

check('已移除浮动覆盖层 annotation-overlay', !SRC.includes('annotation-overlay'), 'annotation-overlay 仍存在');
check('已移除浮动气泡 annotation-bubble', !SRC.includes('annotation-bubble'), 'annotation-bubble 仍存在');
check('已移除压在输入框上的浮层控制条 annotation-ctrls', !SRC.includes('annotation-ctrls'), 'annotation-ctrls 仍存在');
check('已移除气泡定位函数 getAnnotationPos', !SRC.includes('getAnnotationPos'), 'getAnnotationPos 仍存在');
check('场景数据不再保留无用的 pos 字段',
  !/pos\s*:\s*'(top-right|bottom-left|top-left|bottom-right)'/.test(SRC), '仍存在 pos 字段');

/* ══════════════════════════════════════════════ 2. 行为：同一时刻只讲一条 */
const SCEN = E.DEMO_SCENARIOS || {};
const SCEN_IDS = Object.keys(SCEN);
check('演示场景数据可读', SCEN_IDS.length > 0, 'DEMO_SCENARIOS 未导出');

function collectAnnotations(scenId) {
  const steps = (SCEN[scenId] && SCEN[scenId].steps) || [];
  return steps.filter(s => s.type === 'annotation')
    .map((a, i) => ({ index: i, style: a.style, icon: a.icon, text: a.text }));
}

const need = ['demoState', 'showAnnotationSingle', 'showAllAnnotations', 'nextAnnotation', 'prevAnnotation', 'hideAnnotation'];
for (const k of need) {
  check(`导出 ${k}`, E[k] !== undefined, '引擎未导出 ' + k);
}

if (SCEN_IDS.length && E.demoState && typeof E.showAnnotationSingle === 'function') {
  const dom = E.__dom;
  for (const sid of SCEN_IDS) {
    const annos = collectAnnotations(sid);
    if (!annos.length) continue;

    E.demoState.annotations = annos.map(a => ({ ...a }));
    E.demoState.annotationIndex = -1;
    E.demoState.annoReview = false;

    // 2.1 播放中：讲解正文进入解说条
    E.showAnnotationSingle(0);
    const txt = dom.get('annoBarText').textContent;
    check(`${sid} 讲解正文进入解说条`, txt === annos[0].text, `实际「${String(txt).slice(0, 40)}」`);
    check(`${sid} 解说条图标同步`, dom.get('annoBarIcon').textContent === annos[0].icon,
      `实际「${dom.get('annoBarIcon').textContent}」`);

    // 2.2 同一时刻解说条里只有一条讲解正文
    for (const other of annos.slice(1)) {
      check(`${sid} 同一时刻只显示一条讲解`, !String(txt).includes(other.text), `泄漏了「${other.text.slice(0, 20)}」`);
    }

    // 2.3 演示结束进入回顾模式：不能再把全部讲解一次性铺开
    E.showAllAnnotations();
    const navHtml = dom.html('annoBarNav');
    const barText = dom.get('annoBarText').textContent;
    check(`${sid} 回顾模式解说条只显示一条正文`,
      annos.some(a => a.text === barText), `实际「${String(barText).slice(0, 30)}」`);
    for (const a of annos) {
      check(`${sid} 回顾模式不铺开讲解正文`, !navHtml.includes(a.text), `铺开了「${a.text.slice(0, 20)}」`);
    }
    const badges = (navHtml.match(/anno-bar-badge/g) || []).length;
    check(`${sid} 回顾模式徽标数等于讲解条数`, badges === annos.length, `实际 ${badges} / ${annos.length}`);

    // 2.4 回顾模式切换：next / prev 换的是解说条里的正文
    if (annos.length > 1) {
      E.nextAnnotation();
      check(`${sid} 下一条切换解说条正文`, dom.get('annoBarText').textContent === annos[1].text,
        `实际「${String(dom.get('annoBarText').textContent).slice(0, 30)}」`);
      E.prevAnnotation();
      check(`${sid} 上一条切回解说条正文`, dom.get('annoBarText').textContent === annos[0].text,
        `实际「${String(dom.get('annoBarText').textContent).slice(0, 30)}」`);
    }

    // 2.5 关闭：解说条清空
    E.hideAnnotation();
    check(`${sid} 关闭讲解后正文清空`, dom.get('annoBarText').textContent === '',
      `实际「${String(dom.get('annoBarText').textContent).slice(0, 30)}」`);
    check(`${sid} 关闭讲解后徽标清空`, dom.html('annoBarNav').indexOf('anno-bar-badge') === -1, '徽标残留');
    check(`${sid} 关闭讲解后无讲解残留`, E.demoState.annotations.length === 0, 'annotations 未清空');
  }
}

/* ------------------------------------------------------------- 输出报告 */
if (!quiet) {
  console.log('\n=== GreenCraft Pro · 演示讲解条回归测试 ===\n');
  console.log(`断言 ${pass + fails.length} 条｜通过 ${pass} 条｜失败 ${fails.length} 条\n`);
  if (fails.length) {
    console.log('失败明细：');
    for (const f of fails) console.log(`  ✗ ${f.name}${f.detail ? '  → ' + f.detail : ''}`);
  }
}
if (fails.length) process.exitCode = 1;
