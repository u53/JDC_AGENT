import { useEffect } from 'react'

interface Props {
  visible: boolean
  onClose: () => void
}

export function HelpDialog({ visible, onClose }: Props) {
  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, onClose])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative border border-[var(--border)] bg-[var(--surface)] rounded-[12px] w-[520px] max-h-[80vh] overflow-y-auto"
        style={{ boxShadow: 'var(--shadow-soft)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--text)]">JDC Code 帮助</span>
          <button onClick={onClose} className="text-[10px] text-[var(--muted)] hover:text-[var(--text)]">[ESC]</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] mb-2">斜杠命令</h3>
            <div className="space-y-1.5">
              <HelpRow cmd="/init" desc="分析项目并生成 JDCAGNET.md 配置文件" />
              <HelpRow cmd="/compact" desc="将早期消息压缩为摘要(适合长对话；消息过短时会跳过)" />
              <HelpRow cmd="/mcp" desc="打开 MCP 服务器管理面板" />
              <HelpRow cmd="/stats" desc="显示当前会话的 token 使用统计" />
              <HelpRow cmd="/help" desc="显示此帮助对话框" />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] mb-2">底部工具栏</h3>
            <div className="space-y-1.5">
              <HelpRow cmd="权限模式" desc="切换 标准/完全访问/严格 三种权限级别" />
              <HelpRow cmd="推理" desc="选择推理强度 关/低/中/高/超高/最大" />
              <HelpRow cmd="规划" desc="开关规划模式（只读 + 写计划文件）" />
              <HelpRow cmd="模型" desc="切换当前使用的 AI 模型" />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] mb-2">快捷键</h3>
            <div className="space-y-1.5">
              <HelpRow cmd="Enter" desc="发送消息（streaming 时自动排队）" />
              <HelpRow cmd="Shift+Enter" desc="换行" />
              <HelpRow cmd="Shift+Tab" desc="切换规划模式" />
              <HelpRow cmd="/" desc="打开命令菜单" />
              <HelpRow cmd="Esc" desc="关闭菜单 / 关闭对话框" />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] mb-2">技能</h3>
            <p className="text-[11px] text-[var(--muted)]">
              输入 / 后可以看到已安装的技能。选择技能后可以追加参数再发送。
              技能文件位于项目的 .jdcagnet/skills/ 或全局 ~/.jdcagnet/skills/ 目录。
            </p>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] mb-2">文件操作</h3>
            <p className="text-[11px] text-[var(--muted)]">
              AI 修改的文件会显示在 FILES CHANGED 面板中。可以对每个文件执行 [REVERT]（撤销）或 [ACCEPT]（确认）。
              确认后的文件不再显示，状态持久化到数据库。
            </p>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] mb-2">IDE 集成</h3>
            <p className="text-[11px] text-[var(--muted)] mb-2">
              安装 IDE 扩展后，JDC Code 可自动感知你在 IDE 中的操作（当前文件、选中代码），作为隐式上下文传给 AI。
            </p>
            <div className="space-y-1.5">
              <HelpRow cmd="VS Code" desc="安装 .vsix 扩展 → 打开同一项目 → 自动连接" />
              <HelpRow cmd="JetBrains" desc="安装 .zip 插件 → 打开同一项目 → 自动连接" />
              <HelpRow cmd="状态指示" desc="Composer 底部绿色圆点 + IDE 名称 = 已连接" />
              <HelpRow cmd="选中代码" desc="IDE 中选中代码后发消息，AI 可看到选中内容（一次性）" />
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-2">
              下载地址: <a href="https://github.com/u53/JDC_AGENT/releases" target="_blank" className="text-[var(--text)] underline hover:text-[var(--accent)]">GitHub Releases</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

function HelpRow({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] text-[var(--text)] font-mono shrink-0 min-w-[100px]">{cmd}</span>
      <span className="text-[11px] text-[var(--muted)]">{desc}</span>
    </div>
  )
}
