import { z } from 'zod';
import type { Language } from '@matchlight/schema';
import { GLOSSARY, applyDynamicDictionary, glossaryHits } from './i18n/glossary.js';
import type { LlmClient } from './runtime/llm.js';

export interface TranslationProvider {
  readonly name: 'azure-translator' | 'azure-openai';
  translate(text: string, to: Exclude<Language, 'en'>, protect: string[]): Promise<string>;
}

/**
 * Azure AI Translator (Text Translation v3). Glossary terms are pinned with dynamic-dictionary markup
 * and player / club names are protected with `notranslate` spans so they never get "translated".
 */
export class AzureTranslatorProvider implements TranslationProvider {
  readonly name = 'azure-translator' as const;
  constructor(private readonly cfg: { endpoint: string; key: string; region?: string }) {}

  async translate(text: string, to: Exclude<Language, 'en'>, protect: string[]): Promise<string> {
    let html = escapeHtml(text);
    for (const p of [...protect].sort((a, b) => b.length - a.length)) {
      if (p) html = html.split(escapeHtml(p)).join(`<span class="notranslate">${escapeHtml(p)}</span>`);
    }
    html = applyDynamicDictionary(html, to);
    const url = `${this.cfg.endpoint.replace(/\/$/, '')}/translate?api-version=3.0&from=en&to=${to}&textType=html`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.cfg.key,
        ...(this.cfg.region ? { 'Ocp-Apim-Subscription-Region': this.cfg.region } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: html }]),
    });
    if (!res.ok) throw new Error(`Translator ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { translations: { text: string }[] }[];
    return unescapeHtml(
      json[0].translations[0].text
        .replace(/<\/?span[^>]*>/g, '')
        .replace(/<\/?mstrans:dictionary[^>]*>/g, ''),
    );
  }
}

/** Fallback translator when only Azure OpenAI is configured: glossary injected into the prompt. */
export class LlmTranslationProvider implements TranslationProvider {
  readonly name = 'azure-openai' as const;
  constructor(private readonly llm: LlmClient) {}
  async translate(text: string, to: Exclude<Language, 'en'>, protect: string[]): Promise<string> {
    const glossary = glossaryHits(text).map((t) => `${t} => ${GLOSSARY[t][to]}`);
    const res = await this.llm.complete({
      agent: 'translator',
      system: `Translate football commentary from English to ${LANG_NAME[to]}. Keep it natural and broadcast-ready.
Use these glossary translations exactly: ${glossary.join('; ') || '(none)'}.
Never translate these names: ${protect.join(', ') || '(none)'}. Keep every number exactly as written (Western digits).
Return JSON {"text": string}.`,
      user: text,
      schema: z.object({ text: z.string() }),
      schemaName: 'translation',
      temperature: 0,
      timeoutMs: 6000,
      mock: () => ({ text }),
    });
    return res.data.text;
  }
}

const LANG_NAME: Record<Language, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  hi: 'Hindi',
  ar: 'Arabic (Modern Standard)',
};

export interface TranslationResult {
  text: string;
  provider: string;
  glossary: { term: string; expected: string; present: boolean }[];
}

/** Translator / Localizer agent. */
export class TranslatorAgent {
  constructor(readonly provider: TranslationProvider | null) {}

  get available(): boolean {
    return this.provider !== null;
  }

  async translate(text: string, to: Language, protect: string[]): Promise<TranslationResult> {
    if (to === 'en') return { text, provider: 'identity', glossary: [] };
    if (!this.provider) throw new Error('no translation provider configured');
    const hits = glossaryHits(text);
    const out = await this.provider.translate(text, to, protect);
    return {
      text: out,
      provider: this.provider.name,
      glossary: hits.map((term) => ({
        term,
        expected: GLOSSARY[term][to],
        present: out.toLowerCase().includes(GLOSSARY[term][to].toLowerCase()),
      })),
    };
  }

  /** Offline check that a localised template uses the glossary's terminology. */
  verifyLocalised(english: string, localised: string, lang: Language) {
    if (lang === 'en') return [];
    return glossaryHits(english).map((term) => ({
      term,
      expected: GLOSSARY[term][lang as Exclude<Language, 'en'>],
      present: localised
        .toLowerCase()
        .includes(GLOSSARY[term][lang as Exclude<Language, 'en'>].toLowerCase()),
    }));
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescapeHtml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
