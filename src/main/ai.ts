import { t } from '@shared/i18n'
import { buildCliPrompt, cliToolName, extractJson } from '@shared/aiTools'
import type { AiReady } from '@shared/types'
import { askCli, CLI_TEST_TIMEOUT_MS, missingBin } from './cli'
import { getAiKey, getSettings, isLocalEndpoint } from './settings'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOptions {
  signal?: AbortSignal
  /** Only the API path: a CLI has no token limit to set. */
  maxTokens?: number
  json?: boolean
  /** Only the CLI path (an API call has no wall-clock limit of its own). */
  timeoutMs?: number
}

/**
 * One text completion, from the provider chosen in Settings: an OpenAI-compatible API (OpenAI, Gemini, OpenRouter, Groq,
 * DeepSeek, Ollama...) or an AI CLI on this computer. Returns the reply text; with `json` it is a JSON document either way.
 */
export async function chat(messages: ChatMessage[], o: ChatOptions = {}): Promise<string> {
  return getSettings().aiProvider === 'cli' ? chatCli(messages, o) : chatApi(messages, o)
}

async function chatCli(messages: ChatMessage[], o: ChatOptions): Promise<string> {
  const { cliTool, cliCommand, cliModel } = getSettings()
  const base = buildCliPrompt(messages, !!o.json)
  let prompt = base
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await askCli({ tool: cliTool, command: cliCommand, model: cliModel, prompt, timeoutMs: o.timeoutMs, signal: o.signal })
    if (!text.trim()) throw new Error(t('{tool} berjalan tapi tidak membalas apa pun.', { tool: cliToolName(cliTool) }))
    if (!o.json) return text
    try {
      // Callers parse the reply themselves; handing back the clean document spares them prose and code fences around it.
      return JSON.stringify(extractJson(text))
    } catch {
      prompt = `${base}\n\nYour previous reply was not valid JSON. Reply again with the JSON object only, starting with { and ending with }.`
    }
  }
  throw new Error(t('{tool} tidak membalas dengan JSON yang valid. Silakan coba lagi, atau pilih CLI atau model lain di Pengaturan.', { tool: cliToolName(cliTool) }))
}

async function chatApi(messages: ChatMessage[], o: ChatOptions): Promise<string> {
  const { aiBaseUrl, aiModel } = getSettings()
  const key = getAiKey()
  if (!key && !isLocalEndpoint(aiBaseUrl)) throw new Error(t('Kunci AI belum diatur. Buka Pengaturan untuk menambahkannya.'))
  const res = await fetch(`${aiBaseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    signal: o.signal,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: aiModel,
      messages,
      ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
      ...(o.json ? { response_format: { type: 'json_object' } } : {})
    })
  }).catch((e: Error) => {
    if (e.name === 'AbortError') throw e
    throw new Error(t('Layanan AI tidak bisa dihubungi ({url}). Periksa koneksi dan alamatnya.', { url: aiBaseUrl }))
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(t('Layanan AI menolak permintaan ({status}). {detail}', { status: res.status, detail: body.slice(0, 200) }).trim())
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error(t('Balasan layanan AI tidak berisi teks.'))
  return text
}

/** Whether a text AI call can run now, without making one. Shown as a hint where AI is optional (AI trim, Publikasi). */
export async function aiReady(): Promise<AiReady> {
  const { aiProvider, aiBaseUrl, cliTool, cliCommand } = getSettings()
  if (aiProvider === 'cli') {
    if (cliTool === 'custom') {
      return cliCommand.trim() ? { ready: true, via: 'cli', hint: '' } : { ready: false, via: null, hint: t('Perintah CLI belum diisi di Pengaturan.') }
    }
    const missing = await missingBin(cliTool)
    return missing
      ? { ready: false, via: null, hint: t('CLI {missing} tidak ditemukan di komputer ini. Pasang {tool} dan login, atau pilih penyedia lain di Pengaturan.', { missing, tool: cliToolName(cliTool) }) }
      : { ready: true, via: 'cli', hint: '' }
  }
  try {
    if (getAiKey() || isLocalEndpoint(aiBaseUrl)) return { ready: true, via: 'api', hint: '' }
  } catch {
    return { ready: false, via: null, hint: t('Kunci AI tersimpan tapi tidak bisa dibuka lagi. Masukkan ulang kuncinya di Pengaturan.') }
  }
  return { ready: false, via: null, hint: t('Kunci AI belum diatur. Buka Pengaturan untuk menambahkannya.') }
}

/** A tiny real request, so the test proves the whole path: program found, logged in, answering. */
export async function testAi(): Promise<string> {
  const { aiProvider, cliTool } = getSettings()
  const reply = await chat([{ role: 'user', content: 'Reply with the single word: OK' }], { maxTokens: 5, timeoutMs: CLI_TEST_TIMEOUT_MS })
  const answer = reply.trim().slice(0, 40)
  return aiProvider === 'cli' ? t('Terhubung lewat {tool}. Balasan model: {reply}', { tool: cliToolName(cliTool), reply: answer }) : t('Terhubung. Balasan model: {reply}', { reply: answer })
}
