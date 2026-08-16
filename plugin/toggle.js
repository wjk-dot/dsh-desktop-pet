/* 桌宠开关：由插件注入 DSH 界面 index.html（随每次页面响应读取本文件）。
 * 修改本文件后只需刷新 DSH 页面（Cmd+R）即可生效，无需重启应用。
 * 点按切换 /api/pet/control；失败时按钮显示 ⚠ 错误提示。 */
(function () {
  'use strict';
  var KEY = 'dsh-desktop-pet-toggle';
  var css = '#' + KEY + '{position:fixed;left:14px;bottom:14px;z-index:2147483000;' +
    'display:flex;align-items:center;gap:6px;padding:7px 12px;border:none;border-radius:999px;' +
    'font:600 12px/1 -apple-system,"PingFang SC",sans-serif;cursor:pointer;' +
    'color:#fff;background:linear-gradient(135deg,#4d6bfe,#4dacff);' +
    'box-shadow:0 4px 14px rgba(30,80,180,.35);transition:opacity .15s,filter .15s;} ' +
    '#' + KEY + '.off{background:#8a97ad;opacity:.75;filter:saturate(.4);} ' +
    '#' + KEY + ':hover{opacity:.92;}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  var btn = document.createElement('button');
  btn.id = KEY;
  btn.title = '开启 / 关闭桌宠';
  btn.type = 'button';
  btn.textContent = '🐋';
  document.body.appendChild(btn);

  var on = true;
  var errText = '';
  function paint() {
    btn.classList.toggle('off', !on);
    btn.textContent = errText ? ('⚠ ' + errText) : (on ? '🐋 桌宠开' : '🐋 桌宠关');
  }
  function fail(msg) {
    errText = msg;
    paint();
    setTimeout(function () { errText = ''; paint(); }, 4000);
  }
  function apply(d) {
    if (d && typeof d.enabled === 'boolean') { on = d.enabled; paint(); }
  }
  function refresh() {
    fetch('/api/pet/control', { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(apply)
      .catch(function () { fail('连接失败'); });
  }
  btn.addEventListener('click', function () {
    fetch('/api/pet/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !on }),
    }).then(function (r) { return r.json(); }).then(apply)
      .catch(function () { fail('操作失败'); });
  });
  refresh();
})();
