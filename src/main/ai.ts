import { getAiKey, getSettings, isLocalEndpoint } from './settings'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** One OpenAI-compatible chat completion (OpenAI, Gemini, OpenRouter, Groq, DeepSeek, Ollama...). Returns the reply text. */
export async function chat(
  messages: ChatMessage[],
  o: { signal?: AbortSignal; maxTokens?: number; json?: boolean } = {}
): Promise<string> {
  const { aiBaseUrl, aiModel } = getSettings()
  const key = getAiKey()
  if (!key && !isLocalEndpoint(aiBaseUrl)) throw new Error('Kunci AI belum diatur. Buka Pengaturan untuk menambahkannya.')
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
    throw new Error(`Layanan AI tidak bisa dihubungi (${aiBaseUrl}). Periksa koneksi dan alamatnya.`)
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Layanan AI menolak permintaan (${res.status}). ${body.slice(0, 200)}`.trim())
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string') throw new Error('Balasan layanan AI tidak berisi teks.')
  return text
}
