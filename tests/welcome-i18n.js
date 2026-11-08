#!/usr/bin/env node
/**
 * GreenCraft Pro · 开场提示语随语种重译回归测试
 *
 * 用途：保证「切换界面语言后，开场两条机器人气泡（AI 服务披露 + 欢迎语）跟着重译」
 * 这一行为不退化，并保证切换引导文案 langHint 在 8 语种齐全。
 *
 * 用法：
 *   node tests/welcome-i18n.js           # 全量
 *   node tests/welcome-i18n.js --quiet   # 只在失败时打印
 *
 * 原理与 run-tests.js 一致：直接加载线上那份 index.html 里的引擎代码来测，
 * 不引入任何与实现脱节的副本。DOM 写入部分由浏览器实机验证覆盖，
 * 这里断言的是驱动 renderMessages() 的消息模型。
 */
const { loadEngine } = require('./engine');

const LANGS = ['zh', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt'];

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else fails.push({ name, detail: detail || '' });
}

const E = loadEngine();

/* ------------------------------------------------- 1. langHint 8 语种齐全 */
const HINT = E.I18N && E.I18N.langHint;
check('存在切换引导文案 I18N.langHint', !!HINT, '引擎未导出 I18N.langHint');

if (HINT) {
  for (const lang of LANGS) {
    const t = HINT[lang];
    check(`${lang} 有 langHint 文案`, typeof t === 'string' && t.trim().length > 0, `实际 ${JSON.stringify(t)}`);
  }
  check('langHint 无多余语种', Object.keys(HINT).every(k => LANGS.includes(k)),
    `多出的键 ${Object.keys(HINT).filter(k => !LANGS.includes(k)).join(',')}`);
}

/* ------------------------------------- 2. welcomeMsg 原文不被污染（引导语是拼上去的） */
if (HINT) {
  for (const lang of LANGS) {
    check(`${lang} welcomeMsg 原文未混入引导语`,
      !(E.I18N.welcomeMsg[lang] || '').includes(HINT[lang]),
      'welcomeMsg 源串被改写，应改为在 welcomeText() 里拼接');
  }
}

/* --------------------------------------------- 3. welcomeText 组合正确 */
check('导出 welcomeText 函数', typeof E.welcomeText === 'function', '引擎未导出 welcomeText');

if (typeof E.welcomeText === 'function') {
  for (const lang of LANGS) {
    const txt = E.welcomeText(lang);
    check(`${lang} welcomeText 含欢迎语正文`,
      typeof txt === 'string' && txt.includes(E.I18N.welcomeMsg[lang]),
      `实际 ${(txt || '').slice(0, 60)}`);
    check(`${lang} welcomeText 含切换引导语`,
      typeof txt === 'string' && txt.includes(E.I18N.langHint[lang]),
      `实际 ${(txt || '').slice(-60)}`);
  }
  check('welcomeText 缺省回落英语',
    typeof E.welcomeText('xx') === 'string' && E.welcomeText('xx').includes(E.I18N.welcomeMsg.en),
    `实际 ${(E.welcomeText('xx') || '').slice(0, 60)}`);
}

/* --------------------------------- 4. updateWelcomeI18n 只重译开场两条 */
check('导出 updateWelcomeI18n 函数', typeof E.updateWelcomeI18n === 'function',
  '引擎未导出 updateWelcomeI18n');

if (typeof E.updateWelcomeI18n === 'function') {
  const seed = () => {
    E.state.messages = [
      { type: 'bot', text: '旧披露', time: '12:00', i18nKey: 'aiNotice' },
      { type: 'bot', text: '旧欢迎', time: '12:00', i18nKey: 'welcomeMsg' },
      { type: 'user', text: 'My mower will not start', time: '12:01' },
      { type: 'bot', text: 'Please check the battery.', time: '12:01' }
    ];
  };

  for (const lang of LANGS) {
    seed();
    E.state.lang = lang;
    E.updateWelcomeI18n();
    check(`${lang} 披露气泡重译`, E.state.messages[0].text === E.I18N.aiNotice[lang],
      `实际 ${E.state.messages[0].text.slice(0, 50)}`);
    check(`${lang} 欢迎气泡重译`, E.state.messages[1].text === E.welcomeText(lang),
      `实际 ${E.state.messages[1].text.slice(0, 50)}`);
    check(`${lang} 用户历史未被改动`, E.state.messages[2].text === 'My mower will not start',
      `实际 ${E.state.messages[2].text}`);
    check(`${lang} 机器人历史未被改动`, E.state.messages[3].text === 'Please check the battery.',
      `实际 ${E.state.messages[3].text}`);
  }

  // 4.1 连续切换不累积拼接：切走再切回，文本应等于该语种的一次组合结果
  seed();
  E.state.lang = 'fr'; E.updateWelcomeI18n();
  E.state.lang = 'de'; E.updateWelcomeI18n();
  E.state.lang = 'zh'; E.updateWelcomeI18n();
  check('连续切换后欢迎语不累积', E.state.messages[1].text === E.welcomeText('zh'),
    `实际长度 ${E.state.messages[1].text.length}，期望 ${E.welcomeText('zh').length}`);

  // 4.2 空会话不应抛错
  E.state.messages = [];
  let threw = null;
  try { E.state.lang = 'en'; E.updateWelcomeI18n(); } catch (e) { threw = e.message; }
  check('空会话调用不抛错', threw === null, threw);
}

/* ------------------------------------------------------------- 输出报告 */
if (!quiet) {
  console.log('\n=== GreenCraft Pro · 开场提示语随语种重译回归测试 ===\n');
  console.log(`断言 ${pass + fails.length} 条｜通过 ${pass} 条｜失败 ${fails.length} 条\n`);
  if (fails.length) {
    console.log('失败明细：');
    for (const f of fails) console.log(`  ✗ ${f.name}${f.detail ? '  → ' + f.detail : ''}`);
  }
}
if (fails.length) process.exitCode = 1;
