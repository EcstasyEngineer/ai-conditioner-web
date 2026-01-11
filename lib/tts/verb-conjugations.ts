// Comprehensive verb conjugation list extracted from old codebase
// Used for template processing and validation

export const VERB_CONJUGATIONS = [
  'accept|accepts', 'act|acts', 'actualize|actualizes', 'adopt|adopts', 'align|aligns',
  'am|are|are|is', 'awaken|awakens', 'become|becomes', 'beg|begs', 'belong|belongs',
  'beseech|beseeches', 'break|breaks', 'breathe|breathes', 'can|can', 'cherish|cherishes',
  'command|commands', 'condition|conditions', 'consume|consumes', 'crave|craves', 'cultivate|cultivates',
  'deepen|deepens', 'deny|denies', 'desire|desires', 'discover|discovers', 'dive|dives',
  'do|does', 'dominate|dominates', 'draw|draws', 'dream|dreams', 'embody|embodies',
  'embrace|embraces', 'empty|empties', 'enchant|enchants', 'enslave|enslaves', 'enter|enters',
  'entrance|entrances', 'envision|envisions', 'evolve|evolves', 'exist|exists', 'experience|experiences',
  'feel|feels', 'find|finds', 'follow|follows', 'foster|fosters', 'give|gives',
  'go|goes', 'grow|grows', 'guide|guides', 'have|has|has', 'hear|hears',
  'honor|honors', 'hypnotize|hypnotizes', 'implore|implores', 'induce|induces', 'influence|influences',
  'inhale|inhales', 'invoke|invokes', 'kneel|kneels', 'know|knows', 'lead|leads',
  'let|lets', 'live|lives', 'long|longs', 'lose|loses', 'make|makes',
  'manifest|manifests', 'manipulate|manipulates', 'mesmerize|mesmerizes', 'move|moves', 'must|must',
  'need|needs', 'obey|obeys', 'obligate|obligates', 'offer|offers', 'open|opens',
  'persuade|persuades', 'place|places', 'plead|pleads', 'pledge|pledges', 'realign|realigns',
  'rediscover|rediscovers', 'reframe|reframes', 'refuse|refuses', 'reinvent|reinvents', 'rejuvenate|rejuvenates',
  'relax|relaxes', 'relinquish|relinquishes', 'rely|relies', 'renew|renews', 'reprogram|reprograms',
  'revel|revels', 'revitalize|revitalizes', 'risk|risks', 'sacrifice|sacrifices', 'seduce|seduces',
  'seek|seeks', 'serve|serves', 'soothe|soothes', 'stimulate|stimulates', 'stop|stops',
  'subdue|subdues', 'submit|submits', 'surrender|surrenders', 'take|takes', 'think|thinks',
  'thrive|thrives', 'transfix|transfixes', 'transform|transforms', 'trust|trusts', 'wait|waits',
  'walk|walks', 'want|wants', 'welcome|welcomes', 'will|will', 'withhold|withholds',
  'worship|worships', 'yearn|yearns', 'don\'t|doesn\'t', 'aren\'t|isn\'t', 'prefer|prefers',
  'love|loves', 'get|gets', 'say|says', 'adore|adores', 'shine|shines',
  'dress|dresses', 'strip|strips', 'celebrate|celebrates', 'fill|fills', 'dim|dims',
  'bask|basks', 'grant|grants', 'glow|glows', 'rejoice|rejoices', 'lock|locks',
  'simplify|simplifies', 'reside|resides', 'wear|wears', 'relish|relishes', 'enhance|enhances',
  'soar|soars', 'heighten|heightens', 'set|sets', 'protect|protects', 'bring|brings',
  'intensify|intensifies', 'enrich|enriches', 'have|have|have|has', 'hold|holds', 'create|creates',
  'transcend|transcends', 'demand|demands', 'drive|drives', 'provide|provides', 'shape|shapes',
  'control|controls', 'own|owns'
];

// Enhanced template processor with verb validation
export function validateVerbConjugation(verbPattern: string): boolean {
  return VERB_CONJUGATIONS.some(pattern => pattern === verbPattern);
}

export function getVerbSuggestions(partial: string): string[] {
  return VERB_CONJUGATIONS.filter(pattern =>
    pattern.toLowerCase().includes(partial.toLowerCase())
  ).slice(0, 10);
}

// Load verb conjugations as a Map for template rendering
export function loadVerbConjugations(): Map<string, string[]> {
  const conjugations = new Map<string, string[]>();

  for (const pattern of VERB_CONJUGATIONS) {
    const forms = pattern.split('|');
    const base = forms[0];
    conjugations.set(base, forms);
  }

  return conjugations;
}