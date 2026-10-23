import type { Language } from '@matchlight/schema';

/** Short on-screen overlay labels. Narrative text lives in the agents' template catalogue. */
export type LabelKey =
  | 'momentum'
  | 'top_speed'
  | 'ball_speed'
  | 'shot_speed'
  | 'pass_difficulty'
  | 'xg'
  | 'ppda'
  | 'tempo'
  | 'possession'
  | 'distance'
  | 'key_moment'
  | 'goal'
  | 'yellow_card'
  | 'red_card'
  | 'substitution'
  | 'tactical_change'
  | 'big_chance'
  | 'save'
  | 'pass_map'
  | 'pressing'
  | 'your_team'
  | 'focus'
  | 'last_10'
  | 'milestone'
  | 'momentum_swing'
  | 'off'
  | 'on';

export const LABELS: Record<Language, Record<LabelKey, string>> = {
  en: {
    momentum: 'Momentum',
    top_speed: 'Top speed',
    ball_speed: 'Ball speed',
    shot_speed: 'Shot speed',
    pass_difficulty: 'Pass difficulty',
    xg: 'xG',
    ppda: 'PPDA',
    tempo: 'Tempo',
    possession: 'Possession',
    distance: 'Distance',
    key_moment: 'Key moment',
    goal: 'GOAL',
    yellow_card: 'Yellow card',
    red_card: 'Red card',
    substitution: 'Substitution',
    tactical_change: 'Tactical change',
    big_chance: 'Big chance',
    save: 'Save',
    pass_map: 'Pass map',
    pressing: 'Pressing',
    your_team: 'Your team',
    focus: 'Player focus',
    last_10: 'last 10 min',
    milestone: 'Milestone',
    momentum_swing: 'Momentum swing',
    off: 'Off',
    on: 'On',
  },
  fr: {
    momentum: 'Dynamique',
    top_speed: 'Vitesse max',
    ball_speed: 'Vitesse du ballon',
    shot_speed: 'Vitesse de frappe',
    pass_difficulty: 'Difficulté de passe',
    xg: 'xG',
    ppda: 'PPDA',
    tempo: 'Rythme',
    possession: 'Possession',
    distance: 'Distance',
    key_moment: 'Moment clé',
    goal: 'BUT',
    yellow_card: 'Carton jaune',
    red_card: 'Carton rouge',
    substitution: 'Remplacement',
    tactical_change: 'Changement tactique',
    big_chance: 'Grosse occasion',
    save: 'Arrêt',
    pass_map: 'Carte des passes',
    pressing: 'Pressing',
    your_team: 'Votre équipe',
    focus: 'Focus joueur',
    last_10: '10 dernières min',
    milestone: 'Cap franchi',
    momentum_swing: 'Bascule du match',
    off: 'Sort',
    on: 'Entre',
  },
  es: {
    momentum: 'Impulso',
    top_speed: 'Velocidad máx.',
    ball_speed: 'Velocidad del balón',
    shot_speed: 'Velocidad del disparo',
    pass_difficulty: 'Dificultad del pase',
    xg: 'xG',
    ppda: 'PPDA',
    tempo: 'Ritmo',
    possession: 'Posesión',
    distance: 'Distancia',
    key_moment: 'Momento clave',
    goal: 'GOL',
    yellow_card: 'Tarjeta amarilla',
    red_card: 'Tarjeta roja',
    substitution: 'Cambio',
    tactical_change: 'Cambio táctico',
    big_chance: 'Ocasión clara',
    save: 'Parada',
    pass_map: 'Mapa de pases',
    pressing: 'Presión',
    your_team: 'Tu equipo',
    focus: 'Foco en jugador',
    last_10: 'últimos 10 min',
    milestone: 'Hito',
    momentum_swing: 'Cambio de impulso',
    off: 'Sale',
    on: 'Entra',
  },
  hi: {
    momentum: 'मोमेंटम',
    top_speed: 'टॉप स्पीड',
    ball_speed: 'गेंद की रफ़्तार',
    shot_speed: 'शॉट की रफ़्तार',
    pass_difficulty: 'पास की कठिनाई',
    xg: 'xG',
    ppda: 'PPDA',
    tempo: 'रफ़्तार',
    possession: 'पज़ेशन',
    distance: 'दूरी',
    key_moment: 'अहम पल',
    goal: 'गोल',
    yellow_card: 'पीला कार्ड',
    red_card: 'लाल कार्ड',
    substitution: 'बदलाव',
    tactical_change: 'रणनीति में बदलाव',
    big_chance: 'बड़ा मौक़ा',
    save: 'बचाव',
    pass_map: 'पास मैप',
    pressing: 'प्रेसिंग',
    your_team: 'आपकी टीम',
    focus: 'खिलाड़ी फ़ोकस',
    last_10: 'पिछले 10 मिनट',
    milestone: 'उपलब्धि',
    momentum_swing: 'मोमेंटम पलटा',
    off: 'बाहर',
    on: 'अंदर',
  },
  ar: {
    momentum: 'الزخم',
    top_speed: 'أعلى سرعة',
    ball_speed: 'سرعة الكرة',
    shot_speed: 'سرعة التسديدة',
    pass_difficulty: 'صعوبة التمريرة',
    xg: 'xG',
    ppda: 'PPDA',
    tempo: 'الإيقاع',
    possession: 'الاستحواذ',
    distance: 'المسافة',
    key_moment: 'لحظة حاسمة',
    goal: 'هدف',
    yellow_card: 'بطاقة صفراء',
    red_card: 'بطاقة حمراء',
    substitution: 'تبديل',
    tactical_change: 'تغيير تكتيكي',
    big_chance: 'فرصة كبيرة',
    save: 'تصدٍّ',
    pass_map: 'خريطة التمريرات',
    pressing: 'الضغط',
    your_team: 'فريقك',
    focus: 'تركيز على لاعب',
    last_10: 'آخر 10 دقائق',
    milestone: 'إنجاز',
    momentum_swing: 'تحوّل الزخم',
    off: 'خروج',
    on: 'دخول',
  },
};

export const label = (lang: Language, key: LabelKey) => LABELS[lang][key] ?? LABELS.en[key];
