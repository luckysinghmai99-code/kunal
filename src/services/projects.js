'use strict';

const { newId } = require('../lib/crypto');
const { HttpError } = require('../lib/http');

const MAX_VERSIONS = 30;
const MAX_FILE_BYTES = 512 * 1024;
const PATH_RE = /^[A-Za-z0-9._\-/]+$/;

function validFilePath(p) {
  return typeof p === 'string' && p.length <= 200 && PATH_RE.test(p) && !p.includes('..') && !p.startsWith('/');
}

function owned(d, userId, projectId) {
  const project = d.projects.find((p) => p.id === projectId && p.userId === userId);
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

function filesOf(d, projectId) {
  const out = {};
  for (const f of d.files) if (f.projectId === projectId) out[f.path] = f.content;
  return out;
}

function summary(project, d) {
  const files = d.files.filter((f) => f.projectId === project.id);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    category: project.spec ? project.spec.category : null,
    status: project.status,
    fileCount: files.length,
    currentVersion: project.currentVersion,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function cleanText(value, max, label) {
  const text = String(value ?? '').trim();
  if (text.length > max) throw new HttpError(422, `${label} must be at most ${max} characters`);
  return text;
}

function saveGeneration(d, project, files, { label, spec, design }) {
  const previous = filesOf(d, project.id);
  if (Object.keys(previous).length > 0) {
    project.currentVersion += 1;
    d.versions.push({ id: newId('ver'), projectId: project.id, number: project.currentVersion, label: 'Before ' + label, createdAt: new Date().toISOString(), files: previous });
    const versions = d.versions.filter((v) => v.projectId === project.id).sort((a, b) => b.number - a.number);
    for (const old of versions.slice(MAX_VERSIONS)) d.versions = d.versions.filter((v) => v.id !== old.id);
  }
  d.files = d.files.filter((f) => f.projectId !== project.id);
  const now = new Date().toISOString();
  for (const [path, content] of Object.entries(files)) {
    d.files.push({ id: newId('fil'), projectId: project.id, path, content, updatedAt: now });
  }
  project.spec = spec;
  project.design = design;
  project.status = 'generated';
  project.updatedAt = now;
}

class ProjectService {
  constructor(store) {
    this.store = store;
  }

  create(userId, { name, description }) {
    const projectName = cleanText(name, 80, 'Project name') || 'Untitled project';
    return this.store.tx((d) => {
      const now = new Date().toISOString();
      const project = {
        id: newId('prj'), userId, name: projectName, description: cleanText(description, 500, 'Description'),
        status: 'draft', spec: null, design: null, currentVersion: 0, createdAt: now, updatedAt: now,
      };
      d.projects.push(project);
      return summary(project, d);
    });
  }

  list(userId) {
    return this.store.read((d) => d.projects
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => summary(p, d)));
  }

  get(userId, projectId) {
    return this.store.read((d) => {
      const project = owned(d, userId, projectId);
      const versions = d.versions.filter((v) => v.projectId === projectId)
        .map((v) => ({ number: v.number, label: v.label, createdAt: v.createdAt }))
        .sort((a, b) => b.number - a.number);
      const messages = d.messages.filter((m) => m.projectId === projectId);
      return {
        ...summary(project, d),
        spec: project.spec,
        files: Object.keys(filesOf(d, projectId)).sort().map((path) => ({ path, bytes: Buffer.byteLength(filesOf(d, projectId)[path]) })),
        versions,
        messages,
      };
    });
  }

  update(userId, projectId, { name, description }) {
    return this.store.tx((d) => {
      const project = owned(d, userId, projectId);
      if (name !== undefined) project.name = cleanText(name, 80, 'Project name') || project.name;
      if (description !== undefined) project.description = cleanText(description, 500, 'Description');
      project.updatedAt = new Date().toISOString();
      return summary(project, d);
    });
  }

  duplicate(userId, projectId) {
    return this.store.tx((d) => {
      const src = owned(d, userId, projectId);
      const now = new Date().toISOString();
      const copy = { ...src, id: newId('prj'), name: `${src.name} (copy)`.slice(0, 80), currentVersion: 0, createdAt: now, updatedAt: now };
      d.projects.push(copy);
      for (const f of d.files.filter((x) => x.projectId === src.id)) {
        d.files.push({ ...f, id: newId('fil'), projectId: copy.id });
      }
      return summary(copy, d);
    });
  }

  remove(userId, projectId) {
    return this.store.tx((d) => {
      owned(d, userId, projectId);
      d.projects = d.projects.filter((p) => p.id !== projectId);
      d.files = d.files.filter((f) => f.projectId !== projectId);
      d.versions = d.versions.filter((v) => v.projectId !== projectId);
      d.messages = d.messages.filter((m) => m.projectId !== projectId);
      d.jobs = d.jobs.filter((j) => j.projectId !== projectId);
      return { ok: true };
    });
  }

  saveFile(userId, projectId, path, content) {
    if (!validFilePath(path)) throw new HttpError(422, 'Invalid file path');
    if (typeof content !== 'string') throw new HttpError(422, 'File content must be text');
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new HttpError(413, 'File exceeds 512 KB');
    return this.store.tx((d) => {
      const project = owned(d, userId, projectId);
      const now = new Date().toISOString();
      const row = d.files.find((f) => f.projectId === projectId && f.path === path);
      if (row) {
        row.content = content;
        row.updatedAt = now;
      } else {
        d.files.push({ id: newId('fil'), projectId, path, content, updatedAt: now });
      }
      project.updatedAt = now;
      return { path, bytes: Buffer.byteLength(content) };
    });
  }

  readFile(userId, projectId, path) {
    return this.store.read((d) => {
      owned(d, userId, projectId);
      const row = d.files.find((f) => f.projectId === projectId && f.path === path);
      if (!row) throw new HttpError(404, 'File not found');
      return row.content;
    });
  }

  files(userId, projectId) {
    return this.store.read((d) => {
      owned(d, userId, projectId);
      return filesOf(d, projectId);
    });
  }

  restoreVersion(userId, projectId, number) {
    return this.store.tx((d) => {
      const project = owned(d, userId, projectId);
      const version = d.versions.find((v) => v.projectId === projectId && v.number === Number(number));
      if (!version) throw new HttpError(404, 'Version not found');
      const current = filesOf(d, projectId);
      project.currentVersion += 1;
      d.versions.push({ id: newId('ver'), projectId, number: project.currentVersion, label: `Before restoring v${number}`, createdAt: new Date().toISOString(), files: current });
      d.files = d.files.filter((f) => f.projectId !== projectId);
      const now = new Date().toISOString();
      for (const [path, content] of Object.entries(version.files)) d.files.push({ id: newId('fil'), projectId, path, content, updatedAt: now });
      project.updatedAt = now;
      return { restored: Number(number), currentVersion: project.currentVersion };
    });
  }

  addMessage(d, projectId, userId, role, content) {
    const msg = { id: newId('msg'), projectId, userId, role, content: String(content).slice(0, 4000), createdAt: new Date().toISOString() };
    d.messages.push(msg);
    return msg;
  }
}

module.exports = { ProjectService, owned, filesOf, validFilePath, summary, saveGeneration };
