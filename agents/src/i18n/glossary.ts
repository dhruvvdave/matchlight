import type { Language } from '@matchlight/schema';

/**
 * Football terminology glossary used by the Translator agent. With Azure AI Translator these are
 * enforced through dynamic-dictionary markup; with an LLM translator they are injected into the prompt;
 * offline, localised templates are checked against them.
 */
export const GLOSSARY: Record<string, Record<Exclude<Language, 'en'>, string>> = {
  pressing: { fr: 'pressing', es: 'presión', hi: 'प्रेसिंग', ar: 'الضغط' },
  'high press': { fr: 'pressing haut', es: 'presión alta', hi: 'हाई प्रेस', ar: 'الضغط العالي' },
  nutmeg: { fr: 'petit pont', es: 'caño', hi: 'नटमेग', ar: 'كوبري' },
  'through ball': { fr: 'passe en profondeur', es: 'pase al hueco', hi: 'थ्रू बॉल', ar: 'تمريرة بينية' },
  'counter-attack': { fr: 'contre-attaque', es: 'contraataque', hi: 'काउंटर-अटैक', ar: 'هجمة مرتدة' },
  offside: { fr: 'hors-jeu', es: 'fuera de juego', hi: 'ऑफ़साइड', ar: 'تسلل' },
  'clean sheet': { fr: 'cage inviolée', es: 'portería a cero', hi: 'क्लीन शीट', ar: 'شباك نظيفة' },
  'set piece': { fr: 'coup de pied arrêté', es: 'balón parado', hi: 'सेट पीस', ar: 'كرة ثابتة' },
  'low block': { fr: 'bloc bas', es: 'bloque bajo', hi: 'लो ब्लॉक', ar: 'التكتل الدفاعي' },
  'one-two': { fr: 'une-deux', es: 'pared', hi: 'वन-टू', ar: 'تمريرة ثنائية' },
  'hat-trick': { fr: 'triplé', es: 'triplete', hi: 'हैट-ट्रिक', ar: 'هاتريك' },
  brace: { fr: 'doublé', es: 'doblete', hi: 'दो गोल', ar: 'ثنائية' },
  'stoppage time': {
    fr: 'temps additionnel',
    es: 'tiempo añadido',
    hi: 'स्टॉपेज टाइम',
    ar: 'الوقت بدل الضائع',
  },
  'own goal': { fr: 'but contre son camp', es: 'gol en propia puerta', hi: 'आत्मघाती गोल', ar: 'هدف عكسي' },
  tackle: { fr: 'tacle', es: 'entrada', hi: 'टैकल', ar: 'تدخل' },
  header: { fr: 'tête', es: 'cabezazo', hi: 'हेडर', ar: 'ضربة رأس' },
  'free kick': { fr: 'coup franc', es: 'tiro libre', hi: 'फ़्री किक', ar: 'ركلة حرة' },
  corner: { fr: 'corner', es: 'saque de esquina', hi: 'कॉर्नर', ar: 'ركلة ركنية' },
  penalty: { fr: 'penalty', es: 'penalti', hi: 'पेनल्टी', ar: 'ركلة جزاء' },
  'final third': { fr: 'dernier tiers', es: 'último tercio', hi: 'फ़ाइनल थर्ड', ar: 'الثلث الأخير' },
  'yellow card': { fr: 'carton jaune', es: 'tarjeta amarilla', hi: 'पीला कार्ड', ar: 'بطاقة صفراء' },
  'red card': { fr: 'carton rouge', es: 'tarjeta roja', hi: 'लाल कार्ड', ar: 'بطاقة حمراء' },
  save: { fr: 'arrêt', es: 'parada', hi: 'बचाव', ar: 'تصدٍّ' },
  winger: { fr: 'ailier', es: 'extremo', hi: 'विंगर', ar: 'جناح' },
  striker: { fr: 'avant-centre', es: 'delantero centro', hi: 'स्ट्राइकर', ar: 'رأس الحربة' },
  goalkeeper: { fr: 'gardien', es: 'portero', hi: 'गोलकीपर', ar: 'حارس المرمى' },
  momentum: { fr: 'dynamique', es: 'impulso', hi: 'मोमेंटम', ar: 'الزخم' },
  possession: { fr: 'possession', es: 'posesión', hi: 'पज़ेशन', ar: 'الاستحواذ' },
  substitution: { fr: 'remplacement', es: 'cambio', hi: 'बदलाव', ar: 'تبديل' },
  xG: { fr: 'xG', es: 'xG', hi: 'xG', ar: 'xG' },
  PPDA: { fr: 'PPDA', es: 'PPDA', hi: 'PPDA', ar: 'PPDA' },
};

/** Glossary entries whose English term occurs in `text` (longest first, word-boundary match). */
export function glossaryHits(text: string): string[] {
  return Object.keys(GLOSSARY)
    .sort((a, b) => b.length - a.length)
    .filter((term) => new RegExp(`\\b${term.replace(/[-]/g, '[- ]?')}\\b`, 'i').test(text));
}

/**
 * Wrap glossary terms in Azure AI Translator dynamic-dictionary markup so they translate exactly.
 * e.g. <mstrans:dictionary translation="presión">pressing</mstrans:dictionary>
 */
export function applyDynamicDictionary(text: string, to: Exclude<Language, 'en'>): string {
  let out = text;
  for (const term of glossaryHits(text)) {
    const re = new RegExp(`\\b(${term.replace(/[-]/g, '[- ]?')})\\b`, 'gi');
    out = out.replace(
      re,
      (m) => `<mstrans:dictionary translation="${GLOSSARY[term][to]}">${m}</mstrans:dictionary>`,
    );
  }
  return out;
}
