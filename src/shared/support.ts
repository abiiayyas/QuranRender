/** Where people can chip in for the app. A link with an empty `url` is not shown, so adding or retiring one is a one-line change. */
export interface SupportLink {
  id: 'paypal' | 'saweria'
  /** Brand names: not translated. */
  label: string
  /** https only: the main process refuses to open anything else. */
  url: string
  icon: string
}

export const SUPPORT_LINKS: SupportLink[] = [
  { id: 'paypal', label: 'PayPal', url: 'https://paypal.me/jagongaji', icon: 'heart' },
  { id: 'saweria', label: 'Saweria', url: 'https://saweria.co/jagongaji', icon: 'coffee' }
]
