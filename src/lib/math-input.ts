export function insertMathTemplate(value: string, start: number, end: number, template: string) {
  const selected = value.slice(start, end);
  const selectionToken = "{selection}";
  const cursorToken = "{cursor}";
  let insertion = template.replace(selectionToken, selected);
  let cursor = insertion.indexOf(cursorToken);
  insertion = insertion.replace(cursorToken, "");
  if (cursor < 0) cursor = insertion.length;
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    selectionStart: start + cursor,
    selectionEnd: start + cursor,
  };
}
