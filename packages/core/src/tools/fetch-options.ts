import { ProxyAgent } from 'undici'

export interface FetchOptionsInput {
  proxy?: string
  signal?: AbortSignal
  timeoutMs?: number
  headers?: HeadersInit
  method?: string
  body?: BodyInit
}

export function makeFetchOptions(input: FetchOptionsInput = {}): RequestInit {
  const opts: RequestInit = {
    signal: input.signal ?? (input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined),
  }
  if (input.headers) opts.headers = input.headers
  if (input.method) opts.method = input.method
  if (input.body) opts.body = input.body
  if (input.proxy) {
    ;(opts as any).dispatcher = new ProxyAgent(input.proxy)
  }
  return opts
}
