export interface IdeProduct {
  ideId: string
  ideName: string
  appName: string
  uriScheme: string
}

export function detectIdeProduct(appName: string, uriScheme: string): IdeProduct {
  const app = appName.toLowerCase()
  const scheme = uriScheme.toLowerCase()

  if (app.includes('cursor') || scheme.includes('cursor')) {
    return { ideId: 'cursor', ideName: 'Cursor', appName, uriScheme }
  }
  if (app.includes('windsurf') || scheme.includes('windsurf')) {
    return { ideId: 'windsurf', ideName: 'Windsurf', appName, uriScheme }
  }
  if (app.includes('vscodium') || scheme.includes('vscodium')) {
    return { ideId: 'vscodium', ideName: 'VSCodium', appName, uriScheme }
  }
  if (app.includes('code - oss') || app.includes('code oss') || scheme.includes('code-oss')) {
    return { ideId: 'code-oss', ideName: 'Code OSS', appName, uriScheme }
  }

  return { ideId: 'vscode', ideName: 'VS Code', appName, uriScheme }
}
