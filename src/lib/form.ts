/** Convert a <form> into a plain object (checkboxes → boolean). Arrays are not supported. */
export function formToObject(form: HTMLFormElement): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.name) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') out[el.name] = el.checked;
    else if (el instanceof HTMLInputElement && el.type === 'file') continue;
    else out[el.name] = el.value;
  }
  return out;
}
