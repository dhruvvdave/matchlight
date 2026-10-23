import type { Language } from '@matchlight/schema';

const VOICES: Record<Language, { locale: string; voice: string }> = {
  en: { locale: 'en-GB', voice: 'en-GB-RyanNeural' },
  fr: { locale: 'fr-FR', voice: 'fr-FR-HenriNeural' },
  es: { locale: 'es-ES', voice: 'es-ES-AlvaroNeural' },
  hi: { locale: 'hi-IN', voice: 'hi-IN-MadhurNeural' },
  ar: { locale: 'ar-SA', voice: 'ar-SA-HamedNeural' },
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Azure AI Speech neural text-to-speech (REST). Returns MP3 bytes. */
export async function synthesize(
  cfg: { key: string; region: string },
  text: string,
  lang: Language,
  style: 'commentary' | 'recap' = 'commentary',
): Promise<Buffer> {
  const v = VOICES[lang];
  const rate = style === 'commentary' ? '+10%' : '+0%';
  const ssml = `<speak version="1.0" xml:lang="${v.locale}"><voice name="${v.voice}"><prosody rate="${rate}">${esc(text.slice(0, 3000))}</prosody></voice></speak>`;
  const res = await fetch(`https://${cfg.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'matchlight',
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Speech ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export { VOICES };
