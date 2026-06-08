import { describe, expect, it } from 'vitest'
import { powerShellCommandArgs, withPowerShellUtf8 } from './powershell-encoding.js'

describe('PowerShell UTF-8 bootstrap', () => {
  it('forces PowerShell and native command output to UTF-8 before user commands', () => {
    const command = withPowerShellUtf8('tsc -p tsconfig.json --noEmit')

    expect(command).toContain('[Console]::InputEncoding = $__jdcUtf8')
    expect(command).toContain('[Console]::OutputEncoding = $__jdcUtf8')
    expect(command).toContain('$OutputEncoding = $__jdcUtf8')
    expect(command).toContain('chcp.com 65001')
    expect(command.indexOf('chcp.com 65001')).toBeLessThan(command.indexOf('tsc -p tsconfig.json --noEmit'))
  })

  it('clears the chcp exit code before the user command runs', () => {
    const command = withPowerShellUtf8('Write-Error "失败"')

    expect(command.indexOf('$global:LASTEXITCODE = $null')).toBeLessThan(command.indexOf('Write-Error "失败"'))
  })

  it('builds non-interactive PowerShell arguments around the UTF-8 command', () => {
    const args = powerShellCommandArgs('npm test')

    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(args[3]).toContain('npm test')
    expect(args[3]).toContain('$OutputEncoding = $__jdcUtf8')
  })
})
