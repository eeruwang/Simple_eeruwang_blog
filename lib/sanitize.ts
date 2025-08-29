// lib/sanitize.ts
import sanitizeHtml from "sanitize-html";

export function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "img","figure","figcaption",
      "h1","h2","h3","h4","h5","h6",
      "table","thead","tbody","tfoot","tr","td","th",
      "mark","sup","sub"
    ],
    allowedAttributes: {
      a: ["href","name","target","rel"],
      img: ["src","srcset","sizes","alt","title","width","height","loading"],
      "*": ["id","class","data-*"]
    },
    allowedSchemes: ["http","https","mailto","data"],
    allowedSchemesByTag: { img: ["http","https","data"] },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || "";
        const isExternal = /^https?:\/\//i.test(href);
        const rel = new Set((attribs.rel || "").split(/\s+/).filter(Boolean));
        rel.add("noopener"); rel.add("noreferrer");
        if (isExternal) rel.add("nofollow");
        return { tagName, attribs: { ...attribs, rel: Array.from(rel).join(" "), target: isExternal ? "_blank" : attribs.target } };
      }
    },
    disallowedTagsMode: "discard"
  });
}
