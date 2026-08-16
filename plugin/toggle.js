/* 桌宠开关 v2：由插件注入 DSH 界面（随每次页面响应读取本文件）。
 * - 默认右上角、可拖拽到任意位置（localStorage 记忆）
 * - 点击先即时更新，服务端响应后再确认；轮询只负责外部切换兜底
 * - 点击立即切换 /api/pet/control；失败显示 ⚠ 提示
 */
(function () {
  'use strict';
  var KEY = 'dsh-desktop-pet-toggle';
  var POS_KEY = 'dsh-desktop-pet-toggle-pos';
  var css = '#' + KEY + '{position:fixed;top:12px;right:12px;z-index:2147483000;' +
    'display:flex;align-items:center;gap:5px;padding:5px 10px;border:none;border-radius:999px;' +
    'font:600 11px/1 -apple-system,"PingFang SC",sans-serif;cursor:pointer;user-select:none;' +
    'color:#fff;background:linear-gradient(135deg,#4d6bfe,#4dacff);opacity:.85;' +
    'box-shadow:0 3px 10px rgba(30,80,180,.35);transition:opacity .15s,filter .15s;} ' +
    '#' + KEY + ':hover{opacity:1;} ' +
    '#' + KEY + '.off{background:#8a97ad;opacity:.7;filter:saturate(.4);}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  var btn = document.createElement('button');
  btn.id = KEY;
  btn.title = '开启 / 关闭桌宠（可拖动）';
  btn.type = 'button';
  document.body.appendChild(btn);

  var on = true;
  var errText = '';
  var pending = false;
  function paint() {
    btn.classList.toggle('off', !on);
    btn.textContent = errText ? ('⚠ ' + errText) : (on ? '🐋 开' : '🐋 关');
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
    if (pending) return;
    fetch('/api/pet/control', { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(apply)
      .catch(function () {});
  }

  /* ---- 拖动定位（默认右上角；localStorage 记忆） ---- */
  function restorePos() {
    try {
      var pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        btn.style.left = pos.left + 'px';
        btn.style.top = pos.top + 'px';
        btn.style.right = 'auto';
      }
    } catch (e) {}
  }
  function savePos() {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({
        left: btn.offsetLeft,
        top: btn.offsetTop,
      }));
    } catch (e) {}
  }
  var drag = null;
  btn.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    drag = { dx: e.clientX - btn.offsetLeft, dy: e.clientY - btn.offsetTop, moved: false };
  });
  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    btn.style.left = (e.clientX - drag.dx) + 'px';
    btn.style.top = (e.clientY - drag.dy) + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
    drag.moved = true;
  });
  window.addEventListener('mouseup', function () {
    if (drag && drag.moved) savePos();
    drag = null;
  });

  /* ---- 点击切换 ---- */
  btn.addEventListener('click', function (e) {
    if (drag && drag.moved) { e.stopPropagation(); return; }
    e.stopPropagation();
    if (pending) return;
    var desired = !on;
    pending = true;
    on = desired;
    paint();
    fetch('/api/pet/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: desired }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      pending = false;
      apply(data);
    }).catch(function () {
      pending = false;
      on = !desired;
      fail('失败');
    });
  });

  restorePos();
  paint();
  refresh();
  setInterval(refresh, 5000);
})();
