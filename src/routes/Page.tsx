import { useTranslation } from "react-i18next";
import { LineEditor } from "@/components/LineEditor";
import { LineTabs } from "@/components/LineTabs";

export function Page() {
  const { t } = useTranslation();
  return (
    <section>
      <h1 className="sr-only">{t("page.title")}</h1>
      <LineTabs />
      <LineEditor />
    </section>
  );
}
