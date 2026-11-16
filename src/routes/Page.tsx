import { useTranslation } from "react-i18next";
import { LineEditor } from "@/components/LineEditor";

export function Page() {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="sr-only">{t("page.title")}</h1>
      <LineEditor />
    </section>
  );
}
