import { useCallback } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { translations, type TranslationKey } from './translations'

export type { TranslationKey }

/** Replace `{name}` placeholders in a template string. */
function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  )
}

/**
 * Translation hook bound to the current language in the store.
 * Returns a `t(key, vars?)` function.
 */
export function useT() {
  const language = useAppStore((s) => s.settings.language)
  return useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const dict = translations[language] ?? translations.en
      const value = dict[key] ?? translations.en[key] ?? key
      return interpolate(value, vars)
    },
    [language],
  )
}
