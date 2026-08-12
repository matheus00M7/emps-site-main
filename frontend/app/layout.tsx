import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "EMPS | Painel Operacional",
    template: "%s | EMPS",
  },
  description:
    "Front administrativo do EMPS para operacao, pagamentos, alertas e carregadores.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
