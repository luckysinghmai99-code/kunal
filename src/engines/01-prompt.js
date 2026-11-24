'use strict';

// ENGINE 01 — Prompt Intelligence.
// Turns a natural-language brief (English, Hindi or mixed) into a structured
// project specification. Deterministic and offline. An optional LLM refinement
// step is handled by the orchestrator when a provider key is configured.

const CATEGORIES = [
  { id: 'ecommerce', words: ['ecommerce', 'e-commerce', 'shop', 'store', 'online store', 'product', 'दुकान', 'ईकॉमर्स', 'स्टोर'] },
  { id: 'railway-booking', words: ['railway', 'train booking', 'railway booking', 'irctc', 'ticket', 'रेलवे', 'ट्रेन', 'टिकट'] },
  { id: 'streaming', words: ['netflix', 'streaming', 'video platform', 'movies', 'वीडियो', 'स्ट्रीमिंग'] },
  { id: 'school-portal', words: ['school', 'college', 'student', 'management portal', 'स्कूल', 'कॉलेज', 'छात्र'] },
  { id: 'travel', words: ['travel', 'hotel', 'booking website', 'tour', 'यात्रा', 'होटल'] },
  { id: 'banking', words: ['banking', 'bank', 'finance', 'wallet dashboard', 'बैंक'] },
  { id: 'saas', words: ['saas', 'subscription', 'software product'] },
  { id: 'admin-panel', words: ['admin panel', 'admin dashboard', 'backoffice', 'एडमिन'] },
  { id: 'mobile-app', words: ['mobile app', 'android', 'ios', 'app ui', 'मोबाइल ऐप', 'ऐप'] },
  { id: 'portfolio', words: ['portfolio', 'resume', 'personal site', 'पोर्टफोलियो'] },
  { id: 'landing-page', words: ['landing page', 'landing', 'lead page', 'लैंडिंग'] },
  { id: 'business-website', words: ['business website', 'company website', 'corporate', 'website', 'वेबसाइट', 'बिजनेस'] },
];

const PAGE_KEYWORDS = {
  home: ['home', 'होम', 'मुख्य पेज'],
  features: ['features', 'फीचर'],
  about: ['about', 'about us', 'हमारे बारे', 'परिचय'],
  contact: ['contact', 'संपर्क'],
  pricing: ['pricing', 'price', 'plans', 'कीमत', 'प्राइसिंग'],
  login: ['login', 'sign in', 'लॉगिन'],
  signup: ['signup', 'sign up', 'register', 'साइन अप', 'रजिस्टर'],
  dashboard: ['dashboard', 'डैशबोर्ड'],
  products: ['products', 'catalog', 'उत्पाद'],
  cart: ['cart', 'कार्ट'],
  checkout: ['checkout', 'payment page', 'चेकआउट'],
  blog: ['blog', 'articles', 'ब्लॉग'],
  faq: ['faq', 'questions', 'सवाल'],
  booking: ['booking', 'book now', 'बुकिंग'],
  gallery: ['gallery', 'photos', 'गैलरी'],
  profile: ['profile', 'प्रोफाइल'],
  settings: ['settings', 'सेटिंग'],
};

const COMPONENT_KEYWORDS = {
  navbar: ['navbar', 'navigation', 'menu', 'नेविगेशन'],
  hero: ['hero', 'banner', 'हीरो'],
  'card-grid': ['cards', 'grid', 'कार्ड'],
  'pricing-table': ['pricing table', 'plans table'],
  testimonials: ['testimonial', 'reviews', 'रिव्यू'],
  form: ['form', 'फॉर्म'],
  'search-bar': ['search', 'सर्च'],
  table: ['table', 'list view', 'टेबल'],
  stats: ['stats', 'analytics', 'charts', 'चार्ट'],
  modal: ['modal', 'popup'],
  footer: ['footer', 'फुटर'],
};

const COLOR_WORDS = {
  blue: '#2563eb', नीला: '#2563eb', red: '#dc2626', लाल: '#dc2626', green: '#16a34a', हरा: '#16a34a',
  purple: '#7c3aed', बैंगनी: '#7c3aed', orange: '#ea580c', नारंगी: '#ea580c', teal: '#0d9488',
  pink: '#db2777', गुलाबी: '#db2777', gold: '#ca8a04', सुनहरा: '#ca8a04', black: '#111827', काला: '#111827',
};

