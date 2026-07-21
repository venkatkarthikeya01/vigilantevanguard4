import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '@/i18n'

interface LangStore {
  lang: Lang
  setLang: (l: Lang) => void
}

export const useLangStore = create<LangStore>()(
  persist(
    (set) => ({
      lang: 'en',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'vv_lang' }
  )
)
