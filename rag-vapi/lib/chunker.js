import { AppError } from './errors.js';

export const CHUNKER_VERSION = 'h3-h2-600-overlap50-v2';
const size = text => Array.from(text).length;

function splitLong(text, title) {
  if (size(text) <= 800) return [text];
  const prefix = title ? `### ${title}\n` : '';
  const limit = 800 - size(prefix), target = 600 - size(prefix);
  if (limit < 400) throw new AppError('CHUNK_TITLE_TOO_LONG', '标题过长，无法在800字内保留正文');
  const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;\n]*|[。！？!?；;\n]+/gu) || [];
  const output = [];
  let parts = [], length = 0;
  for (const sentence of sentences) {
    const n = size(sentence);
    if (n > limit) throw new AppError('CHUNK_SENTENCE_TOO_LONG',
      '单个长句连同标题超过800字，无法同时保证不截句和长度上限；请补充句号或换行后重试');
    if (length && (length + n > limit || (length >= 400 && length + n > target
      && Math.abs(length - target) <= Math.abs(length + n - target)))) {
      output.push(prefix + parts.join('').trim());
      // Keep complete sentences around the 50-character overlap target.
      const overlap = [];
      let overlapSize = 0;
      for (let i = parts.length - 1; i >= 0 && overlapSize < 50; i--) {
        if (overlapSize + size(parts[i]) > 200) break;
        overlap.unshift(parts[i]);
        overlapSize += size(parts[i]);
      }
      parts = overlapSize < length && overlapSize + n <= limit ? overlap : [];
      length = size(parts.join(''));
    }
    parts.push(sentence);
    length += n;
  }
  if (parts.length) output.push(prefix + parts.join('').trim());
  return output;
}

export function chunkText(input, { source_path = '' } = {}) {
  const sections = [];
  let lines = [], chapter = '', h2 = '', h3 = '', title = '', fence = null;
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) sections.push({ text, title });
    lines = [];
  };
  for (const line of input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    const heading = !fence && /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      if (heading[1].length > 1) flush();
      if (heading[1].length === 1) { chapter = heading[2]; h2 = ''; h3 = ''; }
      if (heading[1].length === 2) { h2 = heading[2]; h3 = ''; }
      if (heading[1].length === 3) h3 = heading[2];
      title = [chapter, h2, h3].filter(Boolean).join(' / ');
    }
    lines.push(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    }
  }
  flush();
  const merged = [];
  for (const section of sections) {
    const previous = merged.at(-1);
    if (previous && size(previous.text) < 600
      && (size(section.text) < 200 || size(previous.text) < 200)
      && size(previous.text) + size(section.text) + 2 <= 800) {
      previous.text += '\n\n' + section.text;
      previous.title = [...new Set([previous.title, section.title].filter(Boolean))].join(' | ');
    } else merged.push({ ...section });
  }
  return merged.flatMap(section => splitLong(section.text, section.title)
    .map(chunk_text => ({ source_path, title: section.title, chunk_text })))
    .map((chunk, chunk_index) => ({ ...chunk, chunk_index }));
}
