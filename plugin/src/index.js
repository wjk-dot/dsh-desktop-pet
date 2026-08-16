/**
 * dsh-desktop-pet host 半区入口：挂载对话服务 + 路由 + 端口桥 + DSH 界面开关。
 * 安装方式见 README：把本包加入 dsh profile，并在 profile 的
 * cordis.patch.yml 插入一行 { id: desktop-pet, name: '@linxin666/dsh-desktop-pet' }。
 */

import { PetChatService } from './chat.js'
import { writeBridgeFile } from './bridge.js'
import { loadEnabled, saveEnabled } from './control.js'
import { makePetRoutes } from './routes.js'

/** 稳定的 cordis 插件名（与 patch 插入行 id 对应）。 */
export const name = 'desktop-pet'

/** 依赖服务：web 服务器（挂路由/注入开关）、LLM 通道、全局默认模型。 */
export const inject = ['webServer', 'llm', 'agentDefaultModel']

/**
 * 注入到 DSH 界面右下角（避开聊天区）的桌宠开关：
 * 悬浮小按钮，点按切换 /api/pet/control；随 index.html 每次响应注入。
 */
const TOGGLE_SCRIPT = `<script>
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
  function paint() {
    btn.classList.toggle('off', !on);
    btn.textContent = on ? '🐋 桌宠开' : '🐋 桌宠关';
  }
  function apply(d) {
    if (d && typeof d.enabled === 'boolean') { on = d.enabled; paint(); }
  }
  function refresh() {
    fetch('/api/pet/control', { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(apply).catch(function () {});
  }
  btn.addEventListener('click', function () {
    fetch('/api/pet/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !on }),
    }).then(function (r) { return r.json(); }).then(apply).catch(function () {});
  });
  refresh();
})();
<\/script>`

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./chat.js').PetChatConfig} [config]
 */
export function apply(ctx, config = {}) {
  const service = new PetChatService(ctx, config)

  // 刷新端口桥：插件挂载时写一次（桥文件携带桌宠开关状态）。
  const writeBridge = () => writeBridgeFile(ctx.webServer.port)
  writeBridge()

  // 注册路由，随插件 fiber 自动卸载。
  const routes = makePetRoutes({ service, writeBridge, loadEnabled, saveEnabled })
  ctx.effect(
    () => {
      const disposers = routes.map((route) => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'desktop-pet: routes',
  )

  // 往 DSH 界面 index.html 注入桌宠开关（插到 </body> 之前；随插件 fiber 自动卸载）。
  ctx.effect(
    () => ctx.webServer.tapIndex((html) =>
      html.includes('</body>')
        ? html.replace('</body>', `${TOGGLE_SCRIPT}\n</body>`)
        : html + TOGGLE_SCRIPT,
    ),
    'desktop-pet: gui-toggle',
  )

  ctx.on('dispose', () => {
    try {
      service.memory.save()
    } catch {
      // 落盘失败不影响退出
    }
  })
}
