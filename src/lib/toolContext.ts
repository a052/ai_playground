import type {
  FetchedPage,
  HttpTransaction,
  SearchConfig,
  SearchResult,
  SearchSettings,
} from '@/types'

/** Shared runtime context passed to the web-search / url-fetch executors. */
export interface ToolContext {
  searchConfigs: SearchConfig[]
  searchSettings: SearchSettings
  corsProxy: string
  signal: AbortSignal
}

/** Uniform return shape from a tool executor. */
export interface ToolExecResult {
  /** Stringified result fed back to the model. */
  result: string
  /** Structured result for rich rendering. */
  resultData?: SearchResult[] | FetchedPage
  /** The HTTP transaction of executing the tool (inspectable). */
  transaction?: HttpTransaction
  error?: string
}
