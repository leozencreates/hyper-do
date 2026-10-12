import { createContext, useCallback, useContext } from 'react'
import { translate, type Key, type Lang } from './i18n'

export const LangContext = createContext<Lang>('tr')

export function useLang(): Lang {
  return useContext(LangContext)
}

export function useT() {
  const lang = useContext(LangContext)
  return useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang])
}
