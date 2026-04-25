export const ISO6393To1: Record<string, string> = {
  ckb: "ku",
  kmr: "ku",
};

export const normalizeLanguageCode = (code: string) =>
  ISO6393To1[code.toLowerCase()] ?? code.toLowerCase();

export const languageRegex = (language: string) => {
  const normalized = normalizeLanguageCode(language);
  if (normalized === "zh" || normalized === "ja" || normalized === "ko") {
    return "\\p{Letter}\\p{Number}\\u3040-\\u30ff\\u3400-\\u9fff";
  }
  return "\\p{Letter}\\p{Number}";
};
