export const CHUNKER_VERSION = 'heading-400-800-v1';

export function chunkText(input) {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const sections = [];
  let lines = [], fence = null;
  for (const line of text.split('\n')) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    const heading = !fence && /^#{1,2}\s+\S/.test(line);
    if (heading && lines.length) { sections.push(lines.join('\n')); lines = []; }
    lines.push(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
    }
  }
  if (lines.length) sections.push(lines.join('\n'));
  const chunks = [];
  for (const section of sections) {
    const chars = Array.from(section.trim());
    let start = 0;
    while (start < chars.length) {
      const remaining = chars.length - start;
      let length = Math.min(800, remaining);
      if (remaining > 800) {
        if (remaining - length < 400) length = remaining - 400;
        // Prefer a sentence/paragraph boundary, but never create a >800 character chunk.
        for (let j = length - 1; j >= 399; j--) {
          if (/[。！？；\n]/u.test(chars[start + j])) { length = j + 1; break; }
        }
      }
      const chunk_text = chars.slice(start, start + length).join('').trim();
      if (chunk_text) chunks.push({ chunk_index: chunks.length, chunk_text });
      start += length;
    }
  }
  return chunks;
}
