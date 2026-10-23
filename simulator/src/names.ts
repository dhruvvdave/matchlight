/**
 * 100% fictional clubs, venues and people. Nothing here refers to a real club, league, player or stadium.
 */
export interface ClubTemplate {
  id: string;
  name: string;
  short: string;
  primary: string;
  secondary: string;
  stadium: string;
  city: string;
}

export const CLUBS: readonly ClubTemplate[] = [
  { id: 'hba', name: 'Harbourside Athletic', short: 'HBA', primary: '#1f4bb8', secondary: '#f2c14e', stadium: 'Lantern Quay', city: 'Port Ellery' },
  { id: 'ivr', name: 'Ironvale Rovers', short: 'IVR', primary: '#c2412d', secondary: '#f3e9d2', stadium: 'Foundry Park', city: 'Ironvale' },
  { id: 'kvf', name: 'Kestrel Vale', short: 'KVF', primary: '#0f8a6a', secondary: '#e8f5e9', stadium: 'The Kestrel Meadow', city: 'Kestrel Vale' },
  { id: 'lkt', name: 'Larkspur Town', short: 'LKT', primary: '#7b3fbf', secondary: '#ffd166', stadium: 'Larkspur Lane', city: 'Larkspur' },
  { id: 'cpb', name: 'Copperline Borough', short: 'CPB', primary: '#d07a2a', secondary: '#1b1b1b', stadium: 'Copperline Works', city: 'Copperline' },
  { id: 'smm', name: 'Saltmere Mariners', short: 'SMM', primary: '#1aa3c9', secondary: '#0b2545', stadium: 'Saltmere Docks', city: 'Saltmere' },
  { id: 'glt', name: 'Glimmerford Town', short: 'GLT', primary: '#e0b100', secondary: '#202a44', stadium: 'Glimmer Road', city: 'Glimmerford' },
  { id: 'sth', name: 'Stormhaven FC', short: 'STH', primary: '#5c6b7a', secondary: '#ff5d5d', stadium: 'Stormhaven Point', city: 'Stormhaven' },
  { id: 'emb', name: 'Emberly Rovers', short: 'EMB', primary: '#b3243b', secondary: '#ffffff', stadium: 'Emberly Hollow', city: 'Emberly' },
  { id: 'qsp', name: 'Quillon Sporting', short: 'QSP', primary: '#2e9e3f', secondary: '#111111', stadium: 'Quillon Arena', city: 'Quillon' },
];

export const FIRST_NAMES: readonly string[] = [
  'Aarav', 'Bastien', 'Callum', 'Dario', 'Elias', 'Femi', 'Gael', 'Hamza', 'Idris', 'Jonah', 'Kofi', 'Luca',
  'Mateo', 'Nikolai', 'Oisin', 'Pavel', 'Quentin', 'Rafael', 'Soren', 'Tariq', 'Umar', 'Viktor', 'Wesley',
  'Xavi', 'Yusuf', 'Zane', 'Arlo', 'Bram', 'Cyrus', 'Dmitri', 'Emeka', 'Finn', 'Gustavo', 'Henrik', 'Ilan',
  'Jules', 'Kenji', 'Leandro', 'Milan', 'Nuno', 'Osman', 'Pierre', 'Rohan', 'Santi', 'Teodor', 'Ugo',
  'Vasco', 'Wilfred', 'Yannick', 'Ziggy', 'Anders', 'Bilal', 'Cosmin', 'Davi', 'Enzo', 'Florin', 'Gideon',
  'Hugo', 'Ivo', 'Jasper', 'Kai', 'Lorcan', 'Marlon', 'Nadir', 'Otto', 'Remy', 'Sami', 'Tobias',
];

export const LAST_NAMES: readonly string[] = [
  'Ashdown', 'Brightwater', 'Calloway', 'Dunmore', 'Everhart', 'Fairbairn', 'Galloway', 'Hollins', 'Ivers',
  'Jandro', 'Kettering', 'Lindqvist', 'Marchetti', 'Novak', 'Okonjo', 'Pellerin', 'Quarry', 'Rasmussen',
  'Sandoval', 'Thornfield', 'Uwakwe', 'Valcourt', 'Whitlock', 'Yarrow', 'Zielinski', 'Abernathy', 'Bexley',
  'Castellan', 'Deverell', 'Eskildsen', 'Fontaine', 'Greaves', 'Halvorsen', 'Iwobi-Lake', 'Juniper',
  'Kowalczyk', 'Lachance', 'Moreau', 'Ndiaye-Hart', 'Ostrander', 'Pardoe', 'Quintero', 'Rourke', 'Strand',
  'Tamsin', 'Underhill', 'Varga', 'Wexford', 'Ystad', 'Zamora-Lee', 'Albrecht', 'Brannigan', 'Corvino',
  'Dalgaard', 'Ellery', 'Ferro', 'Gentry', 'Hadley', 'Imbert', 'Jarvik', 'Kearsley', 'Lysander', 'Mallory',
  'Nyberg', 'Orsini', 'Prowse', 'Renwick', 'Sorensby', 'Talbot-Rey', 'Vance', 'Wilmot', 'Yoshida-Brook',
];

export const REFEREES: readonly string[] = ['R. Penhallow', 'S. Achterberg', 'M. Okafor-Lind', 'J. Tresize', 'A. Velloso'];
export const WEATHER: readonly string[] = ['Clear, 14°C', 'Light rain, 9°C', 'Overcast, 11°C', 'Windy, 8°C', 'Mild evening, 16°C'];
export const COMPETITION = 'Matchlight Synthetic League (fictional)';
