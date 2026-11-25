import 'i18next'
import type zhCN from './locales/zh-CN.json'

// Keys are checked against the source language (Simplified Chinese).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof zhCN }
  }
}
