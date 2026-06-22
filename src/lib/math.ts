const UNSAFE_TEX = /\\(?:input|include|write|openout|read|catcode|def|newcommand|renewcommand|href|htmlClass|htmlStyle)\b/gi;

export function normalizeMathMarkup(input: string) {
  return input
    .replace(/\[\$\$\]([\s\S]*?)\[\/\$\$\]/g, (_, tex) => `\\[${cleanTex(tex)}\\]`)
    .replace(/\[\$\]([\s\S]*?)\[\/\$\]/g, (_, tex) => `\\(${cleanTex(tex)}\\)`)
    .replace(/\[latex\]([\s\S]*?)\[\/latex\]/gi, (_, tex) => {
      const cleaned = cleanTex(tex)
        .replace(/\\begin\{(?:displaymath|equation\*?)\}/g, "")
        .replace(/\\end\{(?:displaymath|equation\*?)\}/g, "")
        .replace(/\\begin\{math\}/g, "")
        .replace(/\\end\{math\}/g, "");
      return `\\[${cleaned}\\]`;
    });
}

export function cleanTex(tex: string) {
  return tex.replace(UNSAFE_TEX, "\\text{[unsupported command]}");
}

export function containsMath(input: string) {
  return /\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|(?:^|[^\\$])\$(?!\$)[^\n$]+?\$(?!\$)|[∑√∞≤≥≠≈∫∂∇πθαβγ]/.test(input);
}

export function mathInputPreview(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}
