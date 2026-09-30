/**
 * 캔버스 텍스트 줄바꿈. 사용자가 넣은 줄바꿈(\n)을 유지하고,
 * 박스 너비를 넘으면 단어 단위로, 단어 하나가 너무 길면(한글 등) 글자 단위로 자른다.
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const token of para.split(/(\s+)/)) {
      if (token === '') continue;
      if (measure(line + token) <= maxWidth) {
        line += token;
        continue;
      }
      if (line.trim() !== '') {
        out.push(line.trimEnd());
        line = '';
      }
      if (/^\s+$/.test(token)) continue;
      if (measure(token) <= maxWidth) {
        line = token;
        continue;
      }
      for (const ch of token) {
        if (line !== '' && measure(line + ch) > maxWidth) {
          out.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
