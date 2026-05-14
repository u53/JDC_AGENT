# Spec 8: 快捷键系统

## 目标

为 JDCAGNET 添加全局键盘快捷键，覆盖核心操作（新建/切换/删除会话、中止、清空、设置），提升操作效率。

## 架构

新增 `useHotkeys` hook 挂载在 App 顶层，监听全局 `keydown` 事件，匹配修饰键组合后触发对应操作。快捷键表硬编码，不可配置。

## 快捷键表

| 快捷键 | 操作 | 说明 |
|--------|------|------|
| Enter | 发送消息 | 已有实现，不需改动 |
| Shift+Enter | 换行 | 已有实现，不需改动 |
| Esc | 中止当前生成 | 调用 abort |
| Cmd/Ctrl+N | 新建会话 | 调用 createSession |
| Cmd/Ctrl+W | 删除当前会话 | 调用 deleteSession（需确认） |
| Cmd/Ctrl+K | 清空当前对话 | 调用 clearSession |
| Cmd/Ctrl+, | 打开/关闭设置 | toggle settings panel |
| Cmd/Ctrl+1~9 | 切换到第 N 个会话 | switchSession(sessions[n-1]) |
| / | 聚焦输入框 + 打开斜杠菜单 | 仅在输入框未聚焦时触发 |

## 实现方式

### useHotkeys hook

```typescript
// packages/ui/src/hooks/useHotkeys.ts
type HotkeyMap = Record<string, () => void>

function useHotkeys(map: HotkeyMap): void
```

- 在 `useEffect` 中注册全局 `keydown` 监听器
- 解析事件为标准化 key string（如 `mod+n`、`escape`、`/`）
- `mod` 在 macOS 上映射为 `metaKey`，其他平台映射为 `ctrlKey`
- 匹配到 map 中的 key 时调用对应 handler 并 `preventDefault()`

### 挂载位置

在 `App.tsx` 顶层调用 `useHotkeys()`，传入操作映射。操作通过 session-store 和 UI state 执行。

## 注意事项

- `/` 快捷键：仅在 `document.activeElement` 不是 textarea/input 时触发，避免打字冲突
- Cmd+1~9：只在对应索引有会话时生效，否则忽略
- Cmd+W：复用现有的删除确认逻辑（如果有的话），或直接删除
- Cmd+K：直接清空，不需确认（可以通过 undo/重新加载恢复）
- 所有快捷键在设置面板打开时仍然生效
- `e.preventDefault()` 阻止浏览器/Electron 默认行为（如 Cmd+N 打开新窗口）

## 文件变动

- **新增**: `packages/ui/src/hooks/useHotkeys.ts` — 全局快捷键 hook
- **修改**: `packages/ui/src/App.tsx` — 挂载 useHotkeys，传入操作映射
- **修改**: `packages/ui/src/stores/session-store.ts` — 暴露 toggleSettings action（如果尚未暴露）

## 不做的事

- 不做快捷键配置/自定义
- 不做序列键（chord / vim-style）
- 不做快捷键提示 UI（tooltip、帮助面板）
- 不做快捷键冲突检测
- 不改动 Enter/Shift+Enter（已有实现）
