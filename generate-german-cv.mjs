#!/usr/bin/env node

/**
 * generate-german-cv.mjs
 *
 * Dedicated German Lebenslauf generator.
 *
 * Usage:
 *   node generate-german-cv.mjs [--input path] [--html path] [--pdf path] [--no-pdf]
 */

import yaml from 'js-yaml';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONTHS = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  SEPT: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

const LABELS = {
  en: {
    htmlLang: 'en',
    documentTitle: 'Curriculum Vitae',
    personalDetails: 'Personal Details',
    profile: 'Professional Profile',
    competencies: 'Core Competencies',
    experience: 'Professional Experience',
    education: 'Education',
    certifications: 'Certifications',
    languages: 'Languages',
    placeDate: 'Place and Date',
    signature: 'Signature',
    dateOfBirth: 'Date of Birth',
    nationality: 'Nationality',
    location: 'Location',
    tools: 'Tools',
    present: 'Present',
    photoAltPrefix: 'Photo of',
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownInline(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

function normalizeDash(value) {
  return String(value ?? '').replace(/[–—]/g, '-').replace(/\s*-\s*/g, ' - ').trim();
}

function splitFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: markdown };
  return {
    frontmatter: yaml.load(match[1]) ?? {},
    body: match[2],
  };
}

function getSection(body, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return match ? match[1].trim() : '';
}

function parseCompetencies(section) {
  return section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\*\*(.+?):\*\*\s*(.+)$/);
      if (!match) return null;
      return { label: stripMarkdown(match[1]), value: stripMarkdown(match[2]) };
    })
    .filter(Boolean);
}

function parseListSection(section) {
  return section
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean);
}

function parseEducation(section) {
  return section
    .split(/\n\s*\n/)
    .map(block => stripMarkdown(block.replace(/\s+/g, ' ')))
    .filter(Boolean);
}

function parseHeadingWithPeriod(heading) {
  const parts = normalizeDash(heading).split('|').map(part => part.trim());
  if (parts.length > 1 && /(?:PRESENT|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC|\d{4})/i.test(parts[0])) {
    return { period: parts[0], title: parts.slice(1).join(' | ') };
  }
  return { period: '', title: heading.trim() };
}

function pushParagraph(target, line) {
  const clean = stripMarkdown(line);
  if (clean) target.description.push(clean);
}

function parseExperience(section) {
  const employers = [];
  let currentEmployer = null;
  let currentEngagement = null;

  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === '---') continue;

    if (line.startsWith('### ')) {
      const parsed = parseHeadingWithPeriod(line.slice(4));
      currentEmployer = {
        name: parsed.title,
        period: parsed.period,
        role: '',
        engagements: [],
      };
      employers.push(currentEmployer);
      currentEngagement = null;
      continue;
    }

    if (line.startsWith('#### ')) {
      if (!currentEmployer) continue;
      const parsed = parseHeadingWithPeriod(line.slice(5));
      currentEngagement = {
        title: parsed.title,
        period: parsed.period,
        project: '',
        role: '',
        description: [],
        responsibilities: [],
        achievements: [],
        bullets: [],
        tools: '',
      };
      currentEmployer.engagements.push(currentEngagement);
      continue;
    }

    if (!currentEmployer) continue;

    if (line.startsWith('**Role:**')) {
      const role = stripMarkdown(line.replace('**Role:**', ''));
      if (currentEngagement) currentEngagement.role = role;
      else currentEmployer.role = role;
      continue;
    }

    if (!currentEngagement) continue;

    if (line.startsWith('**Project:**') || line.startsWith('**Project 2:**')) {
      currentEngagement.project = stripMarkdown(line.replace(/\*\*Project(?: 2)?:\*\*/, ''));
      continue;
    }

    if (line.startsWith('**Tools:**')) {
      currentEngagement.tools = stripMarkdown(line.replace('**Tools:**', ''));
      continue;
    }

    if (line.startsWith('- ')) {
      currentEngagement.bullets.push(stripMarkdown(line.slice(2)));
      continue;
    }

    if (line.startsWith('**')) continue;
    pushParagraph(currentEngagement, line);
  }

  return employers;
}

