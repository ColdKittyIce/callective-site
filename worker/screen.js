/* Shared filter: slurs, phone numbers (prank calls involve real people), emails and links. */
export const SLURS = /\b(n+[i1!]+g+(?:[e3]+r+|a+h?|u+h)s?|f+[a@4]+g+(?:[o0]+t+)?s?|k+[i1]+k+[e3]+s?|ch+[i1]+n+k+s?|sp+[i1]+c+k?s?|tr+[a@4]+n+n+(?:y|[i1]+e+)s?|r+[e3]+t+[a@4]+r+d+s?|w+[e3]+t+b+[a@4]+c+k+s?|g+[o0]+[o0]+k+s?|c+[o0]+[o0]+n+s?|d+y+k+[e3]+s?)\b/i;
export function screen(...texts) {
  const t = texts.filter(Boolean).join(" ");
  if (SLURS.test(t)) return "language";
  if (/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(t)) return "phone number";
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(t)) return "email";
  if (/https?:\/\/|www\.|\b[\w-]+\.(?:com|net|org|io|gg|tv|me|ly)\b/i.test(t)) return "link";
  return null;
}

