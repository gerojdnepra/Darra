import type { InterfaceLanguage } from "./types";

export const defaultInterfaceLanguage: InterfaceLanguage = "en";

export const interfaceLanguageOptions: Array<{
  value: InterfaceLanguage;
  label: string;
}> = [
  {
    value: "en",
    label: "English"
  },
  {
    value: "ru",
    label: "Русский"
  }
];

export const normalizeInterfaceLanguage = (
  value: string | null | undefined
): InterfaceLanguage => (value === "ru" ? "ru" : defaultInterfaceLanguage);
