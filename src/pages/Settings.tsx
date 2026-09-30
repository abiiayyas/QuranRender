import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export const Settings: React.FC = () => {
  const { settings, updateSettings } = useAppStore();
  const [cacheSize, setCacheSize] = useState<string>('Loading...');
  
  const [aiProvider, setAiProvider] = useState('openai');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiImageProvider, setAiImageProvider] = useState('openai');
  const [aiImageApiKey, setAiImageApiKey] = useState('');
  const [aiTtsProvider, setAiTtsProvider] = useState('openai');
  const [aiTtsApiKey, setAiTtsApiKey] = useState('');
  const [pixabayApiKey, setPixabayApiKey] = useState('');
  const [pexelsApiKey, setPexelsApiKey] = useState('');
  const [ytDlpPath, setYtDlpPath] = useState('');
  const [toolStatus, setToolStatus] = useState<any>(null);

  const checkTools = async () => {
    try {
      const res: any = await invoke('check_ytdlp_status');
      setToolStatus(res);
      if (res?.yt_dlp_path) setYtDlpPath(res.yt_dlp_path);
    } catch (e) {
      console.error(e);
    }
  };

  const loadAiSettings = async () => {
    try {
      const p = await invoke<string | null>('get_app_setting', { key: 'ai_provider' });
      if (p) setAiProvider(p);
      const k = await invoke<string | null>('get_app_setting', { key: 'ai_api_key' });
      if (k) setAiApiKey(k);
      const ip = await invoke<string | null>('get_app_setting', { key: 'ai_image_provider' });
      if (ip) setAiImageProvider(ip);
      const ik = await invoke<string | null>('get_app_setting', { key: 'ai_image_api_key' });
      if (ik) setAiImageApiKey(ik);
      const tp = await invoke<string | null>('get_app_setting', { key: 'ai_tts_provider' });
      if (tp) setAiTtsProvider(tp);
      const tk = await invoke<string | null>('get_app_setting', { key: 'ai_tts_api_key' });
      if (tk) setAiTtsApiKey(tk);
      const pk = await invoke<string | null>('get_app_setting', { key: 'pixabay_api_key' });
      if (pk) setPixabayApiKey(pk);
      const xk = await invoke<string | null>('get_app_setting', { key: 'pexels_api_key' });
      if (xk) setPexelsApiKey(xk);
      const ypath = await invoke<string | null>('get_app_setting', { key: 'yt_dlp_path' });
      if (ypath) setYtDlpPath(ypath);
    } catch (e) {
      console.error(e);
    }
  };

  const saveAiSettings = async () => {
    try {
      await invoke('save_app_setting', { key: 'ai_provider', value: aiProvider });
      await invoke('save_app_setting', { key: 'ai_api_key', value: aiApiKey });
      await invoke('save_app_setting', { key: 'ai_image_provider', value: aiImageProvider });
      await invoke('save_app_setting', { key: 'ai_image_api_key', value: aiImageApiKey });
      await invoke('save_app_setting', { key: 'ai_tts_provider', value: aiTtsProvider });
      await invoke('save_app_setting', { key: 'ai_tts_api_key', value: aiTtsApiKey });
      await invoke('save_app_setting', { key: 'pixabay_api_key', value: pixabayApiKey });
      await invoke('save_app_setting', { key: 'pexels_api_key', value: pexelsApiKey });
      await invoke('save_app_setting', { key: 'yt_dlp_path', value: ytDlpPath });
      await checkTools();
      alert('Settings saved successfully!');
    } catch (e) {
      console.error(e);
      alert('Failed to save settings');
    }
  };

  const fetchCacheSize = async () => {
    try {
      const size = await invoke<string>('get_audio_cache_size');
      setCacheSize(size);
    } catch (e) {
      console.error(e);
      setCacheSize('Error');
    }
  };

  const handleClearCache = async () => {
    if (!confirm('Are you sure you want to clear all downloaded audio files? They will be re-downloaded when needed.')) return;
    try {
      await invoke('clear_audio_cache');
      await fetchCacheSize();
      alert('Audio cache cleared successfully.');
    } catch (e) {
      console.error(e);
      alert('Failed to clear audio cache.');
    }
  };

  useEffect(() => {
    fetchCacheSize();
    loadAiSettings();
    checkTools();
  }, []);

  return (
    <div className="p-8 max-w-4xl">
      <h2 className="text-3xl font-bold mb-6 text-foreground">Settings</h2>
      
      <div className="space-y-6">
        {/* Output Directory */}
        <section className="bg-card p-6 rounded-lg border border-border shadow-sm">
          <h3 className="text-xl font-semibold mb-4 text-card-foreground">Export & Output</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Default Output Directory</label>
              <div className="flex gap-2">
                <Input 
                  type="text" 
                  value={settings.outputDir} 
                  onChange={(e) => updateSettings({ outputDir: e.target.value })}
                  className="flex-1" 
                />
                <Button variant="secondary">
                  Browse...
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">All rendered MP4 files will be saved here by default. (e.g. ~/Downloads)</p>
            </div>
          </div>
        </section>

        {/* Text Appearance */}
        <section className="bg-card p-6 rounded-lg border border-border shadow-sm">
          <h3 className="text-xl font-semibold mb-4 text-card-foreground">Text & Appearance</h3>
          <div className="space-y-4">
            <div className="border-border">
              <label className="block text-sm text-muted-foreground mb-1">App Theme</label>
              <div className="flex gap-4 mt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="theme" value="dark" checked={settings.theme === 'dark'} onChange={() => updateSettings({ theme: 'dark' })} />
                  <span className="text-foreground">Dark</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="theme" value="light" checked={settings.theme === 'light'} onChange={() => updateSettings({ theme: 'light' })} />
                  <span className="text-foreground">Light</span>
                </label>
              </div>
            </div>
          </div>
        </section>

        {/* AI Configuration */}
        <section className="bg-card p-6 rounded-lg border border-border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-card-foreground">AI Configuration</h3>
            <Button variant="default" onClick={saveAiSettings}>Save AI Settings</Button>
          </div>
          <div className="space-y-6">
            <div className="space-y-4 border-b border-border pb-4">
              <h4 className="text-sm font-semibold text-muted-foreground">Text & Summarization AI</h4>
              <div className="flex gap-4">
                <div className="w-1/3">
                  <label className="block text-sm text-muted-foreground mb-1">Provider</label>
                  <select 
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                    className="w-full bg-background border border-input rounded px-3 py-2 text-foreground text-sm"
                  >
                    <option value="openai">OpenAI (GPT-4o-mini)</option>
                    <option value="gemini">Google Gemini (Flash)</option>
                    <option value="claude">Anthropic Claude</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-muted-foreground mb-1">API Key</label>
                  <Input 
                    type="password" 
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="sk-..." 
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4 border-b border-border pb-4">
              <h4 className="text-sm font-semibold text-muted-foreground">Image Generation AI</h4>
              <div className="flex gap-4">
                <div className="w-1/3">
                  <label className="block text-sm text-muted-foreground mb-1">Provider</label>
                  <select 
                    value={aiImageProvider}
                    onChange={(e) => setAiImageProvider(e.target.value)}
                    className="w-full bg-background border border-input rounded px-3 py-2 text-foreground text-sm"
                  >
                    <option value="openai">OpenAI (DALL-E 3)</option>
                    <option value="stability">Stability AI</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-muted-foreground mb-1">API Key (Leave empty to use Text API Key)</label>
                  <Input 
                    type="password" 
                    value={aiImageApiKey}
                    onChange={(e) => setAiImageApiKey(e.target.value)}
                    placeholder="Leave empty to use main API key" 
                  />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground">Text-to-Speech (TTS) AI</h4>
              <div className="flex gap-4">
                <div className="w-1/3">
                  <label className="block text-sm text-muted-foreground mb-1">Provider</label>
                  <select 
                    value={aiTtsProvider}
                    onChange={(e) => setAiTtsProvider(e.target.value)}
                    className="w-full bg-background border border-input rounded px-3 py-2 text-foreground text-sm"
                  >
                    <option value="openai">OpenAI TTS</option>
                    <option value="elevenlabs">ElevenLabs</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-muted-foreground mb-1">API Key (Leave empty to use Text API Key)</label>
                  <Input 
                    type="password" 
                    value={aiTtsApiKey}
                    onChange={(e) => setAiTtsApiKey(e.target.value)}
                    placeholder="Leave empty to use main API key" 
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Stock Media APIs */}
        <section className="bg-card p-6 rounded-lg border border-border shadow-sm">
          <h3 className="text-xl font-semibold mb-4 text-card-foreground">Stock Background APIs</h3>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              API keys untuk fitur &quot;Fetch Background Online&quot;. Daftar gratis di{' '}
              <a href="https://pixabay.com/api/docs/" target="_blank" rel="noreferrer" className="text-primary underline">Pixabay</a> dan{' '}
              <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" className="text-primary underline">Pexels</a>.
            </p>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Pixabay API Key</label>
              <Input
                type="password"
                value={pixabayApiKey}
                onChange={(e) => setPixabayApiKey(e.target.value)}
                placeholder="Pixabay API key"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Pexels API Key</label>
              <Input
                type="password"
                value={pexelsApiKey}
                onChange={(e) => setPexelsApiKey(e.target.value)}
                placeholder="Pexels API key"
              />
            </div>
          </div>
        </section>

        {/* Video Clipper Tools */}
        <section className="bg-card p-6 rounded-lg border border-border shadow-sm">
          <h3 className="text-xl font-semibold mb-4 text-card-foreground">Video Clipper & YouTube Engine</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm text-muted-foreground mb-1">yt-dlp Binary Path</label>
                <Input
                  type="text"
                  value={ytDlpPath}
                  onChange={(e) => setYtDlpPath(e.target.value)}
                  placeholder="/usr/local/bin/yt-dlp"
                />
              </div>
              <Button variant="secondary" className="mt-6" onClick={checkTools}>
                Re-check Status
              </Button>
            </div>
            {toolStatus && (
              <div className="p-3 bg-muted rounded border border-border text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span>yt-dlp Engine:</span>
                  <span className={toolStatus.yt_dlp_installed ? "text-green-500 font-semibold" : "text-red-500 font-semibold"}>
                    {toolStatus.yt_dlp_installed ? `Installed (${toolStatus.yt_dlp_path})` : "Not Found"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>FFmpeg Converter:</span>
                  <span className={toolStatus.ffmpeg_installed ? "text-green-500 font-semibold" : "text-red-500 font-semibold"}>
                    {toolStatus.ffmpeg_installed ? `Installed (${toolStatus.ffmpeg_path})` : "Not Found"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Audio Cache Manager */}
        <section className="bg-card p-6 rounded-lg border border-border shadow-sm">
          <h3 className="text-xl font-semibold mb-4 text-card-foreground">Audio Manager</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between border border-border p-4 rounded bg-background">
              <div>
                <h4 className="text-sm font-medium text-foreground">Local Audio Cache</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Downloaded audio files are stored locally to speed up future rendering.
                </p>
                <p className="text-sm font-mono text-primary mt-2">
                  Current Size: {cacheSize}
                </p>
              </div>
              <Button variant="destructive" onClick={handleClearCache}>
                Clear Cache
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
