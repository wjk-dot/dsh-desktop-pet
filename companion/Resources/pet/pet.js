/* DeepSeek 桌宠页面逻辑：状态机 + 气泡打字机 + 输入框 + 拖动判定。
 * 与原生壳的契约：
 *   JS → Swift: window.webkit.messageHandlers.pet.postMessage({type, ...})
 *     - {type:'chat', text}   发送一条对话
 *     - {type:'drag'}         进入拖动模式（原生壳接管窗口移动）
 *   Swift → JS: window.petBridge.* 注入方法（由原生壳 evaluateJavaScript 调用）
 */

(function () {
  'use strict'

  const stage = document.getElementById('stage')
  const bubble = document.getElementById('bubble')
  const bubbleText = document.getElementById('bubbleText')
  const inputBar = document.getElementById('inputBar')
  const inputText = document.getElementById('inputText')
  const sendBtn = document.getElementById('sendBtn')
  const offlineTag = document.getElementById('offlineTag')

  let state = 'idle'        // idle | listening | thinking | speaking | offline
  let streaming = false     // 正在等待/接收回复
  let greetingShown = false

  /* ---------- 状态 ---------- */
  function setState(next) {
    state = next
    stage.className = 'stage' + (next === 'idle' ? '' : ' pet-' + next)
  }

  function post(type, extra) {
    const msg = Object.assign({ type }, extra || {})
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pet) {
      window.webkit.messageHandlers.pet.postMessage(msg)
    }
  }

  /* ---------- 气泡打字机 ---------- */
  function showBubble(text, withCaret) {
    bubble.hidden = false
    bubbleText.innerHTML = ''
    bubbleText.appendChild(document.createTextNode(text || ''))
    if (withCaret) {
      const caret = document.createElement('span')
      caret.className = 'caret'
      bubbleText.appendChild(caret)
    }
  }

  function appendDelta(text) {
    // 去掉末尾光标再追加
    const caret = bubbleText.querySelector('.caret')
    if (caret) caret.remove()
    bubbleText.appendChild(document.createTextNode(text))
    const newCaret = document.createElement('span')
    newCaret.className = 'caret'
    bubbleText.appendChild(newCaret)
  }

  function hideBubble() {
    bubble.hidden = true
    bubbleText.textContent = ''
  }

  /* ---------- 输入框 ---------- */
  function openInput() {
    if (streaming) return
    inputBar.hidden = false
    setState('listening')
    inputText.focus()
  }

  function closeInput() {
    inputBar.hidden = true
    inputText.value = ''
    if (!streaming && state !== 'offline') setState('idle')
  }

  function send() {
    const text = inputText.value.trim()
    if (!text || streaming) return
    inputBar.hidden = true
    inputText.value = ''
    streaming = true
    setState('thinking')
    showBubble('', true)
    post('chat', { text })
  }

  /* ---------- 点击 vs 拖动 ---------- */
  const petEl = document.getElementById('pet')
  let downX = 0, downY = 0, moved = false, dragging = false

  petEl.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    downX = e.screenX
    downY = e.screenY
    moved = false
    dragging = false
  })

  window.addEventListener('mousemove', function (e) {
    if (streaming) return
    if (dragging) return
    if (downX === 0 && downY === 0) return
    const dx = e.screenX - downX
    const dy = e.screenY - downY
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      moved = true
      dragging = true
      downX = 0
      downY = 0
      post('drag')
      closeInput()
    }
  })

  window.addEventListener('mouseup', function () {
    if (!dragging && !moved && downX !== 0) {
      // 单击：切换输入框
      if (inputBar.hidden) openInput()
      else closeInput()
    }
    downX = 0
    downY = 0
    moved = false
    dragging = false
  })

  sendBtn.addEventListener('click', send)
  inputText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send()
    if (e.key === 'Escape') closeInput()
  })

  /* ---------- 原生壳注入的桥 ---------- */
  window.petBridge = {
    setState: setState,

    /** 回复增量（逐字渲染） */
    renderDelta: function (text) {
      if (!streaming) return
      if (bubble.hidden) showBubble('', true)
      appendDelta(text)
    },

    /** 回复结束 */
    renderDone: function () {
      streaming = false
      if (state === 'thinking') setState('speaking')
      // 说完歇 1.6s 回待机
      setTimeout(function () {
        if (!streaming && state === 'speaking') setState('idle')
      }, 1600)
    },

    /** 出错 */
    renderError: function (message) {
      streaming = false
      showBubble('😢 ' + (message || '出错了'), false)
      setTimeout(function () {
        if (!streaming) hideBubble()
        if (state !== 'offline') setState('idle')
      }, 3000)
    },

    /** 进入离线态 */
    renderOffline: function () {
      if (state === 'offline') return
      streaming = false
      setState('offline')
      offlineTag.hidden = false
      hideBubble()
      inputBar.hidden = true
    },

    /** 恢复在线 */
    renderOnline: function () {
      const wasOffline = state === 'offline'
      setState('idle')
      offlineTag.hidden = true
      if (wasOffline && !greetingShown) {
        greetingShown = true
        showBubble('嗨！我是小鲸鱼，点我聊天～', false)
        setTimeout(hideBubble, 3200)
      }
    },

    /** 一键问候（初次上屏） */
    greet: function () {
      if (greetingShown) return
      greetingShown = true
      showBubble('嗨！我是小鲸鱼，点我聊天～', false)
      setTimeout(hideBubble, 3200)
    },
  }

  /* 初次上屏动画：先待机 */
  setState('idle')
})()
