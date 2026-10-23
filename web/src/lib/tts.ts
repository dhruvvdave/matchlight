import type { Language } from '@matchlight/schema';
import { api } from './api';

const LOCALES: Record<Language, string> = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES', hi: 'hi-IN', ar: 'ar-SA' };
let useAzure = false;
let queue: { text: string; lang: Language }[] = [];
let speaking = false;

export function configureTts(azure: boolean) {
  useAzure = azure;
}

/** Speak a commentary line: Azure AI Speech neural voices when configured, browser speechSynthesis offline. */
export function speak(text: string, lang: Language) {
  queue.push({ text, lang });
  if (queue.length > 2) queue = queue.slice(-2); // stay live: drop stale lines
  if (!speaking) void next();
}

async function next() {
  const item = queue.shift();
  if (!item) {
    speaking = false;
    return;
  }
  speaking = true;
  try {
    if (useAzure) {
      const res = await fetch(api.url('/api/tts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (!res.ok) throw new Error('tts');
      const audio = new Audio(URL.createObjectURL(await res.blob()));
      await new Promise<void>((r) => {
        audio.onended = () => r();
        audio.onerror = () => r();
        void audio.play().catch(() => r());
      });
    } else if ('speechSynthesis' in window) {
      await new Promise<void>((r) => {
        const u = new SpeechSynthesisUtterance(item.text);
        u.lang = LOCALES[item.lang];
        u.rate = 1.08;
        const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith(LOCALES[item.lang].slice(0, 2)));
        if (v) u.voice = v;
        u.onend = () => r();
        u.onerror = () => r();
        speechSynthesis.speak(u);
      });
    }
  } catch {
    /* audio is best-effort */
  }
  void next();
}

export function stopSpeaking() {
  queue = [];
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
