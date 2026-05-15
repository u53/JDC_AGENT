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
        className="relative border border-[#333] bg-[#0A0A0A] w-[520px] max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#333]">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[#EAEAEA]">JDCAGNET 帮助</span>
          <button onClick={onClose} className="text-[10px] text-[#666] hover:text-[#EAEAEA]">[ESC]</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#666] mb-2">斜杠命令</h3>
            <div className="space-y-1.5">
              <HelpRow cmd="/compact" desc="压缩当前对话上下文，释放 token 空间" />
              <HelpRow cmd="/mcp" desc="打开 MCP 服务器管理面板" />
              <HelpRow cmd="/stats" desc="显示当前会话的 token 使用统计" />
              <HelpRow cmd="/help" desc="显示此帮助对话框" />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#666] mb-2">底部工具栏</h3>
            <div className="space-y-1.5">
              <HelpRow cmd="权限模式" desc="切换 标准/完全访问/严格 三种权限级别" />
              <HelpRow cmd="推理" desc="开关推理模式（extended thinking）" />
              <HelpRow cmd="规划" desc="开关规划模式（只读 + 写计划文件）" />
              <HelpRow cmd="模型" desc="切换当前使用的 AI 模型" />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#666] mb-2">快捷键</h3>
            <div className="space-y-1.5">
              <HelpRow cmd="Enter" desc="发送消息（streaming 时自动排队）" />
              <HelpRow cmd="Shift+Enter" desc="换行" />
              <HelpRow cmd="Shift+Tab" desc="切换规划模式" />
              <HelpRow cmd="/" desc="打开命令菜单" />
              <HelpRow cmd="Esc" desc="关闭菜单 / 关闭对话框" />
            </div>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#666] mb-2">技能</h3>
            <p className="text-[11px] text-[#666]">
              输入 / 后可以看到已安装的技能。选择技能后可以追加参数再发送。
              技能文件位于项目的 .jdcagnet/skills/ 或全局 ~/.jdcagnet/skills/ 目录。
            </p>
          </section>

          <section>
            <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#666] mb-2">文件操作</h3>
            <p className="text-[11px] text-[#666]">
              AI 修改的文件会显示在 FILES CHANGED 面板中。可以对每个文件执行 [REVERT]（撤销）或 [ACCEPT]（确认）。
              确认后的文件不再显示，状态持久化到数据库。
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
      <span className="text-[11px] text-[#EAEAEA] font-mono shrink-0 min-w-[100px]">{cmd}</span>
      <span className="text-[11px] text-[#666]">{desc}</span>
    </div>
  )
}
