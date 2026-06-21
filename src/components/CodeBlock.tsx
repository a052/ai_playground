import { useState } from 'react'
import { PrismAsync as SyntaxHighlighter } from 'react-syntax-highlighter'
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

interface CodeBlockProps {
  language: string
  value: string
}

export function CodeBlock({ language, value }: CodeBlockProps) {
  const t = useT()
  const theme = useAppStore((s) => s.settings.theme)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border bg-[#fafafa] dark:bg-[#0d0d0d]">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          {language || 'text'}
        </span>
        <button
          type="button"
          onClick={copy}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          )}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-brand" />
              {t('code.copied')}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              {t('code.copy')}
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={theme === 'dark' ? oneDark : oneLight}
        customStyle={{
          margin: 0,
          background: 'transparent',
          fontSize: '0.8125rem',
          padding: '0.85rem 1rem',
        }}
        codeTagProps={{
          style: { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
        }}
        wrapLongLines
      >
        {value}
      </SyntaxHighlighter>
    </div>
  )
}
