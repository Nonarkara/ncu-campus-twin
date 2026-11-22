// Dialable numbers only. Each number gets its own link; '#ext' written onto a number is dialled after a pause.
// A bare '(分機 N)' / '校內分機 N' is an internal extension, shown as text, never dialled.
export const tels = phone => [...(phone ?? '').matchAll(/09\d{2}-?\d{3}-?\d{3}|(?:\(0\d\)\s?|0\d{1,2}-?)\d{3,4}-?\d{3,4}(?:#\d+)?/g)].map(m => {
  const [num, ext] = m[0].split('#'); const d = num.replace(/\D/g, '');
  return { label: m[0], href: `tel:+886${d.slice(1)}${ext ? ',' + ext : ''}` };
});