export function parseCvMarkdown(markdown) {
  const { frontmatter, body } = splitFrontmatter(markdown);
  return {
    frontmatter,
    summary: getSection(body, 'Professional Summary').replace(/\n+/g, ' ').trim(),
    competencies: parseCompetencies(getSection(body, 'Core Competencies')),
    employers: parseExperience(getSection(body, 'Professional Experience')),
    education: parseEducation(getSection(body, 'Education')),
    certifications: parseListSection(getSection(body, 'Certifications')),
    languages: Array.isArray(frontmatter.languages)
      ? frontmatter.languages.map(item => ({ lang: item.lang, level: item.level })).filter(item => item.lang)
      : parseListSection(getSection(body, 'Languages')).map(line => ({ lang: line, level: '' })),
    personalDetails: parseListSection(getSection(body, 'Personal Details')),
  };
}

function formatMonthYear(value) {
  const normalized = normalizeDash(value).toUpperCase();
  if (normalized === 'PRESENT') return LABELS.en.present;
  const match = normalized.match(/^([A-Z]{3,4})\s+(\d{4})$/);
  if (match && MONTHS[match[1]]) return `${MONTHS[match[1]]}/${match[2]}`;
  return value.trim();
}

export function formatGermanPeriod(period) {
  const normalized = normalizeDash(period);
  if (!normalized) return '';
  const parts = normalized.split(' - ').map(part => part.trim()).filter(Boolean);
  if (parts.length === 1) return formatMonthYear(parts[0]);
  return parts.map(formatMonthYear).join(' - ');
}

function defaultCvPath() {
  const parentCv = resolve(__dirname, '..', 'cv.md');
  if (existsSync(parentCv)) return parentCv;
  return resolve(__dirname, 'cv.md');
}

function todayGerman() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${now.getFullYear()}`;
}

function mimeTypeForPath(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

async function resolvePhotoSrc(inputPath, frontmatter, override) {
  if (override) return override;
  if (!frontmatter.photo) return '';
  const absolute = resolve(dirname(inputPath), frontmatter.photo);
  if (!existsSync(absolute)) return '';
  const image = await readFile(absolute);
  return `data:${mimeTypeForPath(absolute)};base64,${image.toString('base64')}`;
}

function replaceTokens(template, tokens) {
  return Object.entries(tokens).reduce(
    (html, [key, value]) => html.replaceAll(`{{${key}}}`, value),
    template,
  );
}

function compactBullets(engagement) {
  const candidates = [...engagement.description, ...engagement.bullets];
  return candidates.slice(0, 5);
}

export async function renderGermanCvHtml(data, options = {}) {
  const templatePath = options.templatePath ?? join(__dirname, 'templates', 'cv-template-de.html');
  const template = await readFile(templatePath, 'utf-8');
  const frontmatter = data.frontmatter;
  const labels = LABELS.en;
  const location = frontmatter.location ?? '';
  const contactLines = [
    location,
    frontmatter.email ?? '',
    frontmatter.linkedin ?? '',
  ].filter(Boolean).map(escapeHtml).join('<br>');

  const personalDetails = [
    [labels.dateOfBirth, frontmatter.date_of_birth],
    [labels.nationality, frontmatter.nationality],
    [labels.location, location],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<li><strong>${escapeHtml(label)}</strong><br>${escapeHtml(value)}</li>`)
    .join('\n');

  const summary = data.summary
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(paragraph => `<p>${markdownInline(paragraph)}</p>`)
    .join('\n');

  const competencies = data.competencies
    .map(item => `<div class="skill-block"><strong>${escapeHtml(item.label)}</strong>${escapeHtml(item.value)}</div>`)
    .join('\n');

  const experience = data.employers.map((employer) => {
    const role = employer.role ? ` | ${escapeHtml(employer.role)}` : '';
    const employerPeriod = formatGermanPeriod(employer.period);
    const engagements = employer.engagements.map((engagement) => {
      const project = engagement.project ? `<p>${markdownInline(engagement.project)}</p>` : '';
      const bullets = compactBullets(engagement)
        .map(bullet => `<li>${markdownInline(bullet)}</li>`)
        .join('\n');
      const tools = engagement.tools ? `<p class="tools"><strong>${escapeHtml(labels.tools)}:</strong> ${escapeHtml(engagement.tools)}</p>` : '';
      return [
        '<div class="entry">',
        `<h4>${escapeHtml(engagement.title)}</h4>`,
        `<div class="meta">${escapeHtml(formatGermanPeriod(engagement.period))}${engagement.role ? ` | ${escapeHtml(engagement.role)}` : ''}</div>`,
        project,
        bullets ? `<ul>${bullets}</ul>` : '',
        tools,
        '</div>',
      ].filter(Boolean).join('\n');
    }).join('\n');
    return [
      `<h3>${escapeHtml(employer.name)}${role}</h3>`,
      employerPeriod ? `<div class="meta">${escapeHtml(employerPeriod)}</div>` : '',
      engagements,
    ].filter(Boolean).join('\n');
  }).join('\n');

  const education = data.education
    .map(item => `<p>${markdownInline(item)}</p>`)
    .join('\n');

  const certifications = data.certifications
    .map(item => `<li>${markdownInline(item)}</li>`)
    .join('\n');

  const languages = data.languages
    .map(item => `<li><strong>${escapeHtml(item.lang)}</strong><br>${escapeHtml(item.level ?? '')}</li>`)
    .join('\n');

  const photo = options.photoSrc
    ? `<img class="photo" src="${escapeHtml(options.photoSrc)}" alt="${escapeHtml(labels.photoAltPrefix)} ${escapeHtml(frontmatter.name ?? '')}">`
    : '';

  return replaceTokens(template, {
    HTML_LANG: labels.htmlLang,
    DOCUMENT_TITLE: labels.documentTitle,
    NAME: escapeHtml(frontmatter.name ?? ''),
    TITLE: escapeHtml(frontmatter.title ?? ''),
    CONTACT: contactLines,
    PHOTO: photo,
    SECTION_PERSONAL_DETAILS: labels.personalDetails,
    SECTION_PROFILE: labels.profile,
    SECTION_COMPETENCIES: labels.competencies,
    SECTION_EXPERIENCE: labels.experience,
    SECTION_EDUCATION: labels.education,
    SECTION_CERTIFICATIONS: labels.certifications,
    SECTION_LANGUAGES: labels.languages,
    SECTION_PLACE_DATE: labels.placeDate,
    SIGNATURE_LABEL: labels.signature,
    PERSONAL_DETAILS: personalDetails,
    SUMMARY: summary,
    COMPETENCIES: competencies,
    EXPERIENCE: experience,
    EDUCATION: education,
    CERTIFICATIONS: certifications,
    LANGUAGES: languages,
    LOCATION_DATE: `${escapeHtml(String(location).split(',')[0] || 'Hamburg')}, ${escapeHtml(options.today ?? todayGerman())}`,
  });
}

