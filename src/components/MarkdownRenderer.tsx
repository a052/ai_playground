import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { CodeBlock } from '@/components/CodeBlock'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
  content: string
  className?: string
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={cn('prose-chat', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Render fenced blocks via CodeBlock; keep inline code inline.
          pre: ({ children }) => <>{children}</>,
          code({ className: cls, children }) {
            const match = /language-(\w+)/.exec(cls || '')
            const raw = String(children ?? '')
            const isBlock = !!match || raw.includes('\n')
            if (isBlock) {
              return (
                <CodeBlock
                  language={match?.[1] ?? ''}
                  value={raw.replace(/\n$/, '')}
                />
              )
            }
            return <code className={cls}>{children}</code>
          },
          a: ({ ...props }) => (
            <a target="_blank" rel="noreferrer noopener" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