const ANIMATION_KEYWORDS = {
  'fade-in': ['fade', 'फेड'],
  'slide-up': ['slide', 'स्लाइड'],
  parallax: ['parallax', 'पैरालैक्स'],
  'train-loop': ['train', 'railway animation', 'ट्रेन एनीमेशन'],
  'hover-lift': ['hover', 'होवर'],
  animated: ['animation', 'animated', 'motion', 'एनीमेशन', 'एनिमेशन'],
};

const INTEGRATION_KEYWORDS = {
  razorpay: ['razorpay', 'payment gateway', 'pay online', 'पेमेंट', 'भुगतान'],
  'google-maps': ['google maps', 'map', 'location', 'मैप'],
  whatsapp: ['whatsapp', 'व्हाट्सएप'],
  youtube: ['youtube'],
  instagram: ['instagram'],
  email: ['email notifications', 'send email', 'ईमेल'],
};

const DEFAULT_COMPONENTS = {
  ecommerce: ['navbar', 'hero', 'card-grid', 'search-bar', 'footer'],
  'railway-booking': ['navbar', 'form', 'search-bar', 'table', 'footer'],
  streaming: ['navbar', 'hero', 'card-grid', 'footer'],
  'school-portal': ['navbar', 'table', 'form', 'stats', 'footer'],
  travel: ['navbar', 'hero', 'search-bar', 'card-grid', 'footer'],
  banking: ['navbar', 'stats', 'table', 'footer'],
  saas: ['navbar', 'hero', 'pricing-table', 'testimonials', 'footer'],
  'admin-panel': ['navbar', 'stats', 'table', 'modal'],
  'mobile-app': ['navbar', 'card-grid', 'form'],
  portfolio: ['navbar', 'hero', 'card-grid', 'footer'],
  'landing-page': ['hero', 'testimonials', 'form', 'footer'],
  'business-website': ['navbar', 'hero', 'card-grid', 'testimonials', 'footer'],
  general: ['navbar', 'hero', 'footer'],
};

const DEFAULT_PAGES = {
  ecommerce: ['home', 'products', 'cart', 'checkout', 'contact'],
  'railway-booking': ['home', 'booking', 'login', 'signup', 'dashboard'],
  streaming: ['home', 'login', 'profile', 'dashboard'],
  'school-portal': ['home', 'login', 'dashboard', 'contact'],
  travel: ['home', 'booking', 'contact', 'login'],
  banking: ['login', 'dashboard', 'settings'],
  saas: ['home', 'features', 'pricing', 'signup', 'login'],
  'admin-panel': ['login', 'dashboard', 'settings'],
  'mobile-app': ['home', 'profile'],
  portfolio: ['home', 'about', 'contact'],
  'landing-page': ['home'],
  'business-website': ['home', 'about', 'features', 'contact'],
  general: ['home'],
};

const BACKEND_CATEGORIES = new Set(['ecommerce', 'railway-booking', 'school-portal', 'travel', 'banking', 'saas', 'admin-panel']);
const DATABASE_KEYWORDS = ['login', 'signup', 'register', 'database', 'store', 'book', 'booking', 'account', 'user', 'लॉगिन', 'डेटाबेस'];

const NAMED_COLOR_LOOKUP = COLOR_WORDS;

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function detectLanguage(text) {
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasDevanagari && hasLatin) return 'mixed';
  if (hasDevanagari) return 'hi';
  return 'en';
}

function matchAll(lower, table) {
  const found = [];
  for (const [id, words] of Object.entries(table)) {
    if (words.some((w) => lower.includes(w.toLowerCase()))) found.push(id);
  }
  return found;
}

function detectCategory(lower) {
  for (const cat of CATEGORIES) {
    if (cat.words.some((w) => lower.includes(w.toLowerCase()))) return cat.id;
  }
  return null;
}

function detectColors(lower) {
  const colors = [];
  for (const [word, hex] of Object.entries(NAMED_COLOR_LOOKUP)) {
    if (lower.includes(word) && !colors.includes(hex)) colors.push(hex);
  }
  return colors;
}

