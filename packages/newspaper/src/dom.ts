import { parseHTML } from "linkedom";

export const parseDocument = (html: string): Document | null => {
  try {
    return parseHTML(html).document;
  } catch {
    return null;
  }
};

export const cloneDocument = (document: Document): Document =>
  parseHTML(document.toString()).document;

export const queryAll = <T extends Element = Element>(
  root: Document | Element,
  selector: string,
): T[] => Array.from(root.querySelectorAll(selector)) as T[];

export const textOf = (node: Node | null | undefined): string =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();

export const attr = (
  node: Element | null | undefined,
  name: string,
): string | null => node?.getAttribute(name)?.trim() ?? null;

export const removeNodes = (nodes: Iterable<Element>) => {
  for (const node of nodes) {
    node.remove();
  }
};

export const serializeNode = (node: Node) =>
  node.nodeType === 1 ? (node as Element).outerHTML : (node.textContent ?? "");

export const absoluteUrl = (value: string, base: string) => {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
};
