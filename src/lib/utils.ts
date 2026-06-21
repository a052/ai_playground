import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { AttachmentKind } from '@/types'

/** Merge Tailwind class names, resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Generate a reasonably unique id without external deps. */
export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `${prefix}${time}${rand}`
}

/** Format bytes into a human readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

/** Format a unix timestamp (ms) as a short locale time. */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format a unix timestamp (ms) as a short date. */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

/** Read a File as a base64 data URL. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Read a File as plain UTF-8 text. */
export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

/** Extension → markdown fence-language hint for text/code documents. */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp',
  cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash',
  bash: 'bash', zsh: 'bash', ps1: 'powershell', sql: 'sql', html: 'html',
  htm: 'html', css: 'css', scss: 'scss', less: 'less', json: 'json',
  jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  xml: 'xml', md: 'markdown', markdown: 'markdown', csv: 'csv', tsv: 'text',
  txt: 'text', log: 'text', env: 'bash', vue: 'vue', svelte: 'svelte',
  r: 'r', lua: 'lua', dart: 'dart', scala: 'scala', pl: 'perl', m: 'objectivec',
  mm: 'objectivec', gradle: 'groovy', groovy: 'groovy', makefile: 'makefile',
  dockerfile: 'dockerfile', graphql: 'graphql', proto: 'protobuf',
}

const TEXT_DOC_EXT = new Set(Object.keys(EXT_LANG))
/** Common extensionless text filenames. */
const TEXT_DOC_NAMES = new Set(['makefile', 'dockerfile', 'license', 'readme'])

/** Lower-cased file extension (without the dot), or '' if none. */
export function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

export interface DetectedAttachment {
  kind: AttachmentKind
  isPdf: boolean
  isTextDoc: boolean
}

/** Decide how to treat a selected/dropped file. Returns null if unsupported. */
export function detectAttachment(file: File): DetectedAttachment | null {
  const mime = file.type
  const ext = fileExt(file.name)
  if (mime.startsWith('image/'))
    return { kind: 'image', isPdf: false, isTextDoc: false }
  if (mime.startsWith('audio/'))
    return { kind: 'audio', isPdf: false, isTextDoc: false }
  if (mime.startsWith('video/'))
    return { kind: 'video', isPdf: false, isTextDoc: false }
  if (mime === 'application/pdf' || ext === 'pdf')
    return { kind: 'document', isPdf: true, isTextDoc: false }
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    TEXT_DOC_EXT.has(ext) ||
    TEXT_DOC_NAMES.has(file.name.toLowerCase())
  )
    return { kind: 'document', isPdf: false, isTextDoc: true }
  return null
}

/** Build a fenced text block for a text/code document attachment. */
export function formatDocText(name: string, text: string): string {
  const lang = EXT_LANG[fileExt(name)] ?? ''
  return `[File: ${name}]\n\`\`\`${lang}\n${text}\n\`\`\``
}

/** Strip the `data:<mime>;base64,` prefix from a data URL. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

/** Extract the mime type from a data URL. */
export function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;]+);/.exec(dataUrl)
  return match ? match[1] : 'application/octet-stream'
}
