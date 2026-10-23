import path from 'node:path';
import { readdir, realpath, open } from 'node:fs/promises';
import { AppError } from './errors.js';

const FULL_TEXT = '(?:全文|全篇(?:文档|文章|内容)?|整篇(?:文档|文章)?|完整内容|完整原文|全部内容)';

export function isFullTextRequest(question) {
  question = question.replace(/全文(?:检索|搜索)/gu, '');
  if (new RegExp(`(?:不要|无需|不需要|不用)\\s*(?:输出|提供|显示|展示)?\\s*(?:文章的?|文档的?)?${FULL_TEXT}`, 'u').test(question)) return false;
  return new RegExp(`(?:输出|提供|显示|展示|给我|看|需要)[\\s\\S]*${FULL_TEXT}`, 'u').test(question)
    || new RegExp(`${FULL_TEXT}[\\s\\S]*(?:输出|展示|显示)`, 'u').test(question)
    || new RegExp(`^\\s*${FULL_TEXT}[。！？!?]?\\s*$`, 'u').test(question)
    || new RegExp(`《[^》]+》[^。！？\\n]*${FULL_TEXT}`, 'u').test(question)
    || new RegExp(`(?:文章|文档|手册|制度|章程|报告|资料).{0,20}${FULL_TEXT}`, 'u').test(question)
    || /(?:完整|全部)(?:输出|展示|提供|显示)[\s\S]*(?:《|文章|文档|手册)/u.test(question);
}

const normalize = name => name.replace(/\.(?:docx?|pdf|md|txt)$/i, '')
  .replace(/^\d+[_\-\s]*/, '').replace(/\s/g, '').toLowerCase();
const contentKey = text => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '');

function sentenceFromQuestion(question) {
  const request = `(?:请|帮我|麻烦)?\\s*(?:输出|提供|显示|展示|给我|查看)\\s*`
    + `(?:(?:这篇|这份|这句话|该句|该|所在|对应|其|的|文章|文档|资料|内容)\\s*)*${FULL_TEXT}`;
  return question.replace(new RegExp(`${request}[。！？!?,，\\s]*$`, 'u'), '')
    .replace(new RegExp(`^${request}[：:\\s]*`, 'u'), '')
    .replace(/^\s*(?:提问|问题|请问|原句)[：:\s]*/u, '').trim();
}

export async function readFullDocument(question, knowledgeDir, { signal } = {}) {
  if (!knowledgeDir) throw new AppError('CONFIG_ERROR', '请配置KNOWLEDGE_DIR后读取全文');
  const root = await realpath(knowledgeDir);
  const files = [];
  async function walk(directory) {
    signal?.throwIfAborted();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
        files.push({ file, filename: /^document\.md$/i.test(entry.name)
          ? path.basename(directory) : entry.name });
      }
    }
  }
  await walk(root);
  const cache = new Map();
  async function readAllowed(selected) {
    if (cache.has(selected.file)) return cache.get(selected.file);
    const file = await realpath(selected.file);
    const relative = path.relative(root, file);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      throw new AppError('INVALID_DOCUMENT', '文档不能超出知识目录', 403);
    }
    const handle = await open(file, 'r');
    let bytes;
    try {
      if ((await handle.stat()).size > 2 * 1024 * 1024) {
        throw new AppError('DOCUMENT_TOO_LARGE', '文档超过全文响应大小限制，请直接打开原文件查看', 413);
      }
      bytes = await handle.readFile({ signal });
    } finally { await handle.close(); }
    let answer;
    try { answer = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new AppError('INVALID_ENCODING', '文档不是有效UTF-8，无法原样输出全文'); }
    if (answer.includes('\0')) throw new AppError('INVALID_ENCODING', '文档包含NUL字符，请检查文件编码');
    const result = { answer, file };
    cache.set(selected.file, result);
    return result;
  }
  const quoted = /《([^》]+)》/u.exec(question)?.[1];
  const query = normalize(question);
  const matches = files.filter(item => quoted ? normalize(item.filename) === normalize(quoted)
    : normalize(item.filename).length > 1 && query.includes(normalize(item.filename)));
  if (!quoted && !matches.length) {
    const sentence = contentKey(sentenceFromQuestion(question));
    // A short generic word is not enough evidence for choosing a whole document.
    if (Array.from(sentence).length >= 12) {
      for (const item of files) {
        const { answer } = await readAllowed(item);
        if (contentKey(answer).includes(sentence)) matches.push(item);
      }
    }
  }
  if (matches.length !== 1) return { answer: matches.length > 1
    ? '找到多份匹配文档，请写明完整文档名后再请求全文。'
    : quoted ? '未找到指定文档，请核对文档名。'
      : '请写明文档名，例如：请输出《新员工入职培训手册》的全文。', references: [] };
  const selected = matches[0];
  const { file, answer } = await readAllowed(selected);
  return { answer, references: [{ citation_id: 1, kind: 'full_document',
    source_path: file.replaceAll('\\', '/'), filename: selected.filename,
    snippet: Array.from(answer).slice(0, 200).join('') }] };
}