function parseArgs(argv) {
  const options = {
    input: defaultCvPath(),
    html: resolve(__dirname, 'output', 'vladislav-dektiarev-lebenslauf-de.html'),
    pdf: resolve(__dirname, 'output', 'vladislav-dektiarev-lebenslauf-de.pdf'),
    pdfEnabled: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-pdf') {
      options.pdfEnabled = false;
    } else if (arg === '--input') {
      options.input = resolve(argv[++i]);
    } else if (arg.startsWith('--input=')) {
      options.input = resolve(arg.slice('--input='.length));
    } else if (arg === '--html') {
      options.html = resolve(argv[++i]);
    } else if (arg.startsWith('--html=')) {
      options.html = resolve(arg.slice('--html='.length));
    } else if (arg === '--pdf') {
      options.pdf = resolve(argv[++i]);
    } else if (arg.startsWith('--pdf=')) {
      options.pdf = resolve(arg.slice('--pdf='.length));
    }
  }

  return options;
}

function runNode(args) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(process.execPath, args, { cwd: __dirname }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolvePromise({ stdout, stderr });
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

export async function generateGermanCv(options = {}) {
  const inputPath = resolve(options.input ?? defaultCvPath());
  const htmlPath = resolve(options.html ?? join(__dirname, 'output', 'vladislav-dektiarev-lebenslauf-de.html'));
  const pdfPath = resolve(options.pdf ?? join(__dirname, 'output', 'vladislav-dektiarev-lebenslauf-de.pdf'));
  const markdown = await readFile(inputPath, 'utf-8');
  const data = parseCvMarkdown(markdown);
  const html = await renderGermanCvHtml(data, {
    today: options.today,
    photoSrc: await resolvePhotoSrc(inputPath, data.frontmatter, options.photoSrc),
  });

  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, html, 'utf-8');

  if (options.pdfEnabled !== false) {
    await mkdir(dirname(pdfPath), { recursive: true });
    await runNode(['generate-pdf.mjs', htmlPath, pdfPath, '--format=a4']);
  }

  return {
    input: inputPath,
    html: htmlPath,
    pdf: options.pdfEnabled === false ? null : pdfPath,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await generateGermanCv(options);
  console.log(JSON.stringify({
    input: result.input,
    html: result.html,
    pdf: result.pdf,
  }, null, 2));
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`German CV generation failed: ${error.message}`);
    if (error.stderr) console.error(error.stderr);
    process.exit(1);
  });
}
