interface StatsData {
  turnCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheHitRate: number
  contextUsedPercent: number
  filesChanged: number
}

export function StatsCard({ data }: { data: StatsData }) {
  return (
    <div className="border border-[#333] bg-[#0A0A0A] px-4 py-3 my-2 text-xs">
      <div className="text-[10px] uppercase tracking-[0.1em] text-[#4AF626] mb-2">SESSION STATS</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[#EAEAEA]">
        <div>Turns: <span className="text-[#4AF626]">{data.turnCount}</span></div>
        <div>Files Changed: <span className="text-[#4AF626]">{data.filesChanged}</span></div>
        <div>Input: <span className="text-[#4AF626]">{(data.inputTokens / 1000).toFixed(1)}k</span></div>
        <div>Output: <span className="text-[#4AF626]">{(data.outputTokens / 1000).toFixed(1)}k</span></div>
        <div>Total: <span className="text-[#4AF626]">{(data.totalTokens / 1000).toFixed(1)}k</span></div>
        <div>Cache: <span className="text-[#4AF626]">{data.cacheHitRate}%</span></div>
        <div>Context: <span className="text-[#4AF626]">{data.contextUsedPercent}%</span></div>
      </div>
    </div>
  )
}
