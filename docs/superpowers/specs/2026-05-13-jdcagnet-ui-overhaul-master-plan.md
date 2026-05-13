# JDCAGNET UI 交互大改造 — 总体规划

## 背景

基于 Claude Code 源码深度对比，JDCAGNET 在工具渲染、Agent 管理、错误处理、上下文管理、权限系统、交互体验等方面存在大量缺失。本规划将改造拆分为 10 个独立 Spec，按优先级分批推进。

## Spec 列表

### Spec 1: 工具差异化渲染 + 工具卡片重构 ✅ (已设计)
- 注册表模式路由，按 toolName 分发到专属渲染器
- Bash/Edit/Write/Read/Agent/Skill/MCP 各有专属卡片
- 统一 Props 接口，合并实时事件和历史消息两种入口
- **文件:** `docs/superpowers/specs/2026-05-13-jdcagnet-ui-overhaul-spec1-tool-rendering.md`

### Spec 2: Agent 分屏视图 + 子代理管理
- 右侧面板展示 agent 完整对话流
- Agent 进度追踪（工具计数、token 消耗、最后工具信息）
- Agent 中止按钮
- Agent 摘要服务（定期总结子 agent 进展）
- 多 agent 并行时的面板切换

### Spec 3: 错误处理 + 重试 + 恢复
- API 错误指数退避重试（最多 10 次）
- 529 过载特殊处理（最多 3 次）
- Rate limit 智能等待 + 倒计时显示
- 网络断连检测 + 恢复提示
- 一键重试（重发最后消息）
- Prompt too long 自动触发压缩
- Stale connection 检测

### Spec 4: 上下文管理 + Token/Cost 追踪
- 自动压缩（接近 token 上限时自动触发）
- Micro-compaction（选择性清理旧工具结果）
- Token/Cost 实时显示（参考 omc-hud.js 的数据结构）
  - input_tokens, output_tokens, cache_creation, cache_read
  - cache hit rate, context used percentage
  - 累计 cost (USD)
- 上下文使用百分比可视化
- 动态 prompt 分段构建（缓存友好，static/dynamic 分界）

### Spec 5: 文件操作增强
- 文件历史快照（每次修改前备份）
- Per-turn diff 显示（本轮对话改了哪些文件）
- Rewind/checkpoint 回退到任意历史点
- 文件变更追踪（session 级别的变更列表）
- Commit attribution（追踪哪些文件被修改用于 git commit）

### Spec 6: 并行工具执行 + 流式输出
- Streaming tool executor（工具流式执行）
- 读写分离并发控制（只读工具并行，写工具串行）
- Bash 实时输出流（stdout 逐行推送到前端）
- 工具执行超时控制
- 兄弟工具错误中止（一个失败则取消同批其他工具）
- 最大并发数配置

### Spec 7: 权限系统增强
- Glob 模式细粒度规则（如 "allow Read src/**"）
- 规则持久化（全局 + 项目级别）
- 多来源规则合并（global/project/managed）
- 权限拒绝追踪（避免重复询问）
- 危险命令模式检测增强
- 规则冲突/遮蔽检测

### Spec 8: 交互体验增强
- 快捷键系统（可配置，支持 chord）
- 输入历史（上下箭头导航）
- 对话历史搜索
- Prompt suggestions（AI 生成下一步建议）
- 对话导出
- 终端通知（完成时通知用户）

### Spec 9: 系统提示词增强
- 动态 prompt 分段构建（intro/system/tools/MCP/hooks/skills/memory/instructions）
- 缓存边界标记（static vs dynamic 分离）
- MCP server instructions 注入
- System reminders 机制（在工具结果中注入上下文提醒）
- 语言偏好配置
- 输出风格配置
- Hooks section（告知模型用户配置了哪些 hooks）

### Spec 10: 会话管理增强
- Session resume（恢复历史对话，完整上下文还原）
- Session memory（后台提取关键事实，跨压缩持久化）
- Away summary（用户离开后回来时生成摘要）
- Stats 统计命令（session 统计信息展示）
- 自动记忆提取（对话结束时提取持久记忆）

## 推进顺序

```
Phase A (核心体验):  Spec 1 → Spec 3 → Spec 6
Phase B (智能管理):  Spec 4 → Spec 9
Phase C (Agent):     Spec 2
Phase D (文件安全):  Spec 5 → Spec 7
Phase E (体验增强):  Spec 8 → Spec 10
```

## 设计原则

- 每个 Spec 独立可交付，不依赖其他 Spec 完成
- 遵循现有 CRT brutalist 视觉风格
- 后端变更最小化，优先前端改造
- 保持与 Claude Code 的概念对齐，但不照搬实现
- YAGNI — 不做 Claude Code 中企业级功能（remote session, teleport, policy limits, MDM）
