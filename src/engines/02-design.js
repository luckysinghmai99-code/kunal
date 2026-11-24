'use strict';

// ENGINE 02 — Design Intelligence.
// Produces a design system (colors, type scale, spacing, radius), the site
// navigation, and the section layout for each page in the spec.

const PAGE_SECTIONS = {
  home: ['hero', 'card-grid', 'stats', 'testimonials', 'form', 'footer-cta'],
  features: ['hero', 'card-grid', 'table'],
  about: ['hero', 'text', 'stats'],
  contact: ['hero', 'form'],
  pricing: ['hero', 'pricing-table', 'faq'],
  login: ['form'],
  signup: ['form'],
  dashboard: ['stats', 'table', 'card-grid'],
  products: ['hero', 'card-grid'],
  cart: ['table', 'form'],
  checkout: ['form'],
  blog: ['hero', 'card-grid'],
  faq: ['hero', 'faq'],
  booking: ['hero', 'form', 'table'],
  gallery: ['hero', 'gallery'],
  profile: ['form'],
  settings: ['form'],
};

const PAGE_TITLES = {
  home: 'Home', features: 'Features', about: 'About', contact: 'Contact', pricing: 'Pricing',
  login: 'Log in', signup: 'Sign up', dashboard: 'Dashboard', products: 'Products', cart: 'Cart',
  checkout: 'Checkout', blog: 'Blog', faq: 'FAQ', booking: 'Booking', gallery: 'Gallery',
  profile: 'Profile', settings: 'Settings',
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

function contrastText(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0b1020' : '#ffffff';
}

function buildPalette(primary, accent, mode) {
  const dark = mode === 'dark';
  return {
    primary,
    primaryText: contrastText(primary),
    accent,
    background: dark ? '#0b1020' : '#f8fafc',
    surface: dark ? '#131a2e' : '#ffffff',
    text: dark ? '#e5e7eb' : '#0f172a',
    muted: dark ? '#94a3b8' : '#64748b',
    border: dark ? mix('#131a2e', '#ffffff', 0.12) : mix('#ffffff', '#0f172a', 0.12),
    primarySoft: mix(primary, dark ? '#0b1020' : '#ffffff', 0.85),
  };
}

function generate(spec) {
  const palette = buildPalette(spec.colors.primary, spec.colors.accent, spec.colors.mode);
  const pages = spec.pages.map((id) => ({
    id,
    title: PAGE_TITLES[id] || id.charAt(0).toUpperCase() + id.slice(1),
    path: id === 'home' ? '/' : `/${id}`,
    sections: (PAGE_SECTIONS[id] || ['hero', 'text']),
  }));

  const navItems = pages
    .filter((p) => !['cart', 'checkout', 'profile', 'settings'].includes(p.id))
    .map((p) => ({ id: p.id, label: p.title, path: p.path }));

  return {
    appName: spec.appName,
    mode: spec.colors.mode,
    palette,
    typography: {
      heading: spec.typography.heading,
      body: spec.typography.body,
      scale: { sm: '0.875rem', base: '1rem', lg: '1.25rem', xl: '2rem', hero: 'clamp(2.25rem, 5vw, 4rem)' },
    },
    tokens: { radius: '14px', spacing: 8, shadow: '0 10px 30px rgba(15,23,42,.12)' },
    layout: {
      header: { items: navItems, sticky: true },
      footer: { columns: 3, copyright: `© ${new Date().getFullYear()} ${spec.appName}` },
    },
    pages,
    variations: [
      { id: 'primary', palette: palette.primary },
      { id: 'alternate', palette: mix(palette.primary, palette.accent, 0.5) },
    ],
    animations: spec.animations,
  };
}

module.exports = { generate, buildPalette, mix, hexToRgb };
