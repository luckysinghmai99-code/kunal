'use strict';

// ENGINE 06 — Export & Deployment.
// Packages a generated project into a ZIP with README, env example, Dockerfile
// and .gitignore. Blocks the export if anything that looks like a live secret is
// found. Produces a real SVG logo file. Raster (PNG/JPG) and PDF rendering need
// a headless browser and are not included in this build.

const { buildZip } = require('../lib/zip');

const SECRET_PATTERNS = [
  /rzp_live_[A-Za-z0-9]{8,}/,
  /sk_live_[A-Za-z0-9]{8,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ANTHROPIC_API_KEY\s*=\s*[^\s$]{8,}/,
];

const EXCLUDED_NAMES = [/(^|\/)\.env$/, /secret/i, /credential/i];

function logoSvg(design) {
  const c = design.palette.primary;
  const a = design.palette.accent;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" role="img" aria-label="${design.appName} logo">
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
  <path d="M60 40 C40 10, 10 10, 10 40 S40 70, 60 40 S100 10, 110 40 S80 70, 60 40 Z" fill="none" stroke="url(#g)" stroke-width="8" stroke-linecap="round"/>
</svg>
`;
}

function readme(design, spec, checks) {
  const passed = checks.passed ? 'All generated-project checks passed.' : 'Some checks failed. Review before deploying.';
  return `# ${design.appName}

Generated from the prompt: "${spec.raw.slice(0, 300)}"

## Run locally
${spec.backend ? '```bash\nnpm start\n# open http://localhost:3000\n```\n' : 'Open index.html in a browser, or serve the folder:\n\n```bash\npython3 -m http.server 8080\n```\n'}
## Structure
- index.html: entry page
- assets/styles.css: design system
- assets/content.js: site content and navigation (edit this to change text)
- assets/app.js: hash router and renderer
${spec.backend ? '- server/server.js: backend API\n- db/migrations: SQL schema\n- .env.example: environment variables (copy to .env)\n' : ''}
## Quality
${passed}

## Notes
Pages: ${spec.pages.join(', ')}.
Integrations requested: ${spec.integrations.length ? spec.integrations.join(', ') : 'none'}.
Never commit real API keys. Keep them in .env, which is excluded from version control.
`;
}

function dockerfile(spec) {
  if (spec.backend) {
    return 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nENV NODE_ENV=production\nEXPOSE 3000\nCMD ["node", "server/server.js"]\n';
  }
  return 'FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\n';
}

function findSecrets(files) {
  const hits = [];
  for (const [name, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) hits.push(name);
    }
  }
  return hits;
}

/**
 * @returns {{files: Record<string,string>, zip: Buffer, excluded: string[]}}
 */
function packageProject({ design, spec, projectFiles, checks }) {
  const excluded = [];
  const files = {};
  for (const [name, content] of Object.entries(projectFiles)) {
    if (EXCLUDED_NAMES.some((re) => re.test(name))) {
      excluded.push(name);
      continue;
    }
    files[name] = content;
  }

  const secretHits = findSecrets(files);
  if (secretHits.length) {
    const err = new Error(`Export blocked: possible live secret found in ${secretHits.join(', ')}`);
    err.status = 422;
    throw err;
  }

  files['assets/logo.svg'] = logoSvg(design);
  files['README.md'] = readme(design, spec, checks);
  files['Dockerfile'] = dockerfile(spec);
  files['.gitignore'] = 'node_modules/\n.env\ndata/\n*.log\n';
  if (!files['.env.example']) files['.env.example'] = 'PORT=3000\n';

  const zip = buildZip(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([name, content]) => ({ name, content })));
  return { files, zip, excluded };
}

module.exports = { packageProject, logoSvg, findSecrets };
