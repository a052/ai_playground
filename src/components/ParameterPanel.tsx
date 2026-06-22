import { type ReactNode } from 'react'
import { Lock, PanelRightClose, RotateCcw } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TagInput } from '@/components/ui/tag-input'
import { InfoTooltip } from '@/components/ui/info-tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TemplatePicker } from '@/components/TemplatePicker'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useT } from '@/i18n'
import type { ModelParameters, ToggleableParam } from '@/types'
import { cn } from '@/lib/utils'

export function ParameterPanel() {
  const t = useT()
  const p = useAppStore((s) => s.parameters)
  const set = useAppStore((s) => s.setParameter)
  const reset = useAppStore((s) => s.resetParameters)
  const setParamPanel = useUiStore((s) => s.setParamPanel)

  const promptTemplates = useAppStore((s) => s.promptTemplates)
  const addPromptTemplate = useAppStore((s) => s.addPromptTemplate)
  const updatePromptTemplate = useAppStore((s) => s.updatePromptTemplate)
  const removePromptTemplate = useAppStore((s) => s.removePromptTemplate)

  const reasoningTemplates = useAppStore((s) => s.reasoningTemplates)
  const addReasoningTemplate = useAppStore((s) => s.addReasoningTemplate)
  const updateReasoningTemplate = useAppStore((s) => s.updateReasoningTemplate)
  const removeReasoningTemplate = useAppStore((s) => s.removeReasoningTemplate)

  const logitInvalid =
    p.enabled.logitBias && !!p.logitBias.trim() && !isValidJson(p.logitBias)
  const customReasoningInvalid =
    p.enabled.reasoningEffort &&
    p.reasoningCustomEnabled &&
    !!p.reasoningCustom.trim() &&
    !isValidJsonFragment(p.reasoningCustom)

  const setEnabled = (key: ToggleableParam, v: boolean) => {
    const next: Record<ToggleableParam, boolean> = { ...p.enabled, [key]: v }
    set('enabled', next)
  }
  const tog = (key: ToggleableParam) => ({
    checked: p.enabled[key],
    onChange: (v: boolean) => setEnabled(key, v),
  })
  const off = (key: ToggleableParam) => !p.enabled[key]

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setParamPanel(false)}
            title={t('param.collapse')}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold">{t('param.title')}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={reset}
          title={t('param.reset')}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
        {/* System prompt (always active) */}
        <Field
          label={t('param.systemPrompt')}
          tip={t('param.systemPrompt.tip')}
          actions={
            <TemplatePicker
              templates={promptTemplates}
              onApply={(content) => set('systemPrompt', content)}
              onAdd={addPromptTemplate}
              onUpdate={updatePromptTemplate}
              onDelete={removePromptTemplate}
              labelKey="templates.systemPrompt"
            />
          }
        >
          <Textarea
            value={p.systemPrompt}
            onChange={(e) => set('systemPrompt', e.target.value)}
            placeholder={t('param.systemPrompt.placeholder')}
            className="min-h-[96px]"
          />
        </Field>

        {/* Streaming toggle */}
        <Field label={t('param.stream')} tip={t('param.stream.tip')}>
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-sm">{t('param.stream.enable')}</span>
            <Switch
              checked={p.stream}
              onCheckedChange={(v) => set('stream', v)}
            />
          </div>
        </Field>

        <Accordion
          type="multiple"
          defaultValue={['sampling', 'reasoning']}
          className="mt-1"
        >
          {/* Sampling */}
          <AccordionItem value="sampling">
            <AccordionTrigger>{t('param.section.sampling')}</AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <Field
                label={t('param.temperature')}
                tip={t('param.temperature.tip')}
                value={p.temperature.toFixed(1)}
                dim={off('temperature')}
                toggle={tog('temperature')}
              >
                {p.enabled.claudeThinking && (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
                    <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                    {t('param.temperature.thinkingWarn')}
                  </p>
                )}
                <Slider
                  min={0}
                  max={2}
                  step={0.1}
                  disabled={off('temperature')}
                  value={[p.temperature]}
                  onValueChange={([v]) => set('temperature', v)}
                />
              </Field>

              <Field
                label={t('param.maxCompletionTokens')}
                tip={t('param.maxCompletionTokens.tip')}
                dim={off('maxCompletionTokens')}
                toggle={tog('maxCompletionTokens')}
              >
                <Input
                  type="number"
                  min={1}
                  disabled={off('maxCompletionTokens')}
                  value={p.maxCompletionTokens}
                  onChange={(e) =>
                    set(
                      'maxCompletionTokens',
                      clampInt(e.target.value, 1, 1, 10_000_000),
                    )
                  }
                />
              </Field>

              <Field
                label={t('param.topP')}
                tip={t('param.topP.tip')}
                value={p.topP.toFixed(2)}
                dim={off('topP')}
                toggle={tog('topP')}
              >
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={off('topP')}
                  value={[p.topP]}
                  onValueChange={([v]) => set('topP', v)}
                />
              </Field>

              <Field
                label={t('param.topK')}
                tip={t('param.topK.tip')}
                appliesTo={['Claude', 'Gemini']}
                dim={off('topK')}
                toggle={tog('topK')}
              >
                <Input
                  type="number"
                  min={1}
                  max={500}
                  disabled={off('topK')}
                  placeholder={t('param.seed.placeholder')}
                  value={p.topK ?? ''}
                  onChange={(e) =>
                    set('topK', nullableInt(e.target.value, 1, 500))
                  }
                />
              </Field>
            </AccordionContent>
          </AccordionItem>

          {/* Reasoning */}
          <AccordionItem value="reasoning">
            <AccordionTrigger>{t('param.section.reasoning')}</AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <Field
                label={t('param.reasoningEffort')}
                tip={t('param.reasoningEffort.tip')}
                appliesTo={['OpenAI']}
                dim={off('reasoningEffort')}
                toggle={tog('reasoningEffort')}
              >
                <Select
                  value={p.reasoningEffort}
                  disabled={off('reasoningEffort') || p.reasoningCustomEnabled}
                  onValueChange={(v) =>
                    set('reasoningEffort', v as ModelParameters['reasoningEffort'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">{t('param.optMinimal')}</SelectItem>
                    <SelectItem value="low">{t('param.optLow')}</SelectItem>
                    <SelectItem value="medium">{t('param.optMedium')}</SelectItem>
                    <SelectItem value="high">{t('param.optHigh')}</SelectItem>
                  </SelectContent>
                </Select>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex min-w-0 items-center gap-1.5">
                      <Checkbox
                        checked={p.reasoningCustomEnabled}
                        onCheckedChange={(v) => set('reasoningCustomEnabled', v)}
                        disabled={off('reasoningEffort')}
                        aria-label={t('param.reasoningCustom.enable')}
                      />
                      <span
                        className={cn(
                          'text-xs text-muted-foreground',
                          off('reasoningEffort') && 'opacity-50',
                        )}
                      >
                        {t('param.reasoningCustom.enable')}
                      </span>
                      <InfoTooltip text={t('param.reasoningCustom.tip')} />
                    </label>
                    <TemplatePicker
                      templates={reasoningTemplates}
                      onApply={(content) => set('reasoningCustom', content)}
                      onAdd={addReasoningTemplate}
                      onUpdate={updateReasoningTemplate}
                      onDelete={removeReasoningTemplate}
                      labelKey="templates.reasoning"
                      disabled={
                        off('reasoningEffort') || !p.reasoningCustomEnabled
                      }
                    />
                  </div>
                  <Textarea
                    value={p.reasoningCustom}
                    disabled={off('reasoningEffort') || !p.reasoningCustomEnabled}
                    onChange={(e) => set('reasoningCustom', e.target.value)}
                    placeholder={t('param.reasoningCustom.placeholder')}
                    className={cn(
                      'min-h-[72px] font-mono text-xs',
                      customReasoningInvalid &&
                        'border-destructive focus-visible:ring-destructive',
                    )}
                  />
                  {customReasoningInvalid && (
                    <p className="text-[11px] text-destructive">
                      {t('param.reasoningCustom.invalid')}
                    </p>
                  )}
                </div>
              </Field>

              <Field
                label={t('param.geminiThinking')}
                tip={t('param.geminiThinking.tip')}
                appliesTo={['Gemini']}
                dim={off('geminiThinkingLevel')}
                toggle={tog('geminiThinkingLevel')}
              >
                <Select
                  value={p.geminiThinkingLevel}
                  disabled={off('geminiThinkingLevel')}
                  onValueChange={(v) =>
                    set(
                      'geminiThinkingLevel',
                      v as ModelParameters['geminiThinkingLevel'],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimal">{t('param.optMinimal')}</SelectItem>
                    <SelectItem value="low">{t('param.optLow')}</SelectItem>
                    <SelectItem value="medium">{t('param.optMedium')}</SelectItem>
                    <SelectItem value="high">{t('param.optHigh')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={t('param.claudeThinking')}
                tip={t('param.claudeThinking.tip')}
                appliesTo={['Claude']}
                dim={off('claudeThinking')}
                toggle={tog('claudeThinking')}
              >
                {p.enabled.claudeThinking && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {t('param.claudeEffort')}
                      </Label>
                      <InfoTooltip text={t('param.claudeEffort.tip')} />
                    </div>
                    <Select
                      value={p.claudeEffort}
                      onValueChange={(v) =>
                        set('claudeEffort', v as ModelParameters['claudeEffort'])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">{t('param.optLow')}</SelectItem>
                        <SelectItem value="medium">{t('param.optMedium')}</SelectItem>
                        <SelectItem value="high">{t('param.optHigh')}</SelectItem>
                        <SelectItem value="xhigh">{t('param.optXhigh')}</SelectItem>
                        <SelectItem value="max">{t('param.optMax')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </Field>
            </AccordionContent>
          </AccordionItem>

          {/* Penalties */}
          <AccordionItem value="penalty">
            <AccordionTrigger>{t('param.section.penalty')}</AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <Field
                label={t('param.presencePenalty')}
                tip={t('param.presencePenalty.tip')}
                value={p.presencePenalty.toFixed(1)}
                appliesTo={['OpenAI']}
                dim={off('presencePenalty')}
                toggle={tog('presencePenalty')}
              >
                <Slider
                  min={-2}
                  max={2}
                  step={0.1}
                  disabled={off('presencePenalty')}
                  value={[p.presencePenalty]}
                  onValueChange={([v]) => set('presencePenalty', v)}
                />
              </Field>
              <Field
                label={t('param.frequencyPenalty')}
                tip={t('param.frequencyPenalty.tip')}
                value={p.frequencyPenalty.toFixed(1)}
                appliesTo={['OpenAI']}
                dim={off('frequencyPenalty')}
                toggle={tog('frequencyPenalty')}
              >
                <Slider
                  min={-2}
                  max={2}
                  step={0.1}
                  disabled={off('frequencyPenalty')}
                  value={[p.frequencyPenalty]}
                  onValueChange={([v]) => set('frequencyPenalty', v)}
                />
              </Field>
            </AccordionContent>
          </AccordionItem>

          {/* Formatting & control */}
          <AccordionItem value="format">
            <AccordionTrigger>{t('param.section.format')}</AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <Field
                label={t('param.responseFormat')}
                tip={t('param.responseFormat.tip')}
                dim={off('responseFormat')}
                toggle={tog('responseFormat')}
              >
                <Select
                  value={p.responseFormat}
                  disabled={off('responseFormat')}
                  onValueChange={(v) =>
                    set('responseFormat', v as ModelParameters['responseFormat'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">
                      {t('param.responseFormat.text')}
                    </SelectItem>
                    <SelectItem value="json_object">
                      {t('param.responseFormat.json')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={t('param.stop')}
                tip={t('param.stop.tip')}
                dim={off('stopSequences')}
                toggle={tog('stopSequences')}
              >
                <TagInput
                  value={p.stopSequences}
                  disabled={off('stopSequences')}
                  onChange={(v) => set('stopSequences', v)}
                  placeholder={t('param.stop.placeholder')}
                />
              </Field>

              <Field
                label={t('param.seed')}
                tip={t('param.seed.tip')}
                dim={off('seed')}
                toggle={tog('seed')}
              >
                <Input
                  type="number"
                  disabled={off('seed')}
                  placeholder={t('param.seed.placeholder')}
                  value={p.seed ?? ''}
                  onChange={(e) =>
                    set('seed', nullableInt(e.target.value, -2_147_483_648, 2_147_483_647))
                  }
                />
              </Field>
            </AccordionContent>
          </AccordionItem>

          {/* Advanced */}
          <AccordionItem value="advanced" className="border-b-0">
            <AccordionTrigger>{t('param.section.advanced')}</AccordionTrigger>
            <AccordionContent className="space-y-5 pt-1">
              <Field
                label={t('param.n')}
                tip={t('param.n.tip')}
                appliesTo={['OpenAI']}
                dim={off('n')}
                toggle={tog('n')}
              >
                <Input
                  type="number"
                  min={1}
                  max={5}
                  disabled={off('n')}
                  value={p.n}
                  onChange={(e) => set('n', clampInt(e.target.value, 1, 1, 5))}
                />
              </Field>

              <Field
                label={t('param.logitBias')}
                tip={t('param.logitBias.tip')}
                appliesTo={['OpenAI']}
                dim={off('logitBias')}
                toggle={tog('logitBias')}
              >
                <Textarea
                  value={p.logitBias}
                  disabled={off('logitBias')}
                  onChange={(e) => set('logitBias', e.target.value)}
                  placeholder={t('param.logitBias.placeholder')}
                  className={cn(
                    'min-h-[72px] font-mono text-xs',
                    logitInvalid && 'border-destructive focus-visible:ring-destructive',
                  )}
                />
                {logitInvalid && (
                  <p className="text-[11px] text-destructive">
                    {t('param.logitBias.invalid')}
                  </p>
                )}
              </Field>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  )
}

// --- field wrapper ----------------------------------------------------------

function Field({
  label,
  tip,
  value,
  appliesTo,
  toggle,
  dim,
  actions,
  children,
}: {
  label: string
  tip: string
  value?: string
  appliesTo?: string[]
  /** When present, renders an enable checkbox by the label. */
  toggle?: { checked: boolean; onChange: (v: boolean) => void; locked?: boolean }
  /** Dim the label/value to signal the control is inactive. */
  dim?: boolean
  /** Optional controls rendered on the right side of the label row. */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-2 py-3 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {toggle && (
            <Checkbox
              checked={toggle.checked}
              onCheckedChange={toggle.onChange}
              disabled={toggle.locked}
              aria-label={label}
            />
          )}
          <Label className={cn('text-[13px]', dim && 'text-muted-foreground')}>
            {label}
          </Label>
          <InfoTooltip text={tip} />
          {appliesTo && (
            <span className="flex flex-wrap items-center gap-1">
              {appliesTo.map((a) => (
                <span
                  key={a}
                  className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {a}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {value !== undefined && (
            <span
              className={cn(
                'font-mono text-xs text-muted-foreground',
                dim && 'opacity-50',
              )}
            >
              {value}
            </span>
          )}
          {actions}
        </div>
      </div>
      {children}
    </div>
  )
}

// --- helpers ----------------------------------------------------------------

function clampInt(raw: string, fallback: number, min: number, max: number) {
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function nullableInt(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return null
  return Math.min(max, Math.max(min, n))
}

function isValidJson(s: string): boolean {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

/**
 * Validate a custom reasoning fragment the same way `mergeJsonFragment` parses
 * it: tolerate stray edge commas and a bare key/value list (auto-wrapped in
 * braces). Empty input is treated as valid (nothing is sent).
 */
function isValidJsonFragment(raw: string): boolean {
  let s = raw.trim()
  if (!s) return true
  s = s.replace(/^,+/, '').replace(/,+\s*$/, '').trim()
  if (!s) return true
  const candidate = s.startsWith('{') && s.endsWith('}') ? s : `{${s}}`
  try {
    const parsed = JSON.parse(candidate)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}
