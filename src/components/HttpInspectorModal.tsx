import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, ShieldAlert, Terminal } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/CodeBlock'
import { generateCurl } from '@/lib/curlGenerator'
import { useT } from '@/i18n'
import type { HttpTransaction } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  transaction: HttpTransaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HttpInspectorModal({ transaction, open, onOpenChange }: Props) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  const curl = useMemo(
    () => (transaction ? generateCurl(transaction) : ''),
    [transaction],
  )
  const rawRequest = useMemo(
    () => (transaction ? buildRawRequest(transaction) : ''),
    [transaction],
  )
  const rawResponse = useMemo(
    () => (transaction ? buildRawResponse(transaction) : ''),
    [transaction],
  )

  const copyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-brand" />
            {t('inspector.title')}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {transaction && (
              <>
                <span className="font-mono">
                  {transaction.requestMethod} ·{' '}
                  {transaction.apiType.toUpperCase()}
                </span>
                {transaction.responseStatus != null && (
                  <StatusPill
                    status={transaction.responseStatus}
                    text={transaction.responseStatusText}
                  />
                )}
                {transaction.startedAt != null && (
                  <span>
                    {t('inspector.requestTime')}:{' '}
                    {new Date(transaction.startedAt).toLocaleTimeString()}
                  </span>
                )}
                {transaction.durationMs != null && (
                  <span>
                    {t('inspector.duration')}: {transaction.durationMs}ms
                  </span>
                )}
                {transaction.usedProxy && (
                  <span className="inline-flex items-center gap-1 text-amber-500">
                    <ShieldAlert className="h-3 w-3" />
                    {t('inspector.usedProxy')}
                  </span>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {transaction && (
          <Tabs defaultValue="pretty" className="min-w-0">
            <div className="flex items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="pretty">{t('inspector.pretty')}</TabsTrigger>
                <TabsTrigger value="raw">{t('inspector.raw')}</TabsTrigger>
              </TabsList>
              <Button
                size="sm"
                variant={copied ? 'brand' : 'outline'}
                onClick={copyCurl}
                className="gap-1.5"
              >
                {copied ? (
                  <motion.span
                    initial={{ scale: 0.6 }}
                    animate={{ scale: 1 }}
                    className="flex items-center gap-1.5"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('inspector.copied')}
                  </motion.span>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    {t('inspector.copyCurl')}
                  </>
                )}
              </Button>
            </div>

            <TabsContent value="pretty">
              <div className="grid h-[60vh] grid-cols-1 grid-rows-2 gap-4 md:grid-cols-2 md:grid-rows-1">
                <Section label={t('inspector.request')}>
                  <HeaderTable headers={transaction.requestHeaders} />
                  <BodyView body={transaction.requestBody} language="json" />
                </Section>
                <Section label={t('inspector.response')}>
                  {transaction.responseHeaders ? (
                    <HeaderTable headers={transaction.responseHeaders} />
                  ) : null}
                  {transaction.responseBody ? (
                    <BodyView body={transaction.responseBody} language="json" />
                  ) : (
                    <p className="py-2 text-sm text-muted-foreground">
                      {t('inspector.noResponse')}
                    </p>
                  )}
                </Section>
              </div>
            </TabsContent>

            <TabsContent value="raw">
              <div className="grid h-[60vh] grid-cols-1 grid-rows-2 gap-4 md:grid-cols-2 md:grid-rows-1">
                <Section
                  label={t('inspector.request')}
                  action={<CopyButton text={rawRequest} />}
                >
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                    {rawRequest}
                  </pre>
                </Section>
                <Section
                  label={t('inspector.response')}
                  action={<CopyButton text={rawResponse} />}
                >
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                    {rawResponse}
                  </pre>
                </Section>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatusPill({ status, text }: { status: number; text?: string }) {
  const ok = status >= 200 && status < 300
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium',
        ok
          ? 'bg-brand/15 text-brand'
          : 'bg-destructive/15 text-destructive',
      )}
    >
      {status} {text}
    </span>
  )
}

function Section({
  label,
  action,
  children,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin p-3">
        {children}
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-brand" />
          {t('inspector.copied')}
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {t('inspector.copy')}
        </>
      )}
    </button>
  )
}

function HeaderTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers)
  if (entries.length === 0) return null
  return (
    <table className="mb-2 w-full table-fixed border-collapse text-xs">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-b border-border/50 last:border-0">
            <td className="w-2/5 break-words py-1 pr-2 align-top font-mono font-medium text-muted-foreground">
              {k}
            </td>
            <td className="break-all py-1 align-top font-mono">
              {maskSecret(k, v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BodyView({ body, language }: { body: string; language: string }) {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    // not JSON (e.g. SSE stream) — show as-is
    return (
      <pre className="overflow-auto scrollbar-thin rounded-md border border-border bg-muted/30 p-2 font-mono text-xs leading-relaxed">
        {body}
      </pre>
    )
  }
  return <CodeBlock language={language} value={pretty} />
}

/** Lightly mask obvious secrets in the header table (full key kept in cURL). */
function maskSecret(key: string, value: string): string {
  const k = key.toLowerCase()
  if (
    (k === 'authorization' || k === 'x-api-key' || k === 'x-goog-api-key') &&
    value.length > 12
  ) {
    const visible = value.slice(0, 8)
    const tail = value.slice(-4)
    return `${visible}…${tail}`
  }
  return value
}

function buildRawRequest(tx: HttpTransaction): string {
  const lines: string[] = []
  let path = tx.requestUrl
  let host = ''
  try {
    const u = new URL(tx.requestUrl)
    path = `${u.pathname}${u.search}`
    host = u.host
  } catch {
    /* leave full url */
  }

  lines.push(`${tx.requestMethod} ${path} HTTP/1.1`)
  if (host) lines.push(`Host: ${host}`)
  for (const [k, v] of Object.entries(tx.requestHeaders)) {
    lines.push(`${k}: ${v}`)
  }
  lines.push('')
  lines.push(tx.requestBody)

  return lines.join('\n')
}

function buildRawResponse(tx: HttpTransaction): string {
  const lines: string[] = []
  if (tx.responseStatus != null) {
    lines.push(
      `HTTP/1.1 ${tx.responseStatus} ${tx.responseStatusText ?? ''}`.trim(),
    )
  }
  for (const [k, v] of Object.entries(tx.responseHeaders ?? {})) {
    lines.push(`${k}: ${v}`)
  }
  lines.push('')
  lines.push(tx.responseBody ?? '(no response body)')
  if (tx.error) {
    lines.push('')
    lines.push(`! ${tx.error}`)
  }

  return lines.join('\n')
}
