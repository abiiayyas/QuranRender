import { describe, expect, it } from 'vitest'
import { compareSemver, parseRelease, pickReleaseAsset } from './updater'

describe('updater helpers', () => {
  it('compares semver strings accurately', () => {
    expect(compareSemver('0.14.0', '0.13.0')).toBe(1)
    expect(compareSemver('v1.0.0', '0.99.9')).toBe(1)
    expect(compareSemver('0.13.0', '0.13.0')).toBe(0)
    expect(compareSemver('0.12.1', '0.13.0')).toBe(-1)
  })

  it('picks matching platform and arch installer assets from GitHub', () => {
    const assets = [
      { name: 'QuranRender-0.14.0-win-x64.exe', browser_download_url: 'https://github.com/abiiayyas/QuranRender/releases/download/v0.14.0/QuranRender-0.14.0-win-x64.exe', size: 100 },
      { name: 'QuranRender-0.14.0-mac-x64.dmg', browser_download_url: 'https://github.com/abiiayyas/QuranRender/releases/download/v0.14.0/QuranRender-0.14.0-mac-x64.dmg', size: 200 },
      { name: 'QuranRender-0.14.0-mac-arm64.dmg', browser_download_url: 'https://github.com/abiiayyas/QuranRender/releases/download/v0.14.0/QuranRender-0.14.0-mac-arm64.dmg', size: 210 },
      { name: 'bad.dmg', browser_download_url: 'https://evil.example.com/bad.dmg', size: 10 }
    ]
    expect(pickReleaseAsset(assets, 'darwin', 'arm64')?.name).toBe('QuranRender-0.14.0-mac-arm64.dmg')
    expect(pickReleaseAsset(assets, 'darwin', 'x64')?.name).toBe('QuranRender-0.14.0-mac-x64.dmg')
    expect(pickReleaseAsset(assets, 'win32', 'x64')?.name).toBe('QuranRender-0.14.0-win-x64.exe')
  })

  it('parses release metadata and skips drafts or prereleases', () => {
    expect(parseRelease({ tag_name: 'v0.14.0', draft: true }, '0.13.0', 'darwin', 'x64')).toBeNull()
    const info = parseRelease(
      {
        tag_name: 'v0.14.0',
        html_url: 'https://github.com/abiiayyas/QuranRender/releases/tag/v0.14.0',
        body: 'Added batch render & multi-background.',
        assets: [{ name: 'QuranRender-0.14.0-mac-x64.dmg', browser_download_url: 'https://github.com/abiiayyas/QuranRender/releases/download/v0.14.0/QuranRender-0.14.0-mac-x64.dmg', size: 300 }]
      },
      '0.13.0',
      'darwin',
      'x64'
    )
    expect(info?.available).toBe(true)
    expect(info?.latestVersion).toBe('0.14.0')
    expect(info?.assetName).toBe('QuranRender-0.14.0-mac-x64.dmg')
  })
})
