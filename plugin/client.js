window.__ModuleLoader__.load({
  id: '@linxin666/dsh-desktop-pet',
  factory: (require) => {
    const React = require('react')
    const { useCallback, useEffect, useRef, useState } = React

    const defaults = {
      iconSize: 120,
      showActivity: true,
      reduceMotion: false,
      autoDock: true,
      visionEnabled: true,
    }

    function request(path, init) {
      return fetch(path, {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', ...(init && init.headers) },
        ...init,
      }).then(async (response) => {
        const body = await response.json().catch(() => ({}))
        if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`)
        return body
      })
    }

    function ToggleRow({ label, description, checked, onChange }) {
      return React.createElement('label', {
        style: {
          display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px',
          alignItems: 'center', padding: '10px 0', cursor: 'pointer',
          borderTop: '1px solid var(--dsw-border, rgba(0,0,0,.1))',
        },
      },
      React.createElement('span', null,
        React.createElement('span', { style: { display: 'block', fontWeight: 600 } }, label),
        React.createElement('span', { style: { display: 'block', marginTop: 3, opacity: .68, fontSize: 12 } }, description),
      ),
      React.createElement('input', { type: 'checkbox', checked: !!checked, onChange: (event) => onChange(event.target.checked) }))
    }

    function PetSettingsCard() {
      const [preferences, setPreferences] = useState(defaults)
      const [enabled, setEnabled] = useState(true)
      const [status, setStatus] = useState(null)
      const [vision, setVision] = useState(null)
      const [visionSettings, setVisionSettings] = useState(null)
      const [apiKey, setApiKey] = useState('')
      const [visionModel, setVisionModel] = useState('')
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState('')
      const [expanded, setExpanded] = useState(false)
      const sizeSaveTimer = useRef(null)

      const reload = useCallback(async () => {
        try {
          const [pref, control, agent, config, settings] = await Promise.all([
            request('/api/pet/preferences'), request('/api/pet/control'), request('/api/pet/status'), request('/api/pet/config'),
            request('/api/pet/vision/settings'),
          ])
          setPreferences({ ...defaults, ...pref.preferences })
          setEnabled(!!control.enabled)
          setStatus(agent.status || null)
          setVision(config.config && config.config.vision ? config.config.vision : null)
          setVisionSettings(settings.settings || null)
          setVisionModel(settings.settings && settings.settings.model ? settings.settings.model : '')
          setMessage('')
        } catch (error) {
          setMessage(`无法读取桌宠状态：${error.message}`)
        } finally {
          setLoading(false)
        }
      }, [])

      const saveVisionSettings = useCallback(async () => {
        setSaving(true)
        try {
          const result = await request('/api/pet/vision/settings', {
            method: 'POST', body: JSON.stringify({ apiKey, model: visionModel.trim() || undefined }),
          })
          setVisionSettings(result.settings)
          setApiKey('')
          await reload()
          setMessage('Qwen 凭据已保存；重启 Harness 后生效')
        } catch (error) {
          setMessage(`Qwen 凭据保存失败：${error.message}`)
        } finally {
          setSaving(false)
        }
      }, [apiKey, reload, visionModel])

      useEffect(() => { void reload() }, [reload])

      const savePreferences = useCallback(async (next) => {
        setPreferences(next)
        setSaving(true)
        try {
          const result = await request('/api/pet/preferences', {
            method: 'POST', body: JSON.stringify(next),
          })
          setPreferences({ ...defaults, ...result.preferences })
          setMessage('已应用到桌宠')
        } catch (error) {
          setMessage(`保存失败：${error.message}`)
        } finally {
          setSaving(false)
        }
      }, [])

      useEffect(() => () => {
        if (sizeSaveTimer.current) clearTimeout(sizeSaveTimer.current)
      }, [])

      const updateIconSize = useCallback((value, immediate = false) => {
        const next = { ...preferences, iconSize: Number(value) }
        setPreferences(next)
        if (sizeSaveTimer.current) clearTimeout(sizeSaveTimer.current)
        if (immediate) {
          void savePreferences(next)
          return
        }
        sizeSaveTimer.current = setTimeout(() => {
          sizeSaveTimer.current = null
          void savePreferences(next)
        }, 120)
      }, [preferences, savePreferences])

      const toggleEnabled = useCallback(async (next) => {
        setEnabled(next)
        setSaving(true)
        try {
          const result = await request('/api/pet/control', {
            method: 'POST', body: JSON.stringify({ enabled: next }),
          })
          setEnabled(!!result.enabled)
          setMessage(result.enabled ? '桌宠已开启' : '桌宠已关闭')
        } catch (error) {
          setEnabled(!next)
          setMessage(`切换失败：${error.message}`)
        } finally {
          setSaving(false)
        }
      }, [])

      const activity = status && status.running
        ? (status.currentTool && status.currentTool.name ? `执行中：${status.currentTool.name}` : 'Agent 正在执行任务')
        : '空闲，已连接到同一条 Agent 执行链'
      const visionSummary = !vision
        ? '正在检测 Qwen 视觉能力…'
        : !vision.enabled
          ? '截图分析已关闭。'
          : !vision.qwenConfigured
            ? '未检测到 DashScope 凭据；请配置 Qwen 视觉凭据。'
            : !vision.uvxAvailable
              ? '已检测到视觉凭据，但未找到 uvx；请安装 uv 后重启 Harness。'
              : vision.preflightReady
                ? '本机视觉环境预检通过；重启后的 Harness 会启动 Qwen MCP。'
                : '视觉凭据已配置；请重启 Harness 让 MCP 生效。'
      const summary = loading
        ? '正在读取桌宠状态…'
        : `${enabled ? '已启用' : '已关闭'} · ${activity}`

      return React.createElement('section', {
        style: {
          maxWidth: 760, overflow: 'hidden', listStyle: 'none', color: 'inherit',
          border: `1px solid ${expanded
            ? 'var(--dsw-alias-label-dimmed, rgba(0,0,0,.36))'
            : 'var(--dsw-alias-border-l2, rgba(0,0,0,.14))'}`,
          borderRadius: 12,
          background: expanded
            ? 'var(--dsw-alias-bg-layer-2, transparent)'
            : 'var(--dsw-alias-bg-layer-3, transparent)',
          transition: 'border-color 160ms ease, background 160ms ease',
        },
      },
      React.createElement('button', {
        type: 'button',
        'aria-expanded': expanded,
        onClick: () => {
          if (!expanded) void reload()
          setExpanded((value) => !value)
        },
        style: {
          appearance: 'none', width: '100%', border: 0, borderRadius: 12,
          padding: '14px 16px', background: 'transparent', color: 'inherit',
          cursor: 'pointer', textAlign: 'left', font: 'inherit',
          display: 'flex', alignItems: 'center', gap: 12,
        },
      },
      React.createElement('span', {
        style: { display: 'flex', flexDirection: 'column', flex: 1, gap: 4, minWidth: 0 },
      },
      React.createElement('span', {
        style: { color: 'var(--dsw-alias-label-primary, inherit)', fontSize: 15, fontWeight: 600, lineHeight: 1.4 },
      }, 'DeepSeek 桌宠'),
      React.createElement('span', {
        style: {
          color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: 13,
          lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: .78,
        },
      }, summary),
      ),
      React.createElement('span', {
        'aria-hidden': true,
        style: {
          flex: '0 0 auto', display: 'block', width: 8, height: 8, marginRight: 3,
          borderRight: '2px solid currentColor', borderBottom: '2px solid currentColor', opacity: .58,
          transform: expanded ? 'rotate(225deg)' : 'rotate(45deg)', transition: 'transform 160ms ease',
        },
      }),
      ),
      expanded ? React.createElement('div', {
        style: { borderTop: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))', margin: '0 16px', paddingBottom: 8 },
      },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 10 } },
        React.createElement('span', { style: { fontSize: 12, opacity: .7 } }, loading ? '正在刷新状态…' : activity),
        React.createElement('button', {
          type: 'button', onClick: () => void reload(), disabled: loading || saving,
          style: {
            appearance: 'none', flex: '0 0 auto', padding: 0, border: 0, background: 'transparent',
            color: 'var(--dsw-alias-label-tertiary, inherit)', cursor: loading || saving ? 'default' : 'pointer',
            font: 'inherit', fontSize: 12, textDecoration: 'underline', opacity: loading || saving ? .5 : .85,
          },
        }, '刷新状态'),
      ),
      React.createElement(ToggleRow, {
        label: '启用桌宠', description: '关闭后隐藏原生桌宠窗口，不影响 Harness 会话。', checked: enabled,
        onChange: (value) => void toggleEnabled(value),
      }),
      React.createElement('div', { style: { padding: '12px 0', borderTop: '1px solid var(--dsw-border, rgba(0,0,0,.1))' } },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 600 } },
          React.createElement('label', { htmlFor: 'desktop-pet-icon-size' }, '图标尺寸'),
          React.createElement('output', null, `${preferences.iconSize}px`),
        ),
        React.createElement('input', {
          id: 'desktop-pet-icon-size', type: 'range', min: 70, max: 200, step: 5,
          value: preferences.iconSize, disabled: loading || saving,
          onChange: (event) => updateIconSize(event.target.value),
          onMouseUp: (event) => updateIconSize(event.currentTarget.value, true),
          onTouchEnd: (event) => updateIconSize(event.currentTarget.value, true),
          onBlur: (event) => updateIconSize(event.currentTarget.value, true),
          style: { display: 'block', width: '100%', marginTop: 10 },
        }),
      ),
      React.createElement(ToggleRow, {
        label: '显示任务状态', description: 'Agent 执行工具时，在桌宠上方显示当前任务并允许取消。', checked: preferences.showActivity,
        onChange: (value) => void savePreferences({ ...preferences, showActivity: value }),
      }),
      React.createElement(ToggleRow, {
        label: '减少动画', description: '关闭漂浮、呼吸和过渡动画，适合专注或低干扰使用。', checked: preferences.reduceMotion,
        onChange: (value) => void savePreferences({ ...preferences, reduceMotion: value }),
      }),
      React.createElement(ToggleRow, {
        label: '自动贴边隐藏', description: '拖动桌宠至屏幕边缘时自动收起，移回边缘热区后展开。', checked: preferences.autoDock,
        onChange: (value) => void savePreferences({ ...preferences, autoDock: value }),
      }),
      React.createElement(ToggleRow, {
        label: '启用截图分析', description: visionSummary, checked: preferences.visionEnabled,
        onChange: (value) => void savePreferences({ ...preferences, visionEnabled: value }),
      }),
      React.createElement('div', { style: { padding: '12px 0', borderTop: '1px solid var(--dsw-border, rgba(0,0,0,.1))' } },
        React.createElement('div', { style: { fontWeight: 600 } }, 'Qwen 视觉凭据'),
        React.createElement('p', { style: { margin: '4px 0 10px', fontSize: 12, opacity: .7, lineHeight: 1.5 } },
          visionSettings && visionSettings.configured
            ? `已保存 DashScope API Key（末四位 ${visionSettings.keySuffix || '****'}）。修改后需重启 Harness。`
            : '粘贴从阿里云百炼 DashScope 控制台创建的 API Key。密钥只保存在本机。',
        ),
        React.createElement('input', {
          type: 'password', value: apiKey, autoComplete: 'off', spellCheck: false,
          placeholder: visionSettings && visionSettings.configured ? '输入新 Key 以替换现有凭据' : 'DashScope API Key',
          onChange: (event) => setApiKey(event.target.value),
          style: { boxSizing: 'border-box', width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.2))', background: 'transparent', color: 'inherit', font: 'inherit' },
        }),
        React.createElement('a', {
          href: 'https://bailian.console.aliyun.com/?tab=model#/api-key', target: '_blank', rel: 'noreferrer',
          style: { display: 'inline-block', marginTop: 7, color: 'var(--dsw-alias-label-link, #3568d4)', fontSize: 12, textDecoration: 'underline' },
        }, '前往阿里云百炼创建 DashScope API Key'),
        React.createElement('input', {
          type: 'text', value: visionModel, autoComplete: 'off', spellCheck: false,
          placeholder: '视觉模型（可选，例如 qwen3.7-plus）',
          onChange: (event) => setVisionModel(event.target.value),
          style: { boxSizing: 'border-box', width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.2))', background: 'transparent', color: 'inherit', font: 'inherit' },
        }),
        React.createElement('button', {
          type: 'button', disabled: saving || apiKey.trim().length < 8, onClick: () => void saveVisionSettings(),
          style: { marginTop: 8, padding: '7px 12px', borderRadius: 6, border: 0, background: 'var(--dsw-alias-bg-accent, #3568d4)', color: 'var(--dsw-alias-label-on-accent, white)', cursor: saving || apiKey.trim().length < 8 ? 'default' : 'pointer', opacity: saving || apiKey.trim().length < 8 ? .55 : 1, font: 'inherit', fontSize: 13 },
        }, '保存 Qwen 凭据'),
      ),
      React.createElement('p', { style: { margin: '12px 0 0', fontSize: 12, opacity: .72 } },
        activity,
      ),
      message ? React.createElement('p', { role: 'status', style: { margin: '6px 0 0', fontSize: 12, color: '#237a4a' } }, message) : null) : null)
    }

    function apply(ctx) {
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
        { name: 'settings.plugin.item', key: 'desktop-pet', id: 'desktop-pet', order: 100, label: 'DeepSeek 桌宠' },
        () => React.createElement(PetSettingsCard),
      ))
    }

    return { inject: ['slots'], apply }
  },
})
