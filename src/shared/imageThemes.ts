import { msg } from './i18n'
import type { ImageRequest } from './imagegen'
import type { Aspect } from './types'

export interface ImageTheme {
  id: string
  /** Indonesian name for the picker. */
  label: string
  hint: string
  /** English scene description for the image model. Never describes people or animals. */
  prompt: string
}

/**
 * Scenes that sit well behind recitation text. No theme shows a living being, music, or writing: geometry, nature,
 * architecture, sky and light only.
 */
export const IMAGE_THEMES: ImageTheme[] = [
  {
    id: 'lofi-room',
    label: msg('Lofi kamar hujan'),
    hint: msg('Kamar kosong, lampu meja hangat, jendela berhujan.'),
    prompt:
      'cozy lofi bedroom interior at night, an EMPTY room, warm desk lamp glowing, a window with rain streaming down the glass, blurred city lights outside, a small plant and closed books on the desk, muted warm colors, painterly illustration'
  },
  {
    id: 'lofi-rooftops',
    label: msg('Lofi atap kota malam'),
    hint: msg('Atap-atap kota sepi dengan lampu gantung dan langit senja.'),
    prompt:
      'lofi night city rooftops, empty rooftops with water tanks and strings of warm lights, softly glowing windows in the distance, deep blue and purple dusk sky with faint clouds, painterly illustration'
  },
  {
    id: 'starry-desert',
    label: msg('Gurun berbintang'),
    hint: msg('Bukit pasir sunyi di bawah langit malam penuh bintang.'),
    prompt: 'quiet desert sand dunes under a clear night sky full of stars and a faint milky way, smooth wind-carved ripples in the sand, deep blue and indigo tones'
  },
  {
    id: 'mosque-dusk',
    label: msg('Siluet masjid senja'),
    hint: msg('Kubah dan menara masjid dari kejauhan, hanya bangunannya.'),
    prompt:
      'distant silhouette of a mosque with domes and slender minarets against a gradient dusk sky from deep blue to soft amber, architecture only, an empty wide plaza, simple and serene'
  },
  {
    id: 'misty-pines',
    label: msg('Hutan pinus berkabut'),
    hint: msg('Barisan pohon pinus diselimuti kabut pagi.'),
    prompt: 'misty pine forest at early morning, tall pine trees fading into soft fog, gentle light filtering through the mist, cool green and grey tones'
  },
  {
    id: 'sea-sunset',
    label: msg('Laut tenang saat senja'),
    hint: msg('Laut tenang dan langit jingga keunguan.'),
    prompt: 'calm sea at sunset, glassy water reflecting a glowing sky of orange, pink and violet, a clean low horizon, gentle small waves'
  },
  {
    id: 'geometric-tiles',
    label: msg('Pola ubin geometris Islami'),
    hint: msg('Bintang dan segi banyak yang saling terjalin, tanpa huruf.'),
    prompt:
      'islamic geometric tile pattern, pure geometry only: interlaced stars and polygons in teal, deep blue, ivory and soft gold, fine lines, symmetrical, evenly spaced, subtle and calm'
  },
  {
    id: 'floating-lanterns',
    label: msg('Lentera mengapung di air tenang'),
    hint: msg('Lentera kertas bercahaya hangat di atas air malam.'),
    prompt: 'paper lanterns floating on still dark water at night, warm golden glow reflected on the surface, an empty shoreline in the distance, soft bokeh'
  },
  {
    id: 'mountain-lake-dawn',
    label: msg('Danau pegunungan saat fajar'),
    hint: msg('Danau jernih memantulkan gunung dan langit fajar.'),
    prompt: 'mountain lake at dawn, still water mirroring layered mountains and a pale pink and gold sky, thin mist over the water, wide and peaceful'
  },
  {
    id: 'soft-gradient',
    label: msg('Gradasi lembut berbutir'),
    hint: msg('Warna lembut minimalis dengan butiran halus.'),
    prompt: 'minimal soft gradient background from pale teal to warm peach with fine film grain, nothing else in the frame'
  },
  {
    id: 'morning-sky',
    label: msg('Langit pagi berawan'),
    hint: msg('Awan lembut dan berkas cahaya keemasan.'),
    prompt: 'serene morning sky with soft layered clouds and golden rays of light breaking through, pastel blue and warm gold, open and airy'
  },
  {
    id: 'palm-oasis',
    label: msg('Oasis kurma saat senja'),
    hint: msg('Pohon kurma di tepi air yang tenang, tanpa siapa pun.'),
    prompt: 'quiet desert oasis at golden hour, a few date palm trees beside still water, soft sand and a warm hazy sky, empty and peaceful'
  }
]

/** Never removable: always the last words the image model reads. */
export const IMAGE_SAFETY_CLAUSE = 'No people, no human figures, no faces, no animals, no text, no letters, no calligraphy, no logos, no watermark.'

const STYLE_CLAUSE = 'Background wallpaper for a video, soft low-contrast centre so overlaid text stays readable.'

const ORIENTATION: Record<Aspect, string> = {
  '9:16': 'Vertical portrait composition, 9:16.',
  '16:9': 'Wide landscape composition, 16:9.',
  '1:1': 'Square composition, 1:1.'
}

/** What a free-text prompt may be before it is cut; a longer one only dilutes the theme. */
export const MAX_PROMPT_CHARS = 400

const FALLBACK_SCENE = 'a calm, minimal abstract background of soft light and gentle colour'

/** Words (Indonesian and English) for living beings; the app does not ship pictures of them. */
const LIVING_BEING =
  /\b(orang|manusia|laki-laki|perempuan|wanita|pria|anak|bayi|wajah|muka|tangan|jemaah|imam|hewan|binatang|burung|kucing|anjing|kuda|unta|domba|kambing|ikan|kupu-kupu|people|person|man|men|woman|women|girl|boy|child|children|baby|face|faces|portrait|crowd|human|humans|figure|silhouette of a (?:man|woman|person)|animal|animals|bird|birds|cat|cats|dog|dogs|horse|horses|camel|camels|sheep|fish|butterfly|worshippers?|pilgrims?)\b/i

/** The first living-being word in a user's prompt, or null; the caller asks the user to rephrase. */
export function livingBeingWord(prompt: string): string | null {
  return LIVING_BEING.exec(prompt)?.[0] ?? null
}

/**
 * The text sent to an image model. A theme and/or the user's words describe the scene; the style, orientation and safety
 * clauses are appended after them, so nothing the user types can drop the safety clause.
 */
export function buildImagePrompt(request: ImageRequest): string {
  const theme = IMAGE_THEMES.find((t) => t.id === request.themeId)
  const custom = request.prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_CHARS)
  const scene = [theme?.prompt, custom].filter(Boolean).join(', ') || FALLBACK_SCENE
  return [scene.replace(/[.\s]+$/, '') + '.', STYLE_CLAUSE, ORIENTATION[request.aspect] ?? ORIENTATION['9:16'], IMAGE_SAFETY_CLAUSE].join(' ')
}
