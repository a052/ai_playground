import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

/** Chip-style multi-value text input (used for stop sequences). */
export function TagInput({
  value,
  onChange,
  placeholder,
  className,
  disabled,
}: TagInputProps) {
  const [draft, setDraft] = React.useState('')

  const add = () => {
    if (disabled) return
    const v = draft.trim()
    if (!v) return
    if (!value.includes(v)) onChange([...value, v])
    setDraft('')
  }

  const removeAt = (idx: number) => {
    if (disabled) return
    onChange(value.filter((_, i) => i !== idx))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && value.length) {
      removeAt(value.length - 1)
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {value.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground"
        >
          {tag.replace(/\n/g, '\\n').replace(/\t/g, '\\t')}
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder={value.length === 0 ? placeholder : ''}
        className="h-6 flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  )
}
