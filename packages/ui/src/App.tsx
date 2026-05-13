export function App() {
  return (
    <div className="flex h-screen w-screen">
      <aside className="w-64 border-r border-zinc-700 bg-zinc-900 p-4">
        <h2 className="text-sm font-medium text-zinc-400">项目</h2>
        <p className="mt-4 text-xs text-zinc-500">暂无项目，点击添加</p>
      </aside>
      <main className="flex-1 flex flex-col bg-zinc-950">
        <div className="flex-1 flex items-center justify-center text-zinc-500">
          选择一个项目开始对话
        </div>
      </main>
    </div>
  )
}
