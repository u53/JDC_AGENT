const POWERSHELL_UTF8_BOOTSTRAP = [
  "try {",
  "  $__jdcUtf8 = [System.Text.UTF8Encoding]::new($false)",
  "  [Console]::InputEncoding = $__jdcUtf8",
  "  [Console]::OutputEncoding = $__jdcUtf8",
  "  $OutputEncoding = $__jdcUtf8",
  "  if ($IsWindows -or $env:OS -eq 'Windows_NT') { & chcp.com 65001 > $null 2>$null }",
  "  $global:LASTEXITCODE = $null",
  "} catch {}",
].join('\n')

export function withPowerShellUtf8(command: string): string {
  return `${POWERSHELL_UTF8_BOOTSTRAP}\n${command}`
}

export function powerShellCommandArgs(command: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-Command', withPowerShellUtf8(command)]
}