function complexityScoreFor(spec, wordCount) {
  let score = 0;
  score += Math.min(wordCount / 40, 3); // length counts, but only up to a cap
  score += Math.min(spec.pages.length, 6) * 0.6;
  score += Math.min(spec.components.length, 12) * 0.25;
  score += spec.integrations.length * 0.8;
  score += spec.backend ? 1.5 : 0;
  score += spec.database ? 1 : 0;
  score += spec.animations.length * 0.3;
  return Math.round(Math.min(score, 15) * 10) / 10;
}

/**
 * @param {string} prompt
 * @param {object} [previous] the project's existing spec, for follow-up edits
 */
function analyzePrompt(prompt, previous = null) {
  const text = normalize(prompt);
  if (text.length < 3) throw Object.assign(new Error('Prompt is too short'), { status: 400 });
  if (text.length > 20000) throw Object.assign(new Error('Prompt is too long (max 20,000 characters)'), { status: 400 });

  const lower = text.toLowerCase();
  const language = detectLanguage(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const isRevision = Boolean(previous);

  const category = detectCategory(lower) || (previous && previous.category) || 'general';
  const requestedPages = matchAll(lower, PAGE_KEYWORDS);
  let pages = requestedPages.length ? requestedPages : (DEFAULT_PAGES[category] || DEFAULT_PAGES.general);
  if (!pages.includes('home')) pages = ['home', ...pages];
  if (isRevision) pages = [...new Set([...previous.pages, ...pages])];

  let components = matchAll(lower, COMPONENT_KEYWORDS);
  if (components.length === 0) components = DEFAULT_COMPONENTS[category] || DEFAULT_COMPONENTS.general;
  if (isRevision) components = [...new Set([...previous.components, ...components])];

  const colorsFound = detectColors(lower);
  const primary = colorsFound[0] || (previous && previous.colors.primary) || '#6d5dfc';
  const accent = colorsFound[1] || (previous && previous.colors.accent) || '#06b6d4';
  const mode = /dark|डार्क|गहरा/.test(lower) ? 'dark' : (previous && previous.colors.mode) || 'light';
  const serif = /serif|elegant|luxury|सेरिफ/.test(lower);

  const animations = matchAll(lower, ANIMATION_KEYWORDS);
  const integrations = matchAll(lower, INTEGRATION_KEYWORDS);
  const imageMatch = lower.match(/(\d+)\s*(images?|photos?|pictures?)/);
  const imagesRequested = imageMatch ? Math.min(Number(imageMatch[1]), 50) : (/image|photo|चित्र|इमेज/.test(lower) ? 2 : 0);

  const backend = BACKEND_CATEGORIES.has(category) || integrations.includes('razorpay') ||
    /login|signup|auth|database|account|booking|cart|checkout/.test(lower) || (isRevision && previous.backend);
  const database = Boolean(backend) && (DATABASE_KEYWORDS.some((w) => lower.includes(w)) || (isRevision && previous.database) || BACKEND_CATEGORIES.has(category));
  const auth = /login|signup|sign up|register|लॉगिन|साइन अप/.test(lower) || pages.some((p) => ['login', 'signup', 'dashboard'].includes(p));

  const missing = [];
  if (!detectCategory(lower) && !isRevision) missing.push('Business or project type not stated; defaulted to general site');
  if (colorsFound.length === 0 && !isRevision) missing.push('No color preference given; using default palette');
  if (requestedPages.length === 0 && !isRevision) missing.push('No pages named; default page set chosen for the project type');

  const spec = {
    raw: text,
    language,
    wordCount,
    isRevision,
    category,
    appName: (previous && previous.appName) || 'RAILDESIGN Project',
    pages,
    components: [...new Set(components)],
    colors: { primary, accent, mode },
    typography: { family: serif ? 'serif' : 'sans', heading: serif ? 'Georgia, serif' : 'Inter, system-ui, sans-serif', body: 'Inter, system-ui, sans-serif' },
    animations,
    integrations,
    imagesRequested,
    auth,
    backend: Boolean(backend),
    database: Boolean(database),
    missing,
    complexityScore: 0,
  };
  spec.complexityScore = complexityScoreFor(spec, wordCount);
  spec.plan = ['analyze', 'design', 'frontend', 'backend', 'test', 'export'];
  return spec;
}

module.exports = { analyzePrompt, detectLanguage, CATEGORIES };
